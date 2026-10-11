package instanceactivation

import (
	"context"
	"crypto/rand"
	"crypto/subtle"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/easyssh/shared/instancebackup"
)

type logForwarder struct{ destination io.Writer }

func (w logForwarder) Write(p []byte) (int, error) { return w.destination.Write(p) }

// Options customizes storage without duplicating the switch/rollback protocol.
// A custom Key resolves outside plaintext key files.
type Options struct {
	LogFile              bool
	AllowDetachedHelpers bool
	DatabaseName         string
	Key                  func(Target) (string, error)
	Environment          func(Target, string, string) map[string]string
}

type Target struct {
	DSN       string `json:"dsn"`
	KeyFile   string `json:"key_file"`
	Directory string `json:"directory"`
	RecordID  string `json:"record_id,omitempty"`
}

type pendingSwitch struct {
	From Target `json:"from"`
	To   Target `json:"to"`
}

type selection struct {
	Version         int            `json:"version"`
	Current         Target         `json:"current"`
	Previous        *Target        `json:"previous,omitempty"`
	Pending         *pendingSwitch `json:"pending,omitempty"`
	Operation       *Operation     `json:"operation,omitempty"`
	BackupDirectory string         `json:"backup_directory"`
}

type supervisor struct {
	options   Options
	mu        sync.Mutex
	state     selection
	stateFile string
	token     string
	stop      bool
	ready     bool
	serving   bool
	permit    chan struct{}
	commit    chan struct{}
	requests  chan struct{}
}

func randomID() string {
	var b [32]byte
	if _, err := rand.Read(b[:]); err != nil {
		panic(err)
	}
	return hex.EncodeToString(b[:])
}

func atomicJSON(path string, value any) error {
	data, err := json.MarshalIndent(value, "", "  ")
	if err != nil {
		return err
	}
	f, err := os.CreateTemp(filepath.Dir(path), ".selection-")
	if err != nil {
		return err
	}
	defer os.Remove(f.Name())
	if _, err = f.Write(data); err == nil {
		err = f.Sync()
	}
	closeErr := f.Close()
	if err != nil {
		return err
	}
	if closeErr != nil {
		return closeErr
	}
	return replaceFile(f.Name(), path)
}

func (s *supervisor) save() error { return atomicJSON(s.stateFile, s.state) }

func keyValue(target Target) (string, error) {
	b, err := os.ReadFile(target.KeyFile)
	if err != nil {
		return "", err
	}
	value := strings.TrimSpace(string(b))
	decoded, err := base64.StdEncoding.DecodeString(value)
	if err != nil || len(decoded) != 32 {
		return "", errors.New("invalid instance root key")
	}
	return value, nil
}

func inside(root, path string) bool {
	rel, err := filepath.Rel(root, path)
	return err == nil && rel != "." && rel != ".." && !strings.HasPrefix(rel, ".."+string(filepath.Separator)) && !filepath.IsAbs(rel)
}

func (s *supervisor) validateFiles(target Target, allowNewDatabase bool) error {
	if !filepath.IsAbs(target.DSN) || (s.options.Key == nil && !filepath.IsAbs(target.KeyFile)) || !filepath.IsAbs(target.Directory) {
		return errors.New("instance selection must use absolute paths")
	}
	paths := []string{target.DSN}
	if s.options.Key == nil {
		paths = append(paths, target.KeyFile)
	}
	for _, path := range paths {
		info, err := os.Lstat(path)
		if os.IsNotExist(err) && path == target.DSN && allowNewDatabase {
			continue
		}
		if err != nil {
			return err
		}
		if !info.Mode().IsRegular() || info.Mode()&os.ModeSymlink != 0 {
			return errors.New("instance database and key must be regular files")
		}
		if path == target.DSN && !allowNewDatabase && info.Size() == 0 {
			return errors.New("selected instance database is empty")
		}
	}
	_, err := s.key(target)
	return err
}

func (s *supervisor) key(target Target) (string, error) {
	if s.options.Key != nil {
		return s.options.Key(target)
	}
	return keyValue(target)
}

func (s *supervisor) candidate(input Request) (Target, error) {
	if input.Rollback {
		if s.state.Previous == nil {
			return Target{}, errors.New("no previous instance is available")
		}
		if err := s.validateFiles(*s.state.Previous, false); err != nil {
			return Target{}, err
		}
		return *s.state.Previous, nil
	}
	// Resolve again in the launcher; the HTTP caller cannot supply arbitrary paths.
	if len(input.RecordID) != 32 {
		return Target{}, errors.New("invalid backup identifier")
	}
	if _, err := hex.DecodeString(input.RecordID); err != nil {
		return Target{}, errors.New("invalid backup identifier")
	}
	var record instancebackup.Record
	b, err := os.ReadFile(filepath.Join(s.state.BackupDirectory, input.RecordID+".json"))
	if err != nil {
		return Target{}, err
	}
	if err = json.Unmarshal(b, &record); err != nil {
		return Target{}, err
	}
	if record.ID != input.RecordID || record.Status != "ready" || record.Driver != "sqlite" || record.RestoredTo == "" || record.RestoredTo != input.Directory {
		return Target{}, errors.New("restore this SQLite backup successfully before activation; refresh the backup list")
	}
	directory, err := filepath.EvalSymlinks(record.RestoredTo)
	if err != nil {
		return Target{}, err
	}
	root, err := filepath.EvalSymlinks(filepath.Join(s.state.BackupDirectory, "restored"))
	if err != nil || !inside(root, directory) {
		return Target{}, errors.New("restored directory is outside managed backup storage")
	}
	if strings.EqualFold(directory, s.state.Current.Directory) {
		return Target{}, errors.New("this restored instance is already active")
	}
	name := s.options.DatabaseName
	if name == "" {
		name = "easyssh.db"
	}
	target := Target{DSN: filepath.Join(directory, name), KeyFile: filepath.Join(directory, "easyssh-root.key"), Directory: directory, RecordID: record.ID}
	if err := s.validateFiles(target, false); err != nil {
		return Target{}, err
	}
	return target, nil
}

func (s *supervisor) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	s.mu.Lock()
	defer s.mu.Unlock()
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	if r.Method != http.MethodPost || subtle.ConstantTimeCompare([]byte(r.Header.Get("Authorization")), []byte("Bearer "+s.token)) != 1 {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	fail := func(err error) {
		w.WriteHeader(http.StatusConflict)
		_ = json.NewEncoder(w).Encode(map[string]string{"error": err.Error()})
	}
	switch r.URL.Path {
	case "/info":
		_ = json.NewEncoder(w).Encode(Info{Available: true, ActiveBackupID: s.state.Current.RecordID, ActiveDirectory: s.state.Current.Directory, CanRollback: s.state.Previous != nil, Operation: s.state.Operation})
	case "/control":
		_ = json.NewEncoder(w).Encode(map[string]bool{"stop": s.stop})
	case "/ready", "/serving":
		if s.stop {
			fail(errors.New("launcher is stopping"))
			return
		}
		permit := s.permit
		if r.URL.Path == "/ready" {
			s.ready = true
		} else {
			s.serving = true
			permit = s.commit
		}
		s.mu.Unlock()
		select {
		case <-permit:
		case <-r.Context().Done():
		}
		s.mu.Lock()
		_ = json.NewEncoder(w).Encode(map[string]bool{"ready": true})
	case "/activate":
		if !s.ready || s.stop || s.state.Pending != nil {
			fail(instancebackup.ErrBusy)
			return
		}
		var input Request
		r.Body = http.MaxBytesReader(w, r.Body, 4096)
		if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
			fail(err)
			return
		}
		target, err := s.candidate(input)
		if err != nil {
			fail(err)
			return
		}
		old := s.state
		s.state.Pending = &pendingSwitch{From: s.state.Current, To: target}
		s.state.Operation = &Operation{ID: randomID(), Status: "switching"}
		if err = s.save(); err != nil {
			s.state = old
			fail(err)
			return
		}
		_ = json.NewEncoder(w).Encode(s.state.Operation)
		s.requests <- struct{}{}
	default:
		http.NotFound(w, r)
	}
}

type childProcess struct {
	done      chan error
	terminate func()
	close     func()
}

func (s *supervisor) launch(address string, target Target) (*childProcess, error) {
	// Only ordinary first-time setup may create a database. A missing restored
	// or rollback database must never silently become a new empty instance.
	if err := s.validateFiles(target, s.state.Operation == nil && target.RecordID == ""); err != nil {
		return nil, err
	}
	key, err := s.key(target)
	if err != nil {
		return nil, err
	}
	executable, err := os.Executable()
	if err != nil {
		return nil, err
	}
	s.mu.Lock()
	s.token, s.stop, s.ready = randomID(), false, false
	s.serving = false
	s.permit = make(chan struct{})
	s.commit = make(chan struct{})
	token := s.token
	s.mu.Unlock()
	overrides := map[string]string{addressEnv: address, tokenEnv: token, "DB_DRIVER": "sqlite", "DB_DSN": target.DSN, "ENCRYPTION_KEY": key, "EASYSSH_DATA_DIR": target.Directory, "EASYSSH_BACKUP_DIR": s.state.BackupDirectory}
	if s.options.Environment != nil {
		overrides = s.options.Environment(target, key, s.state.BackupDirectory)
	}
	overrides[addressEnv], overrides[tokenEnv] = address, token
	overrides["EASYSSH_LAUNCHER_PID"] = strconv.Itoa(os.Getpid())
	overrides["EASYSSH_INSTANCE_STATE_DIR"] = filepath.Dir(s.stateFile)
	env := []string{}
	for _, entry := range os.Environ() {
		name, _, _ := strings.Cut(entry, "=")
		if _, ok := overrides[strings.ToUpper(name)]; !ok {
			env = append(env, entry)
		}
	}
	for name, value := range overrides {
		env = append(env, name+"="+value)
	}
	cmd := exec.Command(executable, os.Args[1:]...)
	// A non-*os.File writer forces pipes: hidden Windows children cannot
	// reliably write to inherited console handles directly.
	cmd.Env, cmd.Stdout, cmd.Stderr = env, logForwarder{os.Stdout}, logForwarder{os.Stderr}
	if s.options.LogFile {
		cmd.Stdout, cmd.Stderr = logForwarder{log.Writer()}, logForwarder{log.Writer()}
	}
	cmd.WaitDelay = 3 * time.Second
	log.Print("[instance] Starting child; waiting for initialization")
	return startChild(cmd, s.options.AllowDetachedHelpers)
}

func (s *supervisor) stopChild(child *childProcess) bool {
	s.mu.Lock()
	s.stop = true
	s.mu.Unlock()
	defer child.close()
	select {
	case <-child.done:
		return true
	case <-time.After(60 * time.Second):
		log.Print("[instance] Graceful shutdown timed out; terminating child process tree")
		child.terminate()
		<-child.done
		return false
	}
}

func (s *supervisor) awaitReady(ctx context.Context, child *childProcess, serving bool) error {
	timer := time.NewTimer(90 * time.Second)
	defer timer.Stop()
	ticker := time.NewTicker(100 * time.Millisecond)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-timer.C:
			return errors.New("instance startup timed out")
		case err := <-child.done:
			child.done <- err // retain completion for stopChild
			return errors.New("instance exited before becoming ready")
		case <-ticker.C:
			s.mu.Lock()
			ready := s.ready
			if serving {
				ready = s.serving
			}
			s.mu.Unlock()
			if ready {
				return nil
			}
		}
	}
}

// Run starts one child at a time. A durable pending intent is rolled back after
// an interrupted switch; Current changes only after the candidate is ready.
func Run(directory string, original Target, rootKey, backupDirectory string) error {
	return RunWithOptions(directory, original, rootKey, backupDirectory, Options{})
}

func RunWithOptions(directory string, original Target, rootKey, backupDirectory string, options Options) (runErr error) {
	if inside(original.Directory, directory) || inside(directory, original.Directory) || strings.EqualFold(directory, original.Directory) || inside(backupDirectory, directory) || inside(directory, backupDirectory) || strings.EqualFold(directory, backupDirectory) {
		return errors.New("launcher state must be separate from database and backup storage")
	}
	if err := secureDirectory(directory); err != nil {
		return err
	}
	lock, err := instancebackup.Lock(directory)
	if err != nil {
		return err
	}
	defer lock.Close()
	if options.LogFile {
		file, err := os.OpenFile(filepath.Join(directory, "launcher.log"), os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0600)
		if err != nil {
			return err
		}
		defer file.Close()
		previous := log.Writer()
		log.SetOutput(file)
		defer log.SetOutput(previous)
	}
	defer func() {
		if runErr != nil {
			log.Printf("[instance] Launcher stopped: %v", runErr)
		}
	}()
	s := &supervisor{options: options, stateFile: filepath.Join(directory, "selection.json"), requests: make(chan struct{}, 1)}
	b, err := os.ReadFile(s.stateFile)
	if err == nil {
		if err = json.Unmarshal(b, &s.state); err != nil {
			return err
		}
		if s.state.Version != 1 || s.state.BackupDirectory == "" || (s.state.Pending != nil && s.state.Operation == nil) {
			return errors.New("unsupported instance selection version")
		}
	} else if os.IsNotExist(err) {
		s.state = selection{Version: 1, Current: original, BackupDirectory: backupDirectory}
	} else {
		return err
	}
	// Until the first explicit switch, preserve the existing deployment behavior:
	// changing DB_DSN/ENCRYPTION_KEY in .env must still change normal startup.
	if s.state.Operation == nil && s.state.Pending == nil && s.state.Previous == nil {
		if options.Key == nil {
			original.KeyFile = filepath.Join(directory, "original-root.key")
			if err = os.WriteFile(original.KeyFile, []byte(rootKey), 0600); err != nil {
				return err
			}
		}
		s.state.Current, s.state.BackupDirectory = original, backupDirectory
		if err = s.save(); err != nil {
			return err
		}
	}
	if s.state.Pending != nil {
		log.Print("[instance] Interrupted activation detected; returning to previous instance")
		s.state.Current = s.state.Pending.From
		s.state.Pending = nil
		s.state.Operation.Status, s.state.Operation.Reason = "rolled_back", "interrupted"
		if err = s.save(); err != nil {
			return err
		}
	}
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return err
	}
	broker := &http.Server{Handler: s, ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 5 * time.Second, WriteTimeout: 5 * time.Second}
	go func() { _ = broker.Serve(listener) }()
	defer broker.Close()
	address := "http://" + listener.Addr().String()
	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer cancel()
	child, err := s.launch(address, s.state.Current)
	if err != nil {
		return err
	}
	defer func() {
		if child != nil {
			s.stopChild(child)
		}
	}()
	if err = s.awaitReady(ctx, child, false); err != nil {
		return err
	}
	close(s.permit)
	if err = s.awaitReady(ctx, child, true); err != nil {
		return err
	}
	close(s.commit)
	log.Print("[instance] Ready; child initialization and serving handshake completed")
	for {
		select {
		case <-ctx.Done():
			return nil
		case err := <-child.done:
			child.close()
			child = nil
			if err != nil {
				return fmt.Errorf("server exited: %w", err)
			}
			return nil
		case <-s.requests:
			// Let the accepted response leave the HTTP server before shutting it down.
			select {
			case <-ctx.Done():
				return nil
			case <-time.After(time.Second):
			}
			log.Print("[instance] Activation accepted; stopping current instance")
			stopped := s.stopChild(child)
			child = nil
			s.mu.Lock()
			pending := *s.state.Pending
			s.mu.Unlock()
			var startErr error
			if stopped {
				child, startErr = s.launch(address, pending.To)
				if startErr == nil {
					startErr = s.awaitReady(ctx, child, false)
					if startErr == nil {
						close(s.permit)
						startErr = s.awaitReady(ctx, child, true)
					}
				}
			} else {
				startErr = errors.New("old instance shutdown timed out")
			}
			if ctx.Err() != nil {
				return nil
			}
			if startErr == nil {
				s.mu.Lock()
				before := s.state
				s.state.Current, s.state.Previous, s.state.Pending = pending.To, &pending.From, nil
				s.state.Operation = &Operation{ID: before.Operation.ID, Status: "succeeded"}
				startErr = s.save()
				if startErr != nil {
					s.state = before
				}
				s.mu.Unlock()
				if startErr == nil {
					close(s.commit)
					log.Print("[instance] Activation succeeded; selected instance is ready")
					continue
				}
			}
			log.Printf("Instance activation failed; restoring previous selection: %v", startErr)
			if child != nil {
				s.stopChild(child)
				child = nil
			}
			s.mu.Lock()
			s.state.Current, s.state.Pending = pending.From, nil
			s.state.Operation = &Operation{ID: s.state.Operation.ID, Status: "rolled_back", Reason: "startup_failed"}
			err = s.save()
			s.mu.Unlock()
			if err != nil {
				return err
			}
			child, err = s.launch(address, pending.From)
			if err == nil {
				err = s.awaitReady(ctx, child, false)
				if err == nil {
					close(s.permit)
					err = s.awaitReady(ctx, child, true)
				}
			}
			if err != nil {
				return fmt.Errorf("previous instance could not restart: %w", err)
			}
			close(s.commit)
			log.Print("[instance] Rollback completed; previous instance is ready")
		}
	}
}
