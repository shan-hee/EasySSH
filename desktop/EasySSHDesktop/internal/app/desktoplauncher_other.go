//go:build !darwin

package app

func runDesktopLauncherHost(_ string, run func() error) error { return run() }
