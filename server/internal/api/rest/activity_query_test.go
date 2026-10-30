package rest

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/easyssh/server/internal/domain/auditlog"
	"github.com/easyssh/shared/protocol"
	"github.com/gin-gonic/gin"
)

type cleanupQueryService struct {
	auditlog.Service
	calls int
	days  int
}

func (s *cleanupQueryService) CleanupOldLogs(_ context.Context, days int) (int64, error) {
	s.calls++
	s.days = days
	return 7, nil
}

func TestAuditCleanupRejectsMalformedRetentionBeforeDeletion(t *testing.T) {
	service := &cleanupQueryService{}
	router := gin.New()
	router.DELETE("/cleanup", NewAuditLogHandler(service).CleanupOldLogs)
	for _, value := range []string{"", "bad", "0", "-1", "3651", "999999999999999999999999"} {
		recorder := httptest.NewRecorder()
		router.ServeHTTP(recorder, httptest.NewRequest(http.MethodDelete, "/cleanup?retention_days="+value, nil))
		if recorder.Code != http.StatusBadRequest || service.calls != 0 {
			t.Fatalf("invalid retention %q reached deletion: %d calls=%d", value, recorder.Code, service.calls)
		}
	}
	for _, input := range []struct {
		query string
		days  int
	}{{"", 90}, {"?retention_days=30", 30}} {
		recorder := httptest.NewRecorder()
		router.ServeHTTP(recorder, httptest.NewRequest(http.MethodDelete, "/cleanup"+input.query, nil))
		var response protocol.AuditLogCleanupResult
		if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil || recorder.Code != http.StatusOK || response.DeletedCount != 7 || response.RetentionDays != input.days || service.days != input.days {
			t.Fatalf("cleanup result differs from contract: %s %v", recorder.Body.String(), err)
		}
	}
}

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
