//go:build js && wasm

package main

import (
	"context"
	"errors"
	"io"
	"net"
	"os"
	"sync"
	"syscall/js"
	"time"
)

// socketConn adapts binary WebSocket messages to a bounded SSH byte stream.
// Browser callbacks never block: a peer exceeding the receive budget is closed.
type socketConn struct {
	ws              js.Value
	callbacks       []js.Func
	chunks          chan []byte
	done            chan struct{}
	opened          chan struct{}
	once            sync.Once
	openOnce        sync.Once
	readMu          sync.Mutex
	writeMu         sync.Mutex
	mu              sync.Mutex
	remaining       []byte
	readDeadline    time.Time
	writeDeadline   time.Time
	deadlineChanged chan struct{}
}

func dialSocket(ctx context.Context, address string) (*socketConn, error) {
	c := &socketConn{chunks: make(chan []byte, 64), done: make(chan struct{}), opened: make(chan struct{}), deadlineChanged: make(chan struct{})}
	c.ws = js.Global().Get("WebSocket").New(address)
	c.ws.Set("binaryType", "arraybuffer")
	onOpen := js.FuncOf(func(js.Value, []js.Value) any {
		c.openOnce.Do(func() { close(c.opened) })
		return nil
	})
	onMessage := js.FuncOf(func(_ js.Value, args []js.Value) any {
		data := args[0].Get("data")
		if !data.InstanceOf(js.Global().Get("ArrayBuffer")) || data.Get("byteLength").Int() > 256<<10 {
			_ = c.Close()
			return nil
		}
		chunk := make([]byte, data.Get("byteLength").Int())
		js.CopyBytesToGo(chunk, js.Global().Get("Uint8Array").New(data))
		select {
		case c.chunks <- chunk:
		default:
			_ = c.Close()
		}
		return nil
	})
	onClose := js.FuncOf(func(js.Value, []js.Value) any { _ = c.Close(); return nil })
	c.callbacks = []js.Func{onOpen, onMessage, onClose}
	c.ws.Set("onopen", onOpen)
	c.ws.Set("onmessage", onMessage)
	c.ws.Set("onerror", onClose)
	c.ws.Set("onclose", onClose)
	select {
	case <-c.opened:
		return c, nil
	case <-c.done:
		return nil, errors.New("SSH relay unavailable; check target policy, ticket and permissions")
	case <-ctx.Done():
		c.Close()
		return nil, ctx.Err()
	}
}

func (c *socketConn) Read(p []byte) (int, error) {
	c.readMu.Lock()
	defer c.readMu.Unlock()
	if len(p) == 0 {
		return 0, nil
	}
	for {
		if len(c.remaining) > 0 {
			n := copy(p, c.remaining)
			c.remaining = c.remaining[n:]
			return n, nil
		}
		c.mu.Lock()
		deadline, changed := c.readDeadline, c.deadlineChanged
		c.mu.Unlock()
		var timeout <-chan time.Time
		var timer *time.Timer
		if !deadline.IsZero() {
			if !time.Now().Before(deadline) {
				return 0, os.ErrDeadlineExceeded
			}
			timer = time.NewTimer(time.Until(deadline))
			timeout = timer.C
		}
		select {
		case c.remaining = <-c.chunks:
		case <-c.done:
			if timer != nil {
				timer.Stop()
			}
			select {
			case c.remaining = <-c.chunks:
				continue
			default:
				return 0, io.EOF
			}
		case <-timeout:
			return 0, os.ErrDeadlineExceeded
		case <-changed:
		}
		if timer != nil {
			timer.Stop()
		}
	}
}

func (c *socketConn) Write(p []byte) (written int, err error) {
	c.writeMu.Lock()
	defer c.writeMu.Unlock()
	defer func() {
		if recover() != nil {
			c.Close()
			err = net.ErrClosed
		}
	}()
	for len(p) > 0 {
		select {
		case <-c.done:
			return written, net.ErrClosed
		default:
		}
		c.mu.Lock()
		deadline := c.writeDeadline
		c.mu.Unlock()
		if !deadline.IsZero() && !time.Now().Before(deadline) {
			return written, os.ErrDeadlineExceeded
		}
		if c.ws.Get("readyState").Int() != 1 {
			return written, net.ErrClosed
		}
		if c.ws.Get("bufferedAmount").Int() > 1<<20 {
			select {
			case <-c.done:
				return written, net.ErrClosed
			case <-time.After(10 * time.Millisecond):
			}
			continue
		}
		n := min(len(p), 32<<10)
		data := js.Global().Get("Uint8Array").New(n)
		js.CopyBytesToJS(data, p[:n])
		c.ws.Call("send", data)
		p = p[n:]
		written += n
	}
	return written, nil
}

func (c *socketConn) Close() error {
	c.once.Do(func() {
		close(c.done)
		for _, name := range []string{"onopen", "onmessage", "onerror", "onclose"} {
			c.ws.Set(name, js.Null())
		}
		c.ws.Call("close")
		for _, callback := range c.callbacks {
			callback.Release()
		}
	})
	return nil
}

type socketAddress string

func (a socketAddress) Network() string    { return "websocket" }
func (a socketAddress) String() string     { return string(a) }
func (c *socketConn) LocalAddr() net.Addr  { return socketAddress("browser") }
func (c *socketConn) RemoteAddr() net.Addr { return socketAddress("ssh-relay") }
func (c *socketConn) SetDeadline(t time.Time) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.readDeadline, c.writeDeadline = t, t
	close(c.deadlineChanged)
	c.deadlineChanged = make(chan struct{})
	return nil
}
func (c *socketConn) SetReadDeadline(t time.Time) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.readDeadline = t
	close(c.deadlineChanged)
	c.deadlineChanged = make(chan struct{})
	return nil
}
func (c *socketConn) SetWriteDeadline(t time.Time) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.writeDeadline = t
	close(c.deadlineChanged)
	c.deadlineChanged = make(chan struct{})
	return nil
}
