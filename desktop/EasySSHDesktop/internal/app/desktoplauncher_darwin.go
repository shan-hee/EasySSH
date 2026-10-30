//go:build darwin

package app

/*
#cgo CFLAGS: -x objective-c -fblocks
#cgo LDFLAGS: -framework Cocoa
#include <stdlib.h>
void easySSHLauncherRun(void);
void easySSHLauncherStop(void);
*/
import "C"

import (
	"context"
	"log"
	"runtime"
	"sync"
	"time"

	"github.com/easyssh/shared/instanceactivation"
)

var desktopLauncherEvents struct {
	sync.Mutex
	urls  chan string
	ready chan struct{}
	once  sync.Once
}

//export easySSHLauncherReady
func easySSHLauncherReady() {
	desktopLauncherEvents.Lock()
	defer desktopLauncherEvents.Unlock()
	if desktopLauncherEvents.ready != nil {
		desktopLauncherEvents.once.Do(func() { close(desktopLauncherEvents.ready) })
	}
}

//export easySSHLauncherOpenURL
func easySSHLauncherOpenURL(value *C.char) {
	raw := C.GoString(value)
	if err := validateDesktopLaunch(raw); err != nil {
		return
	}
	desktopLauncherEvents.Lock()
	defer desktopLauncherEvents.Unlock()
	if desktopLauncherEvents.urls == nil {
		return
	}
	select {
	case desktopLauncherEvents.urls <- raw:
	default:
		log.Print("desktop launch event queue is full")
	}
}

// LaunchServices may send URL events to the supervisor PID instead of the
// window process. Keep its main-thread Cocoa loop alive during the entire
// supervisor lifetime, including instance switches. It creates no WebView.
func runDesktopLauncherHost(directory string, run func() error) error {
	runtime.LockOSThread()
	defer runtime.UnlockOSThread()
	urls := make(chan string, 16)
	ready := make(chan struct{})
	desktopLauncherEvents.Lock()
	desktopLauncherEvents.urls, desktopLauncherEvents.ready = urls, ready
	desktopLauncherEvents.once = sync.Once{}
	desktopLauncherEvents.Unlock()
	workerCtx, cancelWorker := context.WithCancel(context.Background())
	defer cancelWorker()
	workerDone := make(chan struct{})
	go func() {
		defer close(workerDone)
		for raw := range urls {
			ctx, cancel := context.WithTimeout(workerCtx, 4*time.Second)
			err := instanceactivation.ForwardLaunch(ctx, directory, raw)
			cancel()
			if err != nil {
				log.Print("desktop could not forward a system launch event")
			}
		}
	}()
	done := make(chan error, 1)
	go func() {
		<-ready
		// LaunchServices delivers cold-start URL events just after its readiness
		// notification. Give them a chance to queue before a second process exits.
		time.Sleep(300 * time.Millisecond)
		err := run()
		desktopLauncherEvents.Lock()
		desktopLauncherEvents.urls = nil
		close(urls)
		desktopLauncherEvents.Unlock()
		timer := time.AfterFunc(4*time.Second, cancelWorker)
		<-workerDone
		timer.Stop()
		done <- err
		C.easySSHLauncherStop()
	}()
	C.easySSHLauncherRun()
	err := <-done
	desktopLauncherEvents.Lock()
	desktopLauncherEvents.ready = nil
	desktopLauncherEvents.Unlock()
	return err
}
