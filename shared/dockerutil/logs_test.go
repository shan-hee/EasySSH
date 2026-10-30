package dockerutil

import (
	"bytes"
	"encoding/binary"
	"errors"
	"io"
	"testing"
)

func TestDockerLogsRejectOversizedFrameBeforeReadingPayload(t *testing.T) {
	var frame [8]byte
	frame[0] = 1
	binary.BigEndian.PutUint32(frame[4:], ^uint32(0))
	if _, err := readDockerLogs(bytes.NewReader(frame[:]), false); !errors.Is(err, ErrLogLimit) {
		t.Fatalf("oversized advertised frame was not rejected: %v", err)
	}
}

func TestDockerLogsAreBoundedAcrossFramesAndTTY(t *testing.T) {
	for _, tty := range []bool{false, true} {
		body := bytes.Repeat([]byte("a"), MaxLogBytes)
		var input bytes.Buffer
		if tty {
			input.Write(body)
		} else {
			for _, part := range [][]byte{body[:MaxLogBytes/2], body[MaxLogBytes/2:]} {
				header := []byte{1, 0, 0, 0, 0, 0, 0, 0}
				binary.BigEndian.PutUint32(header[4:], uint32(len(part)))
				input.Write(header)
				input.Write(part)
			}
		}
		valid := append([]byte(nil), input.Bytes()...)
		if output, err := readDockerLogs(bytes.NewReader(valid), tty); err != nil || len(output) != MaxLogBytes {
			t.Fatalf("boundary tty=%t: %d %v", tty, len(output), err)
		}
		if tty {
			input.WriteByte('x')
		} else {
			input.Write([]byte{2, 0, 0, 0, 0, 0, 0, 1, 'x'})
		}
		if _, err := readDockerLogs(&input, tty); !errors.Is(err, ErrLogLimit) {
			t.Fatalf("aggregate limit tty=%t: %v", tty, err)
		}
	}
	if _, err := readDockerLogs(bytes.NewReader([]byte{1, 0}), false); !errors.Is(err, io.ErrUnexpectedEOF) {
		t.Fatalf("accepted incomplete header: %v", err)
	}
}
