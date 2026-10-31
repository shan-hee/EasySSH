package rdp

import (
	"bufio"
	"context"
	"crypto/tls"
	"errors"
	"fmt"
	"io"
	"net"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"
)

const MaxInstructionBytes = 1 << 20

// Gateway is configured by the operator, never by a browser request. guacd
// provides protocol translation; EasySSH retains authentication and target policy.
type Gateway struct {
	Address string
	TLS     bool
}

func NewGateway(address string, useTLS bool) (*Gateway, error) {
	address = strings.TrimSpace(address)
	if address != "" {
		host, port, err := net.SplitHostPort(address)
		n, parseErr := strconv.Atoi(port)
		if err != nil || host == "" || parseErr != nil || n < 1 || n > 65535 {
			return nil, errors.New("GUACD_ADDRESS must be host:port")
		}
	}
	return &Gateway{Address: address, TLS: useTLS}, nil
}
func (g *Gateway) Configured() bool { return g.Address != "" }
func (g *Gateway) Dial(ctx context.Context) (net.Conn, error) {
	if !g.Configured() {
		return nil, errors.New("RDP gateway is not configured")
	}
	d := &net.Dialer{Timeout: 10 * time.Second, KeepAlive: 30 * time.Second}
	if g.TLS {
		host, _, _ := net.SplitHostPort(g.Address)
		return (&tls.Dialer{NetDialer: d, Config: &tls.Config{MinVersion: tls.VersionTLS12, ServerName: host}}).DialContext(ctx, "tcp", g.Address)
	}
	return d.DialContext(ctx, "tcp", g.Address)
}

type Credentials struct {
	Username string `json:"username"`
	Password string `json:"password"`
	Domain   string `json:"domain"`
	Width    int    `json:"width"`
	Height   int    `json:"height"`
}

func (c Credentials) Valid() bool {
	return c.Username != "" && len(c.Username) <= 256 && len(c.Password) <= 4096 && len(c.Domain) <= 256 && !strings.ContainsRune(c.Username+c.Password+c.Domain, 0) && c.Width >= 320 && c.Width <= 3840 && c.Height >= 200 && c.Height <= 2160
}

// Guacamole lengths count Unicode characters, not UTF-8 bytes. Parsing is bounded
// before allocation and retains complete instructions across arbitrary TCP reads.
func ReadInstruction(r *bufio.Reader) ([]string, error) {
	var values []string
	budget := MaxInstructionBytes
	for len(values) < 256 {
		n := 0
		for digits := 0; ; digits++ {
			b, err := r.ReadByte()
			if err != nil {
				return nil, err
			}
			budget--
			if b == '.' && digits > 0 {
				break
			}
			if digits >= 7 || b < '0' || b > '9' {
				return nil, errors.New("invalid Guacamole length")
			}
			n = n*10 + int(b-'0')
		}
		if n > budget || budget <= 0 {
			return nil, errors.New("Guacamole instruction too large")
		}
		var value strings.Builder
		for i := 0; i < n; i++ {
			ch, size, err := r.ReadRune()
			if err != nil {
				return nil, err
			}
			if ch == utf8.RuneError && size == 1 {
				return nil, errors.New("invalid Guacamole UTF-8")
			}
			budget -= size
			if budget < 0 {
				return nil, errors.New("Guacamole instruction too large")
			}
			value.WriteRune(ch)
		}
		values = append(values, value.String())
		b, err := r.ReadByte()
		if err != nil {
			return nil, err
		}
		budget--
		if b == ';' {
			return values, nil
		}
		if b != ',' {
			return nil, errors.New("invalid Guacamole delimiter")
		}
	}
	return nil, errors.New("too many Guacamole arguments")
}
func EncodeInstruction(values ...string) string {
	var out strings.Builder
	for i, value := range values {
		if i > 0 {
			out.WriteByte(',')
		}
		fmt.Fprintf(&out, "%d.%s", utf8.RuneCountInString(value), value)
	}
	out.WriteByte(';')
	return out.String()
}

// Handshake supplies only saved targets and transient credentials. Filesystem,
// printing, audio input, recording and arbitrary gateway parameters stay disabled.
func Handshake(conn net.Conn, cfg Config, host string, creds Credentials) (*bufio.Reader, string, error) {
	reader := bufio.NewReader(conn)
	send := func(v ...string) error { _, err := io.WriteString(conn, EncodeInstruction(v...)); return err }
	if err := send("select", "rdp"); err != nil {
		return nil, "", err
	}
	args, err := ReadInstruction(reader)
	if err != nil {
		return nil, "", err
	}
	if len(args) < 2 || args[0] != "args" {
		return nil, "", errors.New("gateway did not send RDP arguments")
	}
	for _, v := range [][]string{{"size", strconv.Itoa(creds.Width), strconv.Itoa(creds.Height), "96"}, {"audio"}, {"video"}, {"image", "image/png", "image/jpeg"}} {
		if err := send(v...); err != nil {
			return nil, "", err
		}
	}
	settings := map[string]string{"hostname": host, "port": strconv.Itoa(cfg.Port), "username": creds.Username, "password": creds.Password, "domain": creds.Domain, "security": cfg.Security, "ignore-cert": strconv.FormatBool(cfg.IgnoreCertificate), "resize-method": "display-update", "enable-drive": "false", "enable-printing": "false", "enable-audio-input": "false", "disable-audio": "true", "disable-upload": "true", "disable-download": "true", "disable-copy": "false", "disable-paste": "false", "color-depth": "24"}
	connect := []string{"connect"}
	for _, arg := range args[1:] {
		if strings.HasPrefix(arg, "VERSION_") {
			connect = append(connect, "VERSION_1_5_0")
		} else {
			connect = append(connect, settings[arg])
		}
	}
	if err := send(connect...); err != nil {
		return nil, "", err
	}
	ready, err := ReadInstruction(reader)
	if err != nil {
		return nil, "", err
	}
	if len(ready) != 2 || ready[0] != "ready" {
		return nil, "", errors.New("gateway rejected RDP connection")
	}
	return reader, ready[1], nil
}

// Only browser input and clipboard streams may cross back to the established
// session. Clients cannot send a second select/connect or open drive/file streams.
func ValidClientInstruction(v []string) bool {
	if len(v) == 0 {
		return false
	}
	switch v[0] {
	case "sync":
		return len(v) >= 2 && len(v) <= 3
	case "mouse":
		return len(v) == 4
	case "key":
		return len(v) == 3
	case "size":
		if len(v) != 3 {
			return false
		}
		w, e := strconv.Atoi(v[1])
		h, f := strconv.Atoi(v[2])
		return e == nil && f == nil && w >= 320 && w <= 3840 && h >= 200 && h <= 2160
	case "clipboard":
		return len(v) == 3 && v[2] == "text/plain"
	case "blob":
		return len(v) == 3 && len(v[2]) <= 65536
	case "ack":
		return len(v) == 4
	case "end":
		return len(v) == 2
	case "disconnect", "nop":
		return len(v) == 1
	}
	return false
}
