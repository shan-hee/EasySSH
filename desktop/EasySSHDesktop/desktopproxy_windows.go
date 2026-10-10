package main

import (
	"fmt"
	"net/http"
	"net/url"
	"path"
	"runtime"
	"strings"
	"unsafe"

	"golang.org/x/sys/windows"
)

var (
	desktopWinHTTP         = windows.NewLazySystemDLL("winhttp.dll")
	desktopGetIEProxy      = desktopWinHTTP.NewProc("WinHttpGetIEProxyConfigForCurrentUser")
	desktopWinHTTPOpen     = desktopWinHTTP.NewProc("WinHttpOpen")
	desktopWinHTTPClose    = desktopWinHTTP.NewProc("WinHttpCloseHandle")
	desktopGetProxyForURL  = desktopWinHTTP.NewProc("WinHttpGetProxyForUrl")
	desktopWinHTTPTimeouts = desktopWinHTTP.NewProc("WinHttpSetTimeouts")
	desktopProxyGlobalFree = windows.NewLazySystemDLL("kernel32.dll").NewProc("GlobalFree")
)

type desktopIEProxyConfig struct {
	AutoDetect    uint32
	AutoConfigURL *uint16
	Proxy         *uint16
	ProxyBypass   *uint16
}

type desktopAutoProxyOptions struct {
	Flags                 uint32
	AutoDetectFlags       uint32
	AutoConfigURL         *uint16
	Reserved              uintptr
	ReservedFlags         uint32
	AutoLogonIfChallenged uint32
}

type desktopWinHTTPProxyInfo struct {
	AccessType  uint32
	Proxy       *uint16
	ProxyBypass *uint16
}

func freeDesktopProxyString(value *uint16) {
	if value != nil {
		desktopProxyGlobalFree.Call(uintptr(unsafe.Pointer(value)))
	}
}

// WinHTTP reads the current user's Windows Internet Settings, including PAC,
// automatic discovery, protocol-specific proxies and the bypass list.
func desktopSystemProxy(req *http.Request) (*url.URL, error) {
	if err := req.Context().Err(); err != nil {
		return nil, err
	}
	var config desktopIEProxyConfig
	ok, _, callErr := desktopGetIEProxy.Call(uintptr(unsafe.Pointer(&config)))
	if ok == 0 {
		return nil, fmt.Errorf("read Windows system proxy: %w", callErr)
	}
	defer freeDesktopProxyString(config.AutoConfigURL)
	defer freeDesktopProxyString(config.Proxy)
	defer freeDesktopProxyString(config.ProxyBypass)
	proxy := windows.UTF16PtrToString(config.Proxy)
	bypass := windows.UTF16PtrToString(config.ProxyBypass)

	if config.AutoConfigURL != nil || config.AutoDetect != 0 {
		agent, _ := windows.UTF16PtrFromString("EasySSH")
		// WINHTTP_ACCESS_TYPE_NO_PROXY: PAC retrieval is handled by WinHTTP.
		handle, _, err := desktopWinHTTPOpen.Call(uintptr(unsafe.Pointer(agent)), 1, 0, 0, 0)
		runtime.KeepAlive(agent)
		if handle == 0 {
			return nil, fmt.Errorf("initialize Windows proxy resolver: %w", err)
		}
		defer desktopWinHTTPClose.Call(handle)
		desktopWinHTTPTimeouts.Call(handle, 5000, 5000, 5000, 5000)
		options := desktopAutoProxyOptions{}
		if config.AutoConfigURL != nil {
			options.Flags = 2 // WINHTTP_AUTOPROXY_CONFIG_URL
			options.AutoConfigURL = config.AutoConfigURL
		} else {
			options.Flags = 1           // WINHTTP_AUTOPROXY_AUTO_DETECT
			options.AutoDetectFlags = 3 // DHCP and DNS
		}
		// Never send embedded credentials to PAC servers automatically.
		requestURL, err := windows.UTF16PtrFromString(req.URL.String())
		if err != nil {
			return nil, err
		}
		var resolved desktopWinHTTPProxyInfo
		ok, _, err = desktopGetProxyForURL.Call(handle, uintptr(unsafe.Pointer(requestURL)), uintptr(unsafe.Pointer(&options)), uintptr(unsafe.Pointer(&resolved)))
		runtime.KeepAlive(requestURL)
		runtime.KeepAlive(config)
		defer freeDesktopProxyString(resolved.Proxy)
		defer freeDesktopProxyString(resolved.ProxyBypass)
		if contextErr := req.Context().Err(); contextErr != nil {
			return nil, contextErr
		}
		if ok != 0 {
			proxy = windows.UTF16PtrToString(resolved.Proxy)
			bypass = windows.UTF16PtrToString(resolved.ProxyBypass)
		} else if config.AutoConfigURL != nil || err != windows.Errno(12180) {
			// ERROR_WINHTTP_AUTODETECTION_FAILED means no WPAD configuration
			// was found; Windows then uses its manual proxy, if configured.
			return nil, fmt.Errorf("resolve Windows automatic proxy: %w", err)
		}
	}
	return desktopWindowsProxyURL(req.URL, proxy, bypass)
}

func desktopWindowsProxyURL(target *url.URL, proxy, bypass string) (*url.URL, error) {
	host := strings.ToLower(target.Hostname())
	for _, rule := range strings.FieldsFunc(strings.ToLower(bypass), func(r rune) bool { return r == ';' || r == ' ' }) {
		if rule == "<local>" && !strings.ContainsAny(host, ".:") {
			return nil, nil
		}
		if matches, _ := path.Match(rule, host); matches {
			return nil, nil
		}
		if matches, _ := path.Match(rule, strings.ToLower(target.Host)); matches {
			return nil, nil
		}
	}
	var fallback string
	for _, entry := range strings.FieldsFunc(proxy, func(r rune) bool { return r == ';' || r == ' ' }) {
		protocol, address, specific := strings.Cut(entry, "=")
		if specific {
			if strings.EqualFold(protocol, target.Scheme) {
				return parseDesktopWindowsProxy(address, "http")
			}
			if strings.EqualFold(protocol, "socks") && fallback == "" {
				fallback = "socks5://" + address
			}
		} else if fallback == "" {
			fallback = entry
		}
	}
	if fallback == "" {
		return nil, nil
	}
	return parseDesktopWindowsProxy(fallback, "http")
}

func parseDesktopWindowsProxy(address, scheme string) (*url.URL, error) {
	if !strings.Contains(address, "://") {
		address = scheme + "://" + address
	}
	result, err := url.Parse(address)
	if err != nil || result.Hostname() == "" {
		return nil, fmt.Errorf("invalid Windows system proxy address")
	}
	return result, nil
}
