package chatbridge

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/glebarez/sqlite"
	"github.com/google/uuid"
	larkim "github.com/larksuite/oapi-sdk-go/v3/service/im/v1"
	"gorm.io/gorm"
)

func TestFeishuGroupMention(t *testing.T) {
	botID, memberID := "ou_bot", "ou_member"
	botKey, memberKey := "@_user_1", "@_user_10"
	bot := &larkim.MentionEvent{Key: &botKey, Id: &larkim.UserId{OpenId: &botID}}
	member := &larkim.MentionEvent{Key: &memberKey, Id: &larkim.UserId{OpenId: &memberID}}
	text := "@_user_1 /status @_user_10"
	if _, mentioned := feishuGroupText(text, []*larkim.MentionEvent{nil, member}, botID); mentioned {
		t.Fatal("text alone or a mention of someone else must not trigger the bot")
	}
	if got, mentioned := feishuGroupText(text, []*larkim.MentionEvent{bot, member}, botID); !mentioned || got != " /status @_user_10" {
		t.Fatalf("incorrect mention removal: %q, mentioned=%v", got, mentioned)
	}
}

func TestFeishuGroupBindingIsolation(t *testing.T) {
	database, err := gorm.Open(sqlite.Open("file:"+uuid.NewString()+"?mode=memory&cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := database.AutoMigrate(&Connection{}, &Binding{}); err != nil {
		t.Fatal(err)
	}
	service := &Service{db: database}
	expires := time.Now().UTC().Add(time.Minute)
	connection := Connection{ID: "connection", Provider: ProviderFeishu, Enabled: true, BindCodeHash: hash("secret"), BindExpiresAt: &expires}
	if err := database.Create(&connection).Error; err != nil {
		t.Fatal(err)
	}
	group := incomingMessage{group: true, externalUserID: "member", externalChatID: "oc_group", text: "/bind secret"}
	if _, err := service.dispatchMessage(context.Background(), connection, group); err != nil {
		t.Fatal(err)
	}
	var stored Connection
	if err := database.First(&stored, "id = ?", connection.ID).Error; err != nil || stored.BindCodeHash != "" {
		t.Fatalf("exposed code was not invalidated: %v", err)
	}
	var binding Binding
	if err := bindingQuery(database, connection, group).First(&binding).Error; !errors.Is(err, gorm.ErrRecordNotFound) {
		t.Fatalf("public command must not create a binding: %v", err)
	}
	if err := database.Model(&connection).Updates(map[string]any{"bind_code_hash": hash("new"), "bind_expires_at": expires}).Error; err != nil {
		t.Fatal(err)
	}
	direct := incomingMessage{externalUserID: "member", externalChatID: "oc_direct", text: "/bind new oc_group"}
	calls, err := service.dispatchMessage(context.Background(), connection, direct)
	if err != nil || len(calls) != 1 || calls[0].payload["chat_id"] != direct.externalChatID {
		t.Fatalf("binding receipt should be private: %v, %v", calls, err)
	}
	if err := bindingQuery(database, connection, group).First(&binding).Error; err != nil {
		t.Fatal(err)
	}
	for _, other := range []incomingMessage{direct, {externalUserID: "member", externalChatID: "oc_other"}, {externalUserID: "other", externalChatID: "oc_group"}} {
		if err := bindingQuery(database, connection, other).First(&Binding{}).Error; !errors.Is(err, gorm.ErrRecordNotFound) {
			t.Fatalf("binding leaked outside the member/chat pair: %v", err)
		}
	}
}
