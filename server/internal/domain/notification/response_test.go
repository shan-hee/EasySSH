package notification

import (
	"context"
	"errors"
	"io"
	"net/http"
	"net/url"
	"strings"
	"testing"
)

func TestRobotResponseRequiresSuccessCodeAndHTTP(t *testing.T) {
	for _, tc := range []struct {
		status  int
		body    string
		success bool
	}{
		{200, `{"errcode":0}`, true},
		{500, `{"errcode":0}`, false},
		{200, `{"errcode":1,"errmsg":"secret-token"}`, false},
		{200, `{}`, false},
		{200, `null`, false},
		{200, `{"errcode":"0"}`, false},
		{200, strings.Repeat(" ", 64<<10) + `{"errcode":0}`, false},
	} {
		err := checkRobotResponse(&http.Response{StatusCode: tc.status, Body: io.NopCloser(strings.NewReader(tc.body))})
		if (err == nil) != tc.success {
			t.Fatalf("HTTP %d: success=%v, err=%v", tc.status, tc.success, err)
		}
		if err != nil && strings.Contains(err.Error(), "secret-token") {
			t.Fatal("provider response leaked in error")
		}
	}
}

func TestNotificationTransportErrorHidesToken(t *testing.T) {
	err := notificationRequestError(&url.Error{Op: "Post", URL: "https://example.test/?token=private", Err: errors.New("redirect to private URL failed")})
	if strings.Contains(err.Error(), "private") {
		t.Fatal("transport error leaked credential")
	}
	if !errors.Is(notificationRequestError(&url.Error{Err: context.Canceled}), context.Canceled) {
		t.Fatal("cancellation was lost")
	}
}
