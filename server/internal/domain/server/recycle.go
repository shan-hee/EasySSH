package server

import (
	"errors"
	"time"

	"github.com/easyssh/server/internal/domain/recyclebin"
	"github.com/google/uuid"
	"gorm.io/gorm"
)

// archivedServer is what the recycle bin keeps of a deleted server. Share
// grants are deliberately absent: restoring a server must not revive access
// that ended with its deletion.
type archivedServer struct {
	Name               string       `json:"name"`
	Host               string       `json:"host"`
	Port               int          `json:"port"`
	Username           string       `json:"username"`
	GroupID            *uuid.UUID   `json:"group_id,omitempty"`
	JumpServerID       *uuid.UUID   `json:"jump_server_id,omitempty"`
	ConnectionRevision int64        `json:"connection_revision"`
	Description        string       `json:"description"`
	OS                 string       `json:"os"`
	Country            string       `json:"country"`
	CountryCode        string       `json:"country_code"`
	Region             string       `json:"region"`
	City               string       `json:"city"`
	CreatedAt          time.Time    `json:"created_at"`
	Tags               []string     `json:"tags"`
	AuthMethod         AuthMethod   `json:"auth_method"`
	Password           string       `json:"password"` // ciphertext, as stored
	SSHKeyID           *uuid.UUID   `json:"ssh_key_id,omitempty"`
	VNC                *archivedVNC `json:"vnc,omitempty"`
	RDP                *archivedRDP `json:"rdp,omitempty"`
}

type archivedVNC struct {
	Enabled bool `json:"enabled"`
	Port    int  `json:"port"`
	TLS     bool `gorm:"column:tls" json:"tls"`
}

type archivedRDP struct {
	Enabled           bool   `json:"enabled"`
	Port              int    `json:"port"`
	Security          string `json:"security"`
	IgnoreCertificate bool   `json:"ignore_certificate"`
}

// archiveServer copies a server into the recycle bin just before its deletion.
func archiveServer(tx *gorm.DB, id uuid.UUID) error {
	var row Server
	if err := tx.Preload("Auth").First(&row, "id = ?", id).Error; err != nil {
		return err
	}
	archived := archivedServer{
		Name: row.Name, Host: row.Host, Port: row.Port, Username: row.Username, GroupID: row.GroupID, JumpServerID: row.JumpServerID,
		ConnectionRevision: row.ConnectionRevision, Description: row.Description, OS: row.OS,
		Country: row.Country, CountryCode: row.CountryCode, Region: row.Region, City: row.City, CreatedAt: row.CreatedAt,
		AuthMethod: row.Auth.AuthMethod, Password: row.Auth.Password, SSHKeyID: row.Auth.SSHKeyID, Tags: []string{},
	}
	if err := tx.Model(&ServerTag{}).Where("server_id = ?", id).Order("tag_name").Pluck("tag_name", &archived.Tags).Error; err != nil {
		return err
	}
	var vnc []archivedVNC
	if err := tx.Table("server_vnc_configs").Where("server_id = ?", id).Limit(1).Find(&vnc).Error; err != nil {
		return err
	}
	if len(vnc) == 1 {
		archived.VNC = &vnc[0]
	}
	var rdp []archivedRDP
	if err := tx.Table("server_rdp_configs").Where("server_id = ?", id).Limit(1).Find(&rdp).Error; err != nil {
		return err
	}
	if len(rdp) == 1 {
		archived.RDP = &rdp[0]
	}
	name := row.Name
	if name == "" {
		name = row.Host
	}
	return recyclebin.Put(tx, recyclebin.KindServer, id.String(), name, archived)
}

func exists(tx *gorm.DB, table string, id *uuid.UUID) (bool, error) {
	if id == nil {
		return false, nil
	}
	var count int64
	err := tx.Table(table).Where("id = ?", id.String()).Count(&count).Error
	return count > 0, err
}

// RestoreArchived writes a deleted server back under its original ID. A group,
// jump host or SSH key that no longer exists is dropped rather than blocking
// the restore: the server comes back ungrouped, direct, or without its key.
func RestoreArchived(tx *gorm.DB, entry recyclebin.Entry) error {
	id, err := uuid.Parse(entry.ResourceID)
	if err != nil {
		return err
	}
	var archived archivedServer
	if err = recyclebin.Decode(entry, &archived); err != nil {
		return err
	}
	if present, err := exists(tx, "servers", &id); err != nil {
		return err
	} else if present {
		return recyclebin.ErrExists
	}
	if !archived.AuthMethod.IsValid() {
		return errors.New("archived server has no usable authentication method")
	}
	for _, reference := range []struct {
		table string
		id    **uuid.UUID
	}{{"server_groups", &archived.GroupID}, {"servers", &archived.JumpServerID}, {"ssh_keys", &archived.SSHKeyID}} {
		present, err := exists(tx, reference.table, *reference.id)
		if err != nil {
			return err
		}
		if !present {
			*reference.id = nil
		}
	}
	var last struct{ Value *int }
	if err = tx.Model(&Server{}).Select("MAX(sort_order) AS value").Scan(&last).Error; err != nil {
		return err
	}
	order := 0
	if last.Value != nil {
		order = *last.Value + 1
	}
	row := Server{
		ID: id, Name: archived.Name, Host: archived.Host, Port: archived.Port, Username: archived.Username,
		GroupID: archived.GroupID, JumpServerID: archived.JumpServerID, ConnectionRevision: archived.ConnectionRevision,
		Description: archived.Description, OS: archived.OS, Country: archived.Country, CountryCode: archived.CountryCode,
		Region: archived.Region, City: archived.City, CreatedAt: archived.CreatedAt, Status: StatusOffline, SortOrder: order,
		Tags: archived.Tags,
	}
	row.Auth = ServerAuth{AuthMethod: archived.AuthMethod, Password: archived.Password, SSHKeyID: archived.SSHKeyID}
	if err = tx.Omit("Auth", "GroupRecord", "TagRecords").Create(&row).Error; err != nil {
		return err
	}
	if err = row.SaveAuth(tx); err != nil {
		return err
	}
	if err = row.SaveTags(tx); err != nil {
		return err
	}
	if archived.VNC != nil {
		if err = tx.Table("server_vnc_configs").Create(map[string]any{"server_id": id.String(), "enabled": archived.VNC.Enabled, "port": archived.VNC.Port, "tls": archived.VNC.TLS}).Error; err != nil {
			return err
		}
	}
	if archived.RDP != nil {
		if err = tx.Table("server_rdp_configs").Create(map[string]any{"server_id": id.String(), "enabled": archived.RDP.Enabled, "port": archived.RDP.Port, "security": archived.RDP.Security, "ignore_certificate": archived.RDP.IgnoreCertificate}).Error; err != nil {
			return err
		}
	}
	return recordServerConfiguration(tx, "server_create", row, []string{"restored"})
}
