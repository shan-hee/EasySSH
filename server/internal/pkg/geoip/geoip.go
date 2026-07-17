package geoip

import (
	"context"
	"fmt"
	"net"
	"strings"

	"github.com/oschwald/geoip2-golang"
)

type Location struct {
	Country     string `json:"country"`
	CountryCode string `json:"country_code"`
	Region      string `json:"region"`
	City        string `json:"city"`
}

func (l *Location) String() string {
	if l == nil {
		return ""
	}
	if l.City != "" && l.Region != "" {
		return fmt.Sprintf("%s, %s", l.City, l.Region)
	}
	if l.City != "" {
		return l.City
	}
	if l.Region != "" {
		return l.Region
	}
	return l.Country
}

type Client struct {
	databasePath string
	reader       *geoip2.Reader
	openErr      error
}

func NewClient(databasePath string) *Client {
	databasePath = strings.TrimSpace(databasePath)
	client := &Client{databasePath: databasePath}
	if databasePath == "" {
		client.openErr = fmt.Errorf("geoip database path is empty")
		return client
	}
	client.reader, client.openErr = geoip2.Open(databasePath)
	return client
}

func (c *Client) DatabaseAvailable() bool {
	return c != nil && c.reader != nil
}

func (c *Client) DatabasePath() string {
	if c == nil {
		return ""
	}
	return c.databasePath
}

func (c *Client) OpenError() error {
	if c == nil {
		return fmt.Errorf("geoip client is nil")
	}
	return c.openErr
}

func (c *Client) Close() error {
	if c == nil || c.reader == nil {
		return nil
	}
	return c.reader.Close()
}

func (c *Client) Lookup(ctx context.Context, ipOrHost string) (*Location, error) {
	ip, err := resolveIP(ctx, ipOrHost)
	if err != nil {
		return nil, err
	}
	if isLocalAddress(ip) {
		return &Location{Country: "Private Network", CountryCode: "LAN"}, nil
	}
	if c == nil || c.reader == nil {
		return &Location{}, nil
	}

	record, err := c.reader.City(ip)
	if err != nil {
		return nil, err
	}
	region := ""
	if len(record.Subdivisions) > 0 {
		region = localizedName(record.Subdivisions[0].Names)
	}
	return &Location{
		Country:     localizedName(record.Country.Names),
		CountryCode: record.Country.IsoCode,
		Region:      region,
		City:        localizedName(record.City.Names),
	}, nil
}

func resolveIP(ctx context.Context, ipOrHost string) (net.IP, error) {
	ipOrHost = strings.TrimSpace(ipOrHost)
	if ipOrHost == "" {
		return nil, fmt.Errorf("ip or host is required")
	}
	if ip := net.ParseIP(ipOrHost); ip != nil {
		return ip, nil
	}
	addresses, err := net.DefaultResolver.LookupIP(ctx, "ip", ipOrHost)
	if err != nil || len(addresses) == 0 {
		if err != nil {
			return nil, fmt.Errorf("failed to resolve host %q: %w", ipOrHost, err)
		}
		return nil, fmt.Errorf("failed to resolve host %q", ipOrHost)
	}
	for _, address := range addresses {
		if address.To4() != nil {
			return address, nil
		}
	}
	return addresses[0], nil
}

func isLocalAddress(ip net.IP) bool {
	return ip.IsPrivate() || ip.IsLoopback() || ip.IsLinkLocalUnicast() || ip.IsUnspecified()
}

func localizedName(names map[string]string) string {
	if value := names["en"]; value != "" {
		return value
	}
	if value := names["zh-CN"]; value != "" {
		return value
	}
	for _, value := range names {
		return value
	}
	return ""
}
