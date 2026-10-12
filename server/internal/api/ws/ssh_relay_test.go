package ws

import (
	"context"
	"io"
	"net"
	"net/netip"
	"testing"
	"time"
)

func TestRelayDefaultsDenyAllTargets(t *testing.T) {
	h := NewSSHRelayHandler(nil, nil, 0, nil, []int{22})
	if _, err := h.dial(context.Background(), "127.0.0.1", 22); err == nil {
		t.Fatal("relay without configured networks allowed a target")
	}
}

func TestRelayUsesOnlyPermittedNumericAddressesAndPorts(t *testing.T) {
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer listener.Close()
	port := listener.Addr().(*net.TCPAddr).Port
	h := NewSSHRelayHandler(nil, nil, 0, []netip.Prefix{netip.MustParsePrefix("127.0.0.1/32")}, []int{port})
	if h.allowed(netip.MustParseAddr("127.0.0.2")) || h.allowed(netip.MustParseAddr("169.254.169.254")) {
		t.Fatal("relay accepted an address outside its policy")
	}
	if _, err := h.dial(context.Background(), "localhost", port+1); err == nil {
		t.Fatal("relay accepted an unlisted port")
	}
	done := make(chan struct{})
	go func() {
		defer close(done)
		stream, err := listener.Accept()
		if err != nil {
			return
		}
		defer stream.Close()
		_ = stream.SetDeadline(time.Now().Add(3 * time.Second))
		_, _ = io.WriteString(stream, "SSH-2.0-test\r\n")
	}()
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	stream, err := h.dial(ctx, "localhost", port)
	if err != nil {
		t.Fatal(err)
	}
	defer stream.Close()
	_ = stream.SetReadDeadline(time.Now().Add(time.Second))
	value, err := io.ReadAll(stream)
	if err != nil || string(value) != "SSH-2.0-test\r\n" {
		t.Fatalf("unexpected relay data: %q, %v", value, err)
	}
	<-done
}

func TestRelayConnectionBudgetsReleasePerUser(t *testing.T) {
	h := NewSSHRelayHandler(nil, nil, 0, nil, nil)
	for i := 0; i < 8; i++ {
		if !h.acquire("user") {
			t.Fatal("unexpected early limit")
		}
	}
	if h.acquire("user") {
		t.Fatal("per-user connection limit not enforced")
	}
	h.release("user")
	if !h.acquire("user") {
		t.Fatal("released slot was not reusable")
	}
	for i := 0; i < 8; i++ {
		h.release("user")
	}
	if h.total != 0 || len(h.active) != 0 {
		t.Fatal("connection budget leaked")
	}
}
