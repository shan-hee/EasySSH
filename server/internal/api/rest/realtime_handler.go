package rest

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"time"

	"github.com/easyssh/server/internal/domain/realtime"
	"github.com/gin-gonic/gin"
)

type RealtimeHandler struct{ hub *realtime.Hub }

func NewRealtimeHandler(hub *realtime.Hub) *RealtimeHandler {
	return &RealtimeHandler{hub: hub}
}

func (h *RealtimeHandler) Stream(c *gin.Context) {
	subscription, err := h.hub.Subscribe(c.Request.Context())
	if err != nil {
		accessError(c, err)
		return
	}
	defer subscription.Close()
	flusher, ok := c.Writer.(http.Flusher)
	if !ok {
		RespondError(c, http.StatusInternalServerError, "streaming_unsupported", "Streaming is not supported")
		return
	}

	controller := http.NewResponseController(c.Writer)
	stopWrite := context.AfterFunc(subscription.Context(), func() { _ = controller.SetWriteDeadline(time.Now()) })
	defer stopWrite()
	c.Header("Content-Type", "text/event-stream")
	c.Header("Cache-Control", "no-cache")
	c.Header("Connection", "keep-alive")
	c.Header("X-Accel-Buffering", "no")
	c.Status(http.StatusOK)
	flusher.Flush()

	events := subscription.Events
	heartbeat := time.NewTicker(15 * time.Second)
	defer heartbeat.Stop()

	for {
		select {
		case event := <-events:
			if subscription.Context().Err() != nil {
				return
			}
			_ = controller.SetWriteDeadline(time.Now().Add(10 * time.Second))
			data, err := json.Marshal(event)
			if err != nil {
				continue
			}
			if _, err := fmt.Fprintf(c.Writer, "id: %s\nevent: %s\ndata: %s\n\n", event.ID, event.Type, data); err != nil {
				return
			}
			flusher.Flush()
		case <-heartbeat.C:
			if subscription.Context().Err() != nil {
				return
			}
			_ = controller.SetWriteDeadline(time.Now().Add(10 * time.Second))
			if _, err := fmt.Fprint(c.Writer, ": heartbeat\n\n"); err != nil {
				return
			}
			flusher.Flush()
		case <-subscription.Context().Done():
			return
		}
	}
}
