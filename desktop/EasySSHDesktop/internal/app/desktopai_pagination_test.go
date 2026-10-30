package app

import (
	"context"
	"database/sql"
	"fmt"
	"path/filepath"
	"testing"
)

func TestDesktopAISessionPaginationAndScope(t *testing.T) {
	db, err := sql.Open("sqlite", filepath.Join(t.TempDir(), "ai.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.Close() })
	if err := configureDesktopDatabase(db); err != nil {
		t.Fatal(err)
	}
	service := &DesktopAIService{db: db}
	for i := 0; i < 70; i++ {
		stamp := fmt.Sprintf("2026-10-03T00:%02d:%02dZ", i/60, i%60)
		scope := fmt.Sprintf(`{"kind":"terminal","terminal_session_id":"terminal-%d","server_id":"server-1"}`, i%2)
		err := service.saveSessionRaw(context.Background(), desktopAISessionRecord{ID: fmt.Sprintf("session-%02d", i), ConfigSpaceID: "local", Title: "Stored title", CustomTitle: true, Scope: decodeDesktopAIScope(scope), Status: DesktopAISessionIdle, Messages: []DesktopAIMessageView{{ID: "user", Role: "user", Content: "needle"}, {ID: "reply", Role: "assistant", Content: "answer"}}, Tasks: []DesktopAITaskView{{ID: "task-1"}}, CreatedAt: stamp, UpdatedAt: stamp})
		if err != nil {
			t.Fatal(err)
		}
	}
	for _, tc := range []struct {
		name   string
		params DesktopAIListSessionsParams
		total  int
	}{
		{"all", DesktopAIListSessionsParams{}, 70},
		{"scope and body search", DesktopAIListSessionsParams{ScopeKind: "terminal", TerminalSessionID: "terminal-0", ServerID: "server-1", Q: "NEEDLE"}, 35},
	} {
		t.Run(tc.name, func(t *testing.T) {
			seen := map[string]bool{}
			for page := 1; page <= (tc.total+29)/30+1; page++ {
				params := tc.params
				params.Page, params.Limit = page, 30
				result, err := service.ListSessions(params)
				if err != nil {
					t.Fatal(err)
				}
				want := min(30, max(0, tc.total-(page-1)*30))
				if result.Total != tc.total || len(result.Items) != want {
					t.Fatalf("page %d: total=%d, length=%d, want total=%d, length=%d", page, result.Total, len(result.Items), tc.total, want)
				}
				for _, item := range result.Items {
					if seen[item.ID] {
						t.Fatalf("duplicate session %s", item.ID)
					}
					seen[item.ID] = true
					if item.MessageCount != 2 || item.TaskCount != 1 || item.Title != "Stored title" {
						t.Fatalf("incorrect summary: %+v", item)
					}
					if tc.params.TerminalSessionID != "" && item.Scope.TerminalSessionID != tc.params.TerminalSessionID {
						t.Fatalf("scope leaked: %+v", item.Scope)
					}
				}
			}
			if len(seen) != tc.total {
				t.Fatalf("got %d unique sessions, want %d", len(seen), tc.total)
			}
		})
	}
}
