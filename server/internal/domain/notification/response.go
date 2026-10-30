package notification

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
)

// Both robot APIs acknowledge application errors with HTTP 200. A missing
// errcode is not an acknowledgement; do not mark such deliveries successful.
func checkRobotResponse(resp *http.Response) error {
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("notification provider returned HTTP %d", resp.StatusCode)
	}
	body, err := io.ReadAll(io.LimitReader(resp.Body, (64<<10)+1))
	if err != nil {
		return fmt.Errorf("read notification response: %w", err)
	}
	if len(body) > 64<<10 {
		return fmt.Errorf("notification provider response is too large")
	}
	var result struct {
		Code *int `json:"errcode"`
	}
	if err := json.Unmarshal(body, &result); err != nil || result.Code == nil {
		return fmt.Errorf("notification provider returned an invalid acknowledgement")
	}
	if *result.Code != 0 {
		return fmt.Errorf("notification provider rejected message (code %d)", *result.Code)
	}
	return nil
}

// Delivery errors are persisted and displayed. Do not include a provider URL
// (which may contain credentials) or an echoed provider response body.
func notificationRequestError(err error) error {
	if errors.Is(err, context.Canceled) {
		return context.Canceled
	}
	if errors.Is(err, context.DeadlineExceeded) {
		return context.DeadlineExceeded
	}
	var networkError net.Error
	if errors.As(err, &networkError) && networkError.Timeout() {
		return fmt.Errorf("notification request timed out")
	}
	return fmt.Errorf("notification request failed")
}
