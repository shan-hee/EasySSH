package app

import (
	"github.com/easyssh/shared/protocol"
	"github.com/google/uuid"
)

// Attribution for this native owner's process, never authentication. Remote
// windows are excluded by desktopNativeBoundary and keep their source Actor.
var desktopOwnerProcessActor = protocol.Actor{Kind: protocol.Owner, ID: "local_owner", SessionID: uuid.NewString()}

func desktopLocalActor() protocol.Actor { return desktopOwnerProcessActor }
