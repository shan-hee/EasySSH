package auth

import (
	"context"
	"fmt"
	"net/url"
	"strings"
	"unicode"
	"unicode/utf8"

	"github.com/easyssh/shared/protocol"
	"github.com/google/uuid"
)

func normalizeMonitorEndpoint(value string) (string, error) {
	value = strings.TrimRight(strings.TrimSpace(value), "/")
	if value == "" {
		return "", nil
	}
	u, err := url.Parse(value)
	if err != nil || len(value) > 4096 || !utf8.ValidString(value) || (u.Scheme != "http" && u.Scheme != "https") || u.Hostname() == "" || u.User != nil || u.RawQuery != "" || u.ForceQuery || u.Fragment != "" {
		return "", fmt.Errorf("%w: monitor endpoint must be an HTTP(S) URL without credentials, query or fragment", ErrInvalidInput)
	}
	return value, nil
}

func (s *Service) UpdateMonitorDataSource(ctx context.Context, id uuid.UUID, input protocol.OwnerMonitorInput) error {
	if err := s.requireOwner(ctx, id); err != nil {
		return err
	}
	if input.Source != "easyssh" && input.Source != "nezha" && input.Source != "komari" {
		return fmt.Errorf("%w: invalid monitor data source", ErrInvalidInput)
	}
	if input.Source == "easyssh" && (input.Endpoint != nil || input.Token != nil) {
		return fmt.Errorf("%w: built-in monitoring does not accept endpoint or token", ErrInvalidInput)
	}
	return s.updateOwnerPreferences(ctx, id, func(owner Owner) (map[string]any, error) {
		values := map[string]any{}
		if input.SetActive {
			values["monitor_data_source"] = input.Source
		}
		if input.Source == "easyssh" {
			return values, nil
		}
		endpoint, savedToken := owner.NezhaAPIEndpoint, owner.NezhaAPIToken
		if input.Source == "komari" {
			endpoint, savedToken = owner.KomariAPIEndpoint, owner.KomariAPIToken
		}
		previousEndpoint := endpoint
		if input.Endpoint != nil {
			var err error
			endpoint, err = normalizeMonitorEndpoint(*input.Endpoint)
			if err != nil {
				return nil, err
			}
			values[input.Source+"_api_endpoint"] = endpoint
		}
		if (input.SetActive || owner.MonitorDataSource == input.Source) && endpoint == "" {
			return nil, fmt.Errorf("%w: active external monitoring requires an endpoint", ErrInvalidInput)
		}
		if previousEndpoint != endpoint && savedToken != "" && input.Token == nil {
			return nil, fmt.Errorf("%w: provide or explicitly clear the token when changing the monitor endpoint", ErrInvalidInput)
		}
		if input.Token != nil {
			token := strings.TrimSpace(*input.Token)
			if len(token) > 16384 || !utf8.ValidString(token) || strings.IndexFunc(token, unicode.IsControl) >= 0 {
				return nil, fmt.Errorf("%w: invalid monitor token", ErrInvalidInput)
			}
			if token != "" && endpoint == "" {
				return nil, fmt.Errorf("%w: a monitor token requires an endpoint", ErrInvalidInput)
			}
			ciphertext, err := s.encryptOwnerSecret(id, input.Source+"_api_token", token)
			if err != nil {
				return nil, err
			}
			values[input.Source+"_api_token"] = ciphertext
		}
		return values, nil
	})
}
