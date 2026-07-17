package mailclient

import (
	"crypto/tls"
	"time"

	mail "github.com/wneessen/go-mail"
)

type Config struct {
	Host     string
	Port     int
	Username string
	Password string
	UseTLS   bool
	Timeout  time.Duration
}

func New(config Config) (*mail.Client, error) {
	timeout := config.Timeout
	if timeout <= 0 {
		timeout = 10 * time.Second
	}

	options := []mail.Option{
		mail.WithPort(config.Port),
		mail.WithTimeout(timeout),
	}

	if config.UseTLS {
		options = append(options,
			mail.WithSSL(),
			mail.WithTLSConfig(&tls.Config{MinVersion: tls.VersionTLS12, ServerName: config.Host}),
		)
	} else {
		options = append(options, mail.WithTLSPolicy(mail.NoTLS))
	}

	if config.Username != "" {
		authType := mail.SMTPAuthPlain
		if !config.UseTLS {
			authType = mail.SMTPAuthPlainNoEnc
		}
		options = append(options,
			mail.WithUsername(config.Username),
			mail.WithPassword(config.Password),
			mail.WithSMTPAuth(authType),
		)
	}

	return mail.NewClient(config.Host, options...)
}
