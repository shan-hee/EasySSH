package rest

import (
	"github.com/easyssh/shared/aiwire"
	"github.com/easyssh/shared/protocol"
	"github.com/gin-gonic/gin"
	"strconv"
)

func (h *AISessionHandler) History(c *gin.Context) {
	c.Header("Cache-Control", "no-store")
	input := protocol.AIHistoryInput{Kind: c.Query("kind"), AfterID: c.Query("after_id")}
	if text, ok := c.GetQuery("limit"); ok {
		value, err := strconv.Atoi(text)
		if err != nil {
			h.respondRuntimeError(c, aiwire.ErrHistoryQuery)
			return
		}
		input.Limit = value
	}
	result, err := h.manager.History(c.Request.Context(), c.Param("session_id"), input)
	if err != nil {
		h.respondRuntimeError(c, err)
		return
	}
	RespondSuccess(c, result)
}
