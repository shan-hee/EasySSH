package geoip

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/jellydator/ttlcache/v3"
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
	httpClient *http.Client
	cache      *ttlcache.Cache[string, Location]
	mu         sync.Mutex
	retryAfter time.Time
}

func NewClient() *Client {
	return &Client{
		httpClient: &http.Client{},
		cache: ttlcache.New(
			ttlcache.WithTTL[string, Location](24*time.Hour),
			ttlcache.WithCapacity[string, Location](1024),
			ttlcache.WithDisableTouchOnHit[string, Location](),
		),
	}
}

func (c *Client) Lookup(ctx context.Context, ipOrHost string) (*Location, error) {
	// DNS 解析与 HTTP 请求共用超时，避免位置识别长时间阻塞服务器保存或登录。
	ctx, cancel := context.WithTimeout(ctx, 3*time.Second)
	defer cancel()

	ip, err := resolveIP(ctx, ipOrHost)
	if err != nil {
		return nil, err
	}
	if isLocalAddress(ip) {
		return &Location{Country: "Private Network", CountryCode: "LAN"}, nil
	}
	if c == nil {
		return nil, fmt.Errorf("geoip client is nil")
	}

	key := ip.String()
	if item := c.cache.Get(key); item != nil {
		location := item.Value()
		return &location, nil
	}
	c.mu.Lock()
	retryAfter := c.retryAfter
	c.mu.Unlock()
	if time.Now().Before(retryAfter) {
		return nil, fmt.Errorf("ipwho.is rate limit exceeded; retry after %s", retryAfter.Format(time.RFC3339))
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodGet,
		"https://ipwho.is/"+key+"?fields=success,message,country,country_code,region,city", nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Accept", "application/json")
	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("ipwho.is lookup failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode == http.StatusTooManyRequests {
		retryAfter := rateLimitReset(resp.Header.Get("Retry-After"))
		c.mu.Lock()
		if retryAfter.After(c.retryAfter) {
			c.retryAfter = retryAfter
		}
		c.mu.Unlock()
		return nil, fmt.Errorf("ipwho.is rate limit exceeded; retry after %s", retryAfter.Format(time.RFC3339))
	}
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("ipwho.is returned HTTP %d", resp.StatusCode)
	}
	var result struct {
		Success bool   `json:"success"`
		Message string `json:"message"`
		Location
	}
	if err := json.NewDecoder(io.LimitReader(resp.Body, 64*1024)).Decode(&result); err != nil {
		return nil, fmt.Errorf("invalid ipwho.is response: %w", err)
	}
	if !result.Success {
		return nil, fmt.Errorf("ipwho.is lookup failed: %s", result.Message)
	}
	if len(result.CountryCode) != 2 || result.Country == "" {
		return nil, fmt.Errorf("ipwho.is returned incomplete country information")
	}
	c.cache.Set(key, result.Location, ttlcache.DefaultTTL)
	return &result.Location, nil
}

func rateLimitReset(value string) time.Time {
	now := time.Now()
	if seconds, err := strconv.ParseInt(value, 10, 32); err == nil && seconds >= 0 {
		return now.Add(time.Duration(seconds) * time.Second)
	}
	if reset, err := http.ParseTime(value); err == nil && reset.After(now) {
		return reset
	}
	// 免费接口按天限额；缺少 Retry-After 时暂停一天，不继续消耗请求。
	return now.Add(24 * time.Hour)
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
