package runtime

import (
	"github.com/easyssh/shared/protocol"

	"gorm.io/gorm"
)

// A conversation belongs to its creator. Owner browser sessions share the same
// private history; each visitor access session is a separate history boundary.
func sameConversationActor(a, b protocol.Actor) bool {
	if !a.Valid() || !b.Valid() {
		return false
	}
	if a.Kind == protocol.Owner && b.Kind == protocol.Owner {
		return a.ID == b.ID
	}
	return a == b
}

func exactActorQuery(db *gorm.DB, actor protocol.Actor) *gorm.DB {
	if !actor.Valid() {
		return db.Where("1 = 0")
	}
	return db.Where("actor_kind = ? AND actor_id = ? AND actor_session_id = ? AND actor_grant_id = ?", actor.Kind, actor.ID, actor.SessionID, actor.GrantID)
}

func conversationQuery(db *gorm.DB, actor protocol.Actor) *gorm.DB {
	if actor.Valid() && actor.Kind == protocol.Owner {
		return db.Where("actor_kind = ? AND actor_id = ? AND actor_grant_id = ''", protocol.Owner, actor.ID)
	}
	return exactActorQuery(db, actor)
}
