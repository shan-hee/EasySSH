package main

func (s *DesktopSyncService) SessionCandidates() ([]DesktopSyncCandidate, error) {
	db, err := s.database()
	if err != nil {
		return nil, err
	}
	rows, err := db.Query(`SELECT a.id,a.title,COALESCE(v.space_id,''),COALESCE(p.account_name,''),COALESCE(p.server_url,'') FROM desktop_ai_sessions a LEFT JOIN desktop_sync_vault v ON v.kind='ai_session' AND v.local_id=a.id LEFT JOIN desktop_sync_spaces p ON p.id=v.space_id ORDER BY a.updated_at DESC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := []DesktopSyncCandidate{}
	for rows.Next() {
		var c DesktopSyncCandidate
		if err = rows.Scan(&c.Key, &c.Name, &c.SpaceID, &c.AccountName, &c.ServerURL); err != nil {
			return nil, err
		}
		c.Key = "ai_session/" + c.Key
		result = append(result, c)
	}
	return result, rows.Err()
}
