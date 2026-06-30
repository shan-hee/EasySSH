package rest

import (
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
)

func parseQueryTime(c *gin.Context, key string, endOfDay bool) (*time.Time, bool) {
	value := c.Query(key)
	if value == "" {
		return nil, true
	}

	if parsed, err := time.Parse(time.RFC3339, value); err == nil {
		return &parsed, true
	}

	parsed, err := time.Parse("2006-01-02", value)
	if err != nil {
		RespondError(c, http.StatusBadRequest, "invalid_"+key, "Invalid "+key)
		return nil, false
	}
	if endOfDay {
		parsed = parsed.AddDate(0, 0, 1).Add(-time.Nanosecond)
	}
	return &parsed, true
}

func firstNonEmptyQuery(c *gin.Context, keys ...string) string {
	for _, key := range keys {
		if value := c.Query(key); value != "" {
			return value
		}
	}
	return ""
}

func splitQueryValues(c *gin.Context, key string) []string {
	rawValues := c.QueryArray(key)
	if len(rawValues) == 0 {
		rawValues = []string{c.Query(key)}
	}

	values := make([]string, 0, len(rawValues))
	seen := make(map[string]struct{})
	for _, rawValue := range rawValues {
		for _, part := range strings.Split(rawValue, ",") {
			value := strings.TrimSpace(part)
			if value == "" {
				continue
			}
			if _, exists := seen[value]; exists {
				continue
			}
			seen[value] = struct{}{}
			values = append(values, value)
		}
	}
	return values
}

func setQuerySelection[T ~string](values []string, single *T, multiple *[]T) {
	switch len(values) {
	case 0:
		return
	case 1:
		*single = T(values[0])
	default:
		items := make([]T, 0, len(values))
		for _, value := range values {
			items = append(items, T(value))
		}
		*multiple = items
	}
}
