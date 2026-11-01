package app

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"net"
	"strconv"

	"github.com/easyssh/shared/sshutil"
	"golang.org/x/crypto/ssh"
)

func validateDesktopJumpServer(tx *sql.Tx, id, jumpID string) error {
	rows, err := tx.Query("SELECT id,COALESCE(jump_server_id,'') FROM desktop_servers")
	if err != nil {
		return err
	}
	links := map[string]string{}
	for rows.Next() {
		var serverID, parent string
		if err := rows.Scan(&serverID, &parent); err != nil {
			rows.Close()
			return err
		}
		links[serverID] = parent
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return err
	}
	links[id] = jumpID
	if err := sshutil.ValidateJumpServers(links); err != nil {
		return err
	}
	if jumpID != "" {
		var missing int
		if err := tx.QueryRow(`SELECT COUNT(*) FROM desktop_sync_records s WHERE s.kind='server' AND s.local_id=? AND NOT EXISTS (SELECT 1 FROM desktop_sync_records j WHERE j.kind='server' AND j.local_id=? AND j.space_id=s.space_id)`, id, jumpID).Scan(&missing); err != nil {
			return err
		}
		if missing > 0 {
			return errors.New("enroll the jump host in the same sync space before selecting it")
		}
	}
	return nil
}

func invalidateDesktopJumpDependents(tx *sql.Tx, id string) error {
	_, err := tx.Exec(`WITH RECURSIVE dependents(id) AS (
 SELECT id FROM desktop_servers WHERE jump_server_id=?
 UNION SELECT s.id FROM desktop_servers s JOIN dependents d ON s.jump_server_id=d.id
 ) UPDATE desktop_servers SET connection_revision=connection_revision+1,os='' WHERE id IN (SELECT id FROM dependents)`, id)
	return err
}

func (s *DesktopServerService) loadDesktopJumpServers(server *DesktopServer) error {
	seen := map[string]bool{server.ID: true}
	next := server.JumpServerID
	for next != "" {
		if seen[next] || len(server.jumpServers) >= sshutil.MaxJumpHops {
			return errors.New("invalid jump server chain")
		}
		seen[next] = true
		jump, err := s.getByIDRawDirect(next)
		if err != nil {
			return fmt.Errorf("jump server unavailable: %w", err)
		}
		server.jumpServers = append(server.jumpServers, jump)
		next = jump.JumpServerID
	}
	for i, j := 0, len(server.jumpServers)-1; i < j; i, j = i+1, j-1 {
		server.jumpServers[i], server.jumpServers[j] = server.jumpServers[j], server.jumpServers[i]
	}
	return nil
}

// Each hop authenticates with its own saved credentials. The target's temporary
// password/key is never forwarded to a jump host. Host-key policy applies to
// each real hostname; the target hostname is resolved through the SSH tunnel.
func dialDesktopSSH(ctx context.Context, server DesktopServer, config *ssh.ClientConfig, keyboard ...ssh.KeyboardInteractiveChallenge) (*ssh.Client, error) {
	if server.JumpServerID != "" && len(server.jumpServers) == 0 {
		return nil, errors.New("jump server route is unavailable")
	}
	var challenge ssh.KeyboardInteractiveChallenge
	if len(keyboard) > 0 {
		challenge = keyboard[0]
	}
	route := make([]sshutil.Hop, 0, len(server.jumpServers)+1)
	for _, jump := range server.jumpServers {
		auth, err := buildDesktopServerSSHAuthMethodsWithCredentialAndKeyboard(jump, nil, challenge)
		if err != nil {
			return nil, fmt.Errorf("jump server %s: %w", jump.Host, err)
		}
		if len(auth) == 0 {
			return nil, fmt.Errorf("jump server %s requires saved credentials", jump.Host)
		}
		jumpConfig := &ssh.ClientConfig{User: jump.Username, Auth: auth, HostKeyCallback: config.HostKeyCallback, Timeout: config.Timeout}
		if err := configureDesktopHostKeyAlgorithms(jumpConfig, jump.Host, jump.Port); err != nil {
			return nil, err
		}
		route = append(route, sshutil.Hop{Address: net.JoinHostPort(jump.Host, strconv.Itoa(jump.Port)), Config: jumpConfig})
	}
	route = append(route, sshutil.Hop{Address: net.JoinHostPort(server.Host, strconv.Itoa(server.Port)), Config: config})
	return sshutil.DialRoute(ctx, route)
}

// Keep local and synchronized IDs distinct; an unresolved dependency must never
// be serialized as a direct connection.
func desktopSyncJumpID(tx *sql.Tx, serverID, spaceID string) (string, error) {
	var local, remote string
	err := tx.QueryRow(`SELECT COALESCE(s.jump_server_id,''),COALESCE(m.remote_id,'') FROM desktop_servers s LEFT JOIN desktop_sync_records m ON m.kind='server' AND m.local_id=s.jump_server_id AND m.space_id=? WHERE s.id=?`, spaceID, serverID).Scan(&local, &remote)
	if err != nil {
		return "", err
	}
	if local != "" && remote == "" {
		return "", errors.New("enroll the jump host in the same sync space first")
	}
	return remote, nil
}

func desktopSameJumpRoute(a, b DesktopServer) bool {
	if a.JumpServerID != b.JumpServerID || len(a.jumpServers) != len(b.jumpServers) {
		return false
	}
	for i, left := range a.jumpServers {
		right := b.jumpServers[i]
		if left.ID != right.ID || left.Host != right.Host || left.Port != right.Port || left.Username != right.Username || left.AuthMethod != right.AuthMethod || left.credentialDigest() != right.credentialDigest() {
			return false
		}
	}
	return true
}
