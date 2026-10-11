package main

import "golang.org/x/sys/windows/svc"

func instanceLauncherSupported() bool {
	service, err := svc.IsWindowsService()
	return err == nil && !service
}
