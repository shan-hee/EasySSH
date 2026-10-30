package app

import (
	"database/sql"
	"errors"
	"github.com/easyssh/shared/protocol"

	"github.com/easyssh/shared/servergroup"
	"github.com/google/uuid"
)

func desktopGroupID(id string) any {
	if id == "" {
		return nil
	}
	return id
}
func resolveDesktopServerGroup(tx *sql.Tx, row *DesktopServer) error {
	row.Group = ""
	if row.GroupID == "" {
		return nil
	}
	if !servergroup.ValidID(row.GroupID) {
		return servergroup.ErrInvalid
	}
	return tx.QueryRow("SELECT name FROM desktop_server_groups WHERE id=?", row.GroupID).Scan(&row.Group)
}
func (s *DesktopServerService) ListGroups(page, limit int) (*protocol.ServerGroupPage, error) {
	if page < 1 || page > 1000000 || limit < 1 || limit > 100 {
		return nil, servergroup.ErrInvalid
	}
	db, err := s.database()
	if err != nil {
		return nil, err
	}
	tx, err := db.Begin()
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	result := &protocol.ServerGroupPage{Items: []protocol.ServerGroup{}, Page: page, Limit: limit}
	if err := tx.QueryRow("SELECT COUNT(*) FROM desktop_server_groups").Scan(&result.Total); err != nil {
		return nil, err
	}
	rows, err := tx.Query("SELECT id,name,sort_order FROM desktop_server_groups ORDER BY sort_order,id LIMIT ? OFFSET ?", limit, (page-1)*limit)
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var row protocol.ServerGroup
		if err := rows.Scan(&row.ID, &row.Name, &row.SortOrder); err != nil {
			rows.Close()
			return nil, err
		}
		result.Items = append(result.Items, row)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return nil, err
	}
	return result, tx.Commit()
}
func (s *DesktopServerService) CreateGroup(input protocol.ServerGroupInput) (protocol.ServerGroup, error) {
	input, err := servergroup.Normalize(input)
	if err != nil {
		return protocol.ServerGroup{}, err
	}
	db, err := s.database()
	if err != nil {
		return protocol.ServerGroup{}, err
	}
	tx, err := db.Begin()
	if err != nil {
		return protocol.ServerGroup{}, err
	}
	defer tx.Rollback()
	row := protocol.ServerGroup{ID: uuid.NewString(), Name: input.Name, SortOrder: input.SortOrder}
	if _, err := tx.Exec("INSERT INTO desktop_server_groups(id,name,sort_order) VALUES(?,?,?)", row.ID, row.Name, row.SortOrder); err != nil {
		return protocol.ServerGroup{}, err
	}
	if err := recordDesktopConfiguration(tx, "server_group_created", "server_group", row.ID, row.Name, "manual", []string{"created"}, nil); err != nil {
		return protocol.ServerGroup{}, err
	}
	return row, tx.Commit()
}
func (s *DesktopServerService) UpdateGroup(id string, input protocol.ServerGroupInput) (protocol.ServerGroup, error) {
	input, err := servergroup.Normalize(input)
	if err != nil || !servergroup.ValidID(id) {
		return protocol.ServerGroup{}, servergroup.ErrInvalid
	}
	db, err := s.database()
	if err != nil {
		return protocol.ServerGroup{}, err
	}
	tx, err := db.Begin()
	if err != nil {
		return protocol.ServerGroup{}, err
	}
	defer tx.Rollback()
	var current protocol.ServerGroup
	if err := tx.QueryRow("SELECT id,name,sort_order FROM desktop_server_groups WHERE id=?", id).Scan(&current.ID, &current.Name, &current.SortOrder); err != nil {
		return protocol.ServerGroup{}, err
	}
	if current.Name == input.Name && current.SortOrder == input.SortOrder {
		return current, tx.Commit()
	}
	result, err := tx.Exec("UPDATE desktop_server_groups SET name=?,sort_order=? WHERE id=?", input.Name, input.SortOrder, id)
	if err != nil {
		return protocol.ServerGroup{}, err
	}
	if n, err := result.RowsAffected(); err != nil || n != 1 {
		return protocol.ServerGroup{}, errors.New("server group not found")
	}
	fields := []string{}
	if current.Name != input.Name {
		fields = append(fields, "name")
	}
	if current.SortOrder != input.SortOrder {
		fields = append(fields, "sort_order")
	}
	resources, err := desktopGroupResources(tx, id)
	if err != nil {
		return protocol.ServerGroup{}, err
	}
	if err := recordDesktopConfiguration(tx, "server_group_updated", "server_group", id, input.Name, "manual", fields, resources); err != nil {
		return protocol.ServerGroup{}, err
	}
	return protocol.ServerGroup{ID: id, Name: input.Name, SortOrder: input.SortOrder}, tx.Commit()
}
func (s *DesktopServerService) DeleteGroup(id string) error {
	if !servergroup.ValidID(id) {
		return servergroup.ErrInvalid
	}
	db, err := s.database()
	if err != nil {
		return err
	}
	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	var name string
	if err := tx.QueryRow("SELECT name FROM desktop_server_groups WHERE id=?", id).Scan(&name); err != nil {
		return err
	}
	resources, err := desktopGroupResources(tx, id)
	if err != nil {
		return err
	}
	if _, err := tx.Exec("DELETE FROM desktop_server_groups WHERE id=?", id); err != nil {
		return err
	}
	if err := recordDesktopConfiguration(tx, "server_group_deleted", "server_group", id, name, "manual", []string{"deleted"}, resources); err != nil {
		return err
	}
	return tx.Commit()
}
