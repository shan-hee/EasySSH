package chatbridge

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/easyssh/server/internal/access"
	"github.com/easyssh/server/internal/testutil"
	"github.com/easyssh/shared/protocol"
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

type ownerAuthority struct{ testutil.AccessPolicy }

func (ownerAuthority) Authorize(context.Context, protocol.Actor, access.Requirement) error {
	return nil
}

func TestGroupRequestApprovalIsolation(t *testing.T) {
	database, err := gorm.Open(sqlite.Open("file:"+uuid.NewString()+"?mode=memory&cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := database.AutoMigrate(&Connection{}, &Binding{}, &BindRequest{}); err != nil {
		t.Fatal(err)
	}
	ownerID := uuid.NewString()
	scope, err := access.NewScope(protocol.Actor{Kind: protocol.Owner, ID: ownerID, SessionID: uuid.NewString()}, time.Now().Add(time.Hour), ownerAuthority{})
	if err != nil {
		t.Fatal(err)
	}
	ctx := access.WithScope(context.Background(), scope)
	service := &Service{db: database, replies: make(chan delivery, 4)}
	connection := Connection{ID: "connection", OwnerID: ownerID, Provider: ProviderFeishu, Enabled: true}
	if err := database.Create(&connection).Error; err != nil {
		t.Fatal(err)
	}
	group := incomingMessage{group: true, externalUserID: "member", externalChatID: "oc_group", displayName: "群 运维 · 成员", text: "hi"}
	for _, text := range []string{"hi", "still there?"} {
		group.text = text
		if calls, err := service.dispatchMessage(ctx, connection, group); err != nil || len(calls) != 1 || calls[0].payload["chat_id"] != group.externalChatID {
			t.Fatalf("unbound message should be acknowledged in place: %v, %v", calls, err)
		}
	}
	var requests []BindRequest
	if err := database.Find(&requests).Error; err != nil || len(requests) != 1 || requests[0].Message != "still there?" || !requests[0].IsGroup {
		t.Fatalf("repeated messages should refresh one group request: %+v, %v", requests, err)
	}
	if err := bindingQuery(database, connection, group).First(&Binding{}).Error; !errors.Is(err, gorm.ErrRecordNotFound) {
		t.Fatalf("a request must not bind before approval: %v", err)
	}
	if err := service.ApproveRequest(ctx, connection.ID, requests[0].ID); err != nil {
		t.Fatal(err)
	}
	if notice := <-service.replies; len(notice.calls) != 1 || notice.calls[0].payload["chat_id"] != group.externalChatID {
		t.Fatalf("approval notice should go to the requesting chat: %+v", notice)
	}
	if err := bindingQuery(database, connection, group).First(&Binding{}).Error; err != nil {
		t.Fatal(err)
	}
	if err := database.First(&BindRequest{}).Error; !errors.Is(err, gorm.ErrRecordNotFound) {
		t.Fatalf("approved request should be removed: %v", err)
	}
	for _, other := range []incomingMessage{{externalUserID: "member", externalChatID: "oc_direct"}, {externalUserID: "other", externalChatID: "oc_group"}} {
		if err := bindingQuery(database, connection, other).First(&Binding{}).Error; !errors.Is(err, gorm.ErrRecordNotFound) {
			t.Fatalf("binding leaked outside the member/chat pair: %v", err)
		}
	}
}

func TestSystemPromptServerReferences(t *testing.T) {
	allowed := "8f14e45f-ceea-467f-a0a8-4f0c9a8d7e11"
	prompt := "优先检查 :server[web%20%E4%B8%BB%E6%9C%BA]{name=" + allowed + "} 的 nginx"
	stored, err := validatePrompt(prompt, []string{allowed})
	if err != nil {
		t.Fatal(err)
	}
	text, refs, err := parsePrompt(stored)
	if err != nil || text != "优先检查 @web 主机 的 nginx" || len(refs) != 1 || refs[0].ServerID != allowed || refs[0].Offset != 5 {
		t.Fatalf("unexpected parse: %q %+v %v", text, refs, err)
	}
	if _, err := validatePrompt(prompt, []string{uuid.NewString()}); !errors.Is(err, ErrInvalid) {
		t.Fatalf("a server outside the connection scope must be rejected: %v", err)
	}
}
