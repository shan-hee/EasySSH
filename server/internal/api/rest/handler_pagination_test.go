package rest

import (
	"github.com/gin-gonic/gin"
	"net/http/httptest"
	"testing"
)

func TestPaginationActuallyUsesPresentQueryParameters(t *testing.T) {
	for _, sample := range []struct {
		query         string
		limit, offset int
	}{
		{"?page=3&limit=7", 7, 14}, {"", 20, 0},
		{"?page=2x&limit=7", 7, 0}, {"?page=-1&limit=0", 20, 0},
		{"?page=1000000&limit=100", 100, 99999900},
		{"?page=999999999999999999999999&limit=101", 20, 0},
	} {
		c, _ := gin.CreateTestContext(httptest.NewRecorder())
		c.Request = httptest.NewRequest("GET", "/"+sample.query, nil)
		limit, offset := GetPaginationParams(c)
		if limit != sample.limit || offset != sample.offset {
			t.Fatalf("query %s: got %d,%d expected %d,%d", sample.query, limit, offset, sample.limit, sample.offset)
		}
	}
}
