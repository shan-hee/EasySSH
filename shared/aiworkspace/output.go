package aiworkspace

import (
	"context"
	"sync"
	"time"
	"unicode/utf8"

	"github.com/easyssh/shared/aitooloutput"
)

type progressKey struct{}
type Progress func(string)

func WithProgress(ctx context.Context, progress Progress) context.Context {
	return context.WithValue(ctx, progressKey{}, progress)
}

// A bounded, concurrency-safe merged stdout/stderr writer. Callbacks carry a
// complete tail snapshot so reconnects and dropped UI frames cannot duplicate it.
type Output struct {
	mu        sync.Mutex
	content   []byte
	progress  Progress
	last      time.Time
	truncated bool
}

func NewOutput(ctx context.Context) *Output {
	p, _ := ctx.Value(progressKey{}).(Progress)
	return &Output{progress: p}
}
func (o *Output) Write(p []byte) (int, error) {
	o.mu.Lock()
	defer o.mu.Unlock()
	n := len(p)
	o.content = append(o.content, p...)
	if len(o.content) > aitooloutput.StoredTextBytes {
		start := len(o.content) - aitooloutput.StoredTextBytes
		for start < len(o.content) && !utf8.RuneStart(o.content[start]) {
			start++
		}
		o.content = append([]byte(nil), o.content[start:]...)
		o.truncated = true
	}
	if o.progress != nil && time.Since(o.last) >= 100*time.Millisecond {
		o.progress(o.text(false))
		o.last = time.Now()
	}
	return n, nil
}
func (o *Output) text(final bool) string {
	content := o.content
	// SSH writes can split a UTF-8 rune. Keep the bytes for the next write,
	// but don't classify an incomplete streaming suffix as binary output.
	if !final && len(content) > 0 {
		start := len(content) - 1
		for start > 0 && !utf8.RuneStart(content[start]) {
			start--
		}
		if !utf8.FullRune(content[start:]) {
			content = content[:start]
		}
	}
	text := aitooloutput.Sanitize(string(content))
	if o.truncated {
		return "[earlier output omitted]\n" + text
	}
	return text
}
func (o *Output) String() string { o.mu.Lock(); defer o.mu.Unlock(); return o.text(true) }
func (o *Output) Flush() {
	o.mu.Lock()
	defer o.mu.Unlock()
	if o.progress != nil {
		o.progress(o.text(true))
	}
}
