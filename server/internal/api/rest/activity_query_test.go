package rest

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
)

func TestActivityQueriesRejectInvalidBoundsAndReversedDates(t *testing.T) {
	parsers := map[string]func(*gin.Context) bool{
		"operation-list": func(c *gin.Context) bool { _, ok := parseOperationRecordListRequest(c); return ok },
		"audit-list":     func(c *gin.Context) bool { _, ok := parseAuditLogListRequest(c); return ok },
		"operation-statistics": func(c *gin.Context) bool {
			_, ok := parseOperationRecordStatisticsRequest(c)
			return ok
		},
		"audit-statistics": func(c *gin.Context) bool { _, ok := parseAuditLogStatisticsRequest(c); return ok },
	}
	for name, parse := range parsers {
		t.Run(name, func(t *testing.T) {
			queries := []string{"start_date=2026-10-31&end_date=2026-10-30"}
			if name == "operation-list" || name == "audit-list" {
				queries = append(queries, "page=bad", "page=0", "page=1000001", "page_size=101", "page_size=")
			} else {
				queries = append(queries, "days=bad", "days=0", "days=366", "days=")
			}
			for _, query := range queries {
				recorder := httptest.NewRecorder()
				ctx, _ := gin.CreateTestContext(recorder)
				ctx.Request = httptest.NewRequest(http.MethodGet, "/?"+query, nil)
				if parse(ctx) || recorder.Code != http.StatusBadRequest {
					t.Fatalf("invalid query accepted: %s", query)
				}
			}
		})
	}
}
