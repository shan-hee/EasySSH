//go:build !windows

package main

import (
	"net/http"
	"net/url"
)

func desktopSystemProxy(req *http.Request) (*url.URL, error) {
	return http.ProxyFromEnvironment(req)
}
