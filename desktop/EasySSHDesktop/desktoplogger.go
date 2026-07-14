package main

import (
	"compress/gzip"
	"fmt"
	"io"
	"log"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/wailsapp/wails/v3/pkg/application"
)

const (
	desktopLogMaxBytes = 10 * 1024 * 1024
	desktopLogFileName = "easyssh.log"
)

type desktopLogWriter struct {
	mu   sync.Mutex
	file *os.File
	path string
}

var desktopLogger = &desktopLogWriter{}

func initDesktopLogger() error {
	logDir := desktopLogDir()
	if err := os.MkdirAll(logDir, 0o755); err != nil {
		return err
	}

	logPath := filepath.Join(logDir, desktopLogFileName)
	// Do not rotate during startup: a short-lived second instance must be able
	// to open the active log before it notifies the first instance. Size-based
	// rotation is handled by desktopLogWriter immediately before a write.
	file, err := os.OpenFile(logPath, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o644)
	if err != nil {
		return err
	}

	desktopLogger.mu.Lock()
	if desktopLogger.file != nil {
		_ = desktopLogger.file.Close()
	}
	desktopLogger.file = file
	desktopLogger.path = logPath
	desktopLogger.mu.Unlock()

	log.SetFlags(log.LstdFlags | log.Lmicroseconds | log.Lshortfile)
	log.SetOutput(io.MultiWriter(os.Stderr, desktopLogger))
	log.Printf("desktop logger initialized path=%s", logPath)
	return nil
}

func closeDesktopLogger() {
	desktopLogger.mu.Lock()
	defer desktopLogger.mu.Unlock()
	if desktopLogger.file != nil {
		_ = desktopLogger.file.Sync()
		_ = desktopLogger.file.Close()
		desktopLogger.file = nil
	}
}

func desktopLogDir() string {
	return filepath.Join(desktopDataDir(), "logs")
}

func desktopLogPath() string {
	return filepath.Join(desktopLogDir(), desktopLogFileName)
}

func (w *desktopLogWriter) Write(p []byte) (int, error) {
	w.mu.Lock()
	defer w.mu.Unlock()

	if w.file == nil {
		return len(p), nil
	}

	if err := w.rotateIfNeededLocked(len(p)); err != nil {
		return 0, err
	}

	if _, err := w.file.Write(p); err != nil {
		return 0, err
	}
	return len(p), nil
}

func (w *desktopLogWriter) rotateIfNeededLocked(nextBytes int) error {
	if w.path == "" || w.file == nil || nextBytes <= 0 {
		return nil
	}

	info, err := w.file.Stat()
	if err != nil {
		return err
	}
	if info.Size()+int64(nextBytes) <= desktopLogMaxBytes {
		return nil
	}

	if err := w.file.Close(); err != nil {
		return err
	}
	w.file = nil

	if err := rotateDesktopLogFile(w.path); err != nil {
		return err
	}

	file, err := os.OpenFile(w.path, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o644)
	if err != nil {
		return err
	}
	w.file = file
	return nil
}

func rotateDesktopLogFile(logPath string) error {
	if err := os.MkdirAll(filepath.Dir(logPath), 0o755); err != nil {
		return err
	}

	previousPath := strings.TrimSuffix(logPath, ".log") + ".1.log"
	olderPath := strings.TrimSuffix(logPath, ".log") + ".2.log.gz"
	if err := removeIfExists(olderPath); err != nil {
		return err
	}

	if fileExists(previousPath) {
		if err := gzipFile(previousPath, olderPath); err != nil {
			return err
		}
		if err := os.Remove(previousPath); err != nil {
			return err
		}
	}

	if fileExists(logPath) {
		if err := os.Rename(logPath, previousPath); err != nil {
			return err
		}
	}

	return nil
}

func removeIfExists(path string) error {
	err := os.Remove(path)
	if err == nil || os.IsNotExist(err) {
		return nil
	}
	return err
}

func fileExists(path string) bool {
	_, err := os.Stat(path)
	return err == nil
}

func gzipFile(sourcePath, targetPath string) error {
	source, err := os.Open(sourcePath)
	if err != nil {
		return err
	}
	defer source.Close()

	target, err := os.OpenFile(targetPath, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0o644)
	if err != nil {
		return err
	}
	defer target.Close()

	writer := gzip.NewWriter(target)
	if _, err := io.Copy(writer, source); err != nil {
		_ = writer.Close()
		return err
	}
	return writer.Close()
}

func desktopLogPrintf(format string, args ...any) {
	log.Output(2, fmt.Sprintf(format, args...))
}

func newDesktopWailsLogger() *slog.Logger {
	return slog.New(slog.NewTextHandler(io.MultiWriter(os.Stderr, desktopLogger), &slog.HandlerOptions{
		Level: slog.LevelInfo,
	}))
}

func handleDesktopPanic(details *application.PanicDetails) {
	if details == nil {
		return
	}

	log.Printf("panic error: %v\n%s", details.Error, details.StackTrace)

	if err := writeDesktopCrashLog(details); err != nil {
		log.Printf("failed to write desktop crash log: %v", err)
	}
}

func writeDesktopCrashLog(details *application.PanicDetails) error {
	if details == nil {
		return nil
	}

	logDir := desktopLogDir()
	if err := os.MkdirAll(logDir, 0o755); err != nil {
		return err
	}

	stamp := details.Time
	if stamp.IsZero() {
		stamp = time.Now()
	}
	crashPath := filepath.Join(logDir, fmt.Sprintf("crash-%s.log", stamp.Format("20060102-150405")))
	content := fmt.Sprintf(
		"time=%s\nerror=%v\n\nstack:\n%s\n\nfull_stack:\n%s\n",
		stamp.Format(time.RFC3339Nano),
		details.Error,
		details.StackTrace,
		details.FullStackTrace,
	)
	return os.WriteFile(crashPath, []byte(content), 0o644)
}
