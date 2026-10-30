package app

import (
	"encoding/json"
	"slices"
	"strings"
	"testing"

	"github.com/easyssh/shared/protocol"
	"github.com/easyssh/shared/syncdata"
)

func TestDesktopAIResetPersistsEmptyValueForSync(t *testing.T) {
	s := newDesktopSyncTestService(t)
	if err := s.ai.ResetOwnerAIConfig(); err != nil {
		t.Fatal(err)
	}
	var count int
	if err := s.servers.db.QueryRow(`SELECT COUNT(*) FROM desktop_ai_config WHERE id='local'`).Scan(&count); err != nil || count != 1 {
		t.Fatalf("explicit reset was discarded as a missing value: count=%d err=%v", count, err)
	}
	if err := s.servers.db.QueryRow(`SELECT COUNT(*) FROM desktop_configuration_events WHERE action='ai_config_updated'`).Scan(&count); err != nil || count != 0 {
		t.Fatalf("unchanged initial reset counted as configuration work: %d %v", count, err)
	}
	tx, err := s.servers.db.Begin()
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback()
	payload, err := s.captureLocalVault(tx, DesktopVaultState{Kind: "ai_config", SpaceID: "local", ID: syncdata.AIConfigID})
	if err != nil || payload == nil || payload.AIConfig == nil || payload.AIConfig.Enabled || payload.AIConfig.APIKey != "" || payload.AIConfig.Models == nil {
		t.Fatalf("reset is not a complete sync value: %+v %v", payload, err)
	}
}

func TestDesktopOwnerAIConfigEncryptsKeyAndStoresModelsArray(t *testing.T) {
	s := newDesktopSyncTestService(t)
	key := "desktop-ai-private-key"
	input := protocol.AIConfigInput{Enabled: true, Provider: "openai", APIKey: &key, Models: []string{"one", "two"}}
	public, err := s.ai.SaveOwnerAIConfig(input)
	if err != nil || !public.HasAPIKey {
		t.Fatalf("save failed: %+v %v", public, err)
	}
	var stored, models string
	if err := s.servers.db.QueryRow(`SELECT api_key,models FROM desktop_ai_config WHERE id='local'`).Scan(&stored, &models); err != nil {
		t.Fatal(err)
	}
	var names []string
	if err := json.Unmarshal([]byte(models), &names); err != nil || !slices.Equal(names, input.Models) {
		t.Fatalf("models are not a JSON array: %v", err)
	}
	if stored == key || strings.Contains(stored, key) {
		t.Fatal("API key was persisted without encryption")
	}
	input.APIKey, input.Enabled = nil, false
	if _, err := s.ai.SaveOwnerAIConfig(input); err != nil {
		t.Fatal(err)
	}
	current, err := s.ai.loadConfig()
	if err != nil || current.Enabled || current.APIKey != key {
		t.Fatalf("disabled configuration lost retained key: %v", err)
	}
	if err := s.ai.ResetOwnerAIConfig(); err != nil {
		t.Fatal(err)
	}
	public, err = s.ai.GetOwnerAIConfig()
	if err != nil || public.Enabled || public.HasAPIKey || len(public.Models) != 0 {
		t.Fatalf("reset failed: %+v %v", public, err)
	}
}
