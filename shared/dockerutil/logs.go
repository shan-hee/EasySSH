package dockerutil

import (
	"bytes"
	"encoding/binary"
	"errors"
	"fmt"
	"io"
)

const MaxLogBytes = 2 << 20

var ErrLogLimit = errors.New("Docker logs exceed the 2 MiB response limit; request fewer lines")

// Validate the multiplexed frame size before reading its payload. Limiting only
// the final writer does not prevent a decoder allocating an advertised 4 GiB frame.
func readDockerLogs(reader io.Reader, tty bool) ([]byte, error) {
	if tty {
		data, err := io.ReadAll(io.LimitReader(reader, MaxLogBytes+1))
		if err != nil {
			return nil, err
		}
		if len(data) > MaxLogBytes {
			return nil, ErrLogLimit
		}
		return data, nil
	}
	var output bytes.Buffer
	var header [8]byte
	for {
		n, err := io.ReadFull(reader, header[:])
		if err == io.EOF && n == 0 {
			return output.Bytes(), nil
		}
		if err != nil {
			return nil, err
		}
		if header[0] != 1 && header[0] != 2 && header[0] != 3 || header[1] != 0 || header[2] != 0 || header[3] != 0 {
			return nil, errors.New("invalid Docker log stream header")
		}
		length := binary.BigEndian.Uint32(header[4:])
		if uint64(length) > uint64(MaxLogBytes-output.Len()) {
			return nil, ErrLogLimit
		}
		if header[0] == 3 {
			data := make([]byte, int(length))
			if _, err = io.ReadFull(reader, data); err != nil {
				return nil, err
			}
			return nil, fmt.Errorf("Docker log stream error: %s", data)
		}
		if _, err = io.CopyN(&output, reader, int64(length)); err != nil {
			return nil, err
		}
	}
}
