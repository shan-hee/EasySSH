package ws

import (
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/gorilla/websocket"
)

func TestCompletedTransferAllowsLateSubscriptionAndExpires(t *testing.T) {
	gin.SetMode(gin.TestMode)
	owner := uuid.New()
	h := &SFTPTransferHandler{
		tasks:        map[string]*TransferTask{"finished": {ID: "finished", UserID: owner, Status: "completed"}},
		connections:  make(map[string]*transferProgressSocket),
		lastProgress: map[string]TransferProgressMessage{"finished": {Type: "complete", TaskID: "finished", Progress: 100}},
	}
	router := gin.New()
	router.GET("/transfer/:task_id", func(c *gin.Context) { c.Set("user_id", owner.String()); h.HandleTransferWebSocket(c) })
	server := httptest.NewServer(router)
	defer server.Close()
	h.retainCompletedTask("finished", 300*time.Millisecond)
	conn, _, err := websocket.DefaultDialer.Dial("ws"+strings.TrimPrefix(server.URL, "http")+"/transfer/finished", nil)
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close()
	conn.SetReadDeadline(time.Now().Add(time.Second))
	var progress TransferProgressMessage
	if err := conn.ReadJSON(&progress); err != nil {
		t.Fatal(err)
	}
	if progress.Type != "complete" || progress.Progress != 100 {
		t.Fatalf("unexpected final state: %+v", progress)
	}
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		h.mu.RLock()
		remaining := len(h.tasks) + len(h.lastProgress) + len(h.connections)
		h.mu.RUnlock()
		if remaining == 0 {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatal("completed task was not reclaimed after TTL")
}

func TestRetainedTransferRejectsDifferentOwner(t *testing.T) {
	h := &SFTPTransferHandler{tasks: map[string]*TransferTask{"finished": {UserID: uuid.New()}}}
	router := gin.New()
	router.GET("/transfer/:task_id", func(c *gin.Context) { c.Set("user_id", uuid.New().String()); h.HandleTransferWebSocket(c) })
	response := httptest.NewRecorder()
	router.ServeHTTP(response, httptest.NewRequest("GET", "/transfer/finished", nil))
	if response.Code != 403 {
		t.Fatalf("expected 403, got %d", response.Code)
	}
}
