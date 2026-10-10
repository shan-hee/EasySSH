package instancebackup

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"
)

const MaxUploadBytes int64 = 16 << 30

var ErrBusy = errors.New("another backup operation is running")
var ErrNotFound = errors.New("backup record not found")

// Record is deliberately outside the application database: restoring a database
// must not erase the backup catalog. Passwords and root keys are never recorded.
type Record struct {
	ID            string     `json:"id"`
	Name          string     `json:"name"`
	CreatedAt     time.Time  `json:"created_at"`
	Size          int64      `json:"size"`
	Status        string     `json:"status"`
	Source        string     `json:"source"`
	Error         string     `json:"error,omitempty"`
	VerifiedAt    *time.Time `json:"verified_at,omitempty"`
	AppVersion    string     `json:"app_version,omitempty"`
	Driver        string     `json:"driver,omitempty"`
	SchemaVersion int64      `json:"schema_version,omitempty"`
	RestoredTo    string     `json:"restored_to,omitempty"`
}

type HistoryOptions struct {
	AppVersion    string
	Driver        string
	SchemaVersion int64
	Directory     string
	Snapshot      func(context.Context, string, string) error
	Validate      func(context.Context, string, Manifest) error
	Restore       func(context.Context, string, Manifest, string) (string, error)
}

type History struct {
	mu        sync.Mutex
	pins      map[string]int
	opts      HistoryOptions
	busy      bool
	closed    bool
	ctx       context.Context
	cancel    context.CancelFunc
	wg        sync.WaitGroup
	closeOnce sync.Once
	release   func() error
}

func NewHistory(opts HistoryOptions) (*History, error) {
	if err := os.MkdirAll(opts.Directory, 0700); err != nil {
		return nil, err
	}
	lock, err := Lock(opts.Directory)
	if err != nil {
		return nil, err
	}
	ctx, cancel := context.WithCancel(context.Background())
	h := &History{opts: opts, ctx: ctx, cancel: cancel, pins: make(map[string]int), release: lock.Close}
	records, err := h.List()
	if err != nil {
		cancel()
		_ = lock.Close()
		return nil, err
	}
	for _, record := range records {
		if record.Status == "creating" || record.Status == "uploading" || record.Status == "checking" || record.Status == "restoring" {
			record.Status = "failed"
			if record.Size > 0 {
				record.Status = "ready"
			}
			record.Error = "operation interrupted by application shutdown; retry the operation"
			if err := h.save(record); err != nil {
				cancel()
				_ = lock.Close()
				return nil, err
			}
			_ = os.Remove(filepath.Join(opts.Directory, record.ID+".partial"))
		}
	}
	return h, nil
}

func (h *History) Directory() string { return h.opts.Directory }

// Cancel prevents new operations and stops background work without waiting for HTTP uploads.
func (h *History) Cancel() {
	h.mu.Lock()
	h.closed = true
	h.cancel()
	h.mu.Unlock()
}

func (h *History) Close() {
	h.closeOnce.Do(func() {
		h.Cancel()
		h.wg.Wait()
		_ = h.release()
	})
}

func validID(id string) bool {
	if len(id) != 32 {
		return false
	}
	_, err := hex.DecodeString(id)
	return err == nil && id == strings.ToLower(id)
}

func (h *History) save(record Record) error {
	data, err := json.Marshal(record)
	if err != nil {
		return err
	}
	name := filepath.Join(h.opts.Directory, record.ID+".json")
	f, err := os.CreateTemp(h.opts.Directory, ".record-")
	if err != nil {
		return err
	}
	defer os.Remove(f.Name())
	if _, err = f.Write(data); err != nil {
		f.Close()
		return err
	}
	if err = f.Sync(); err != nil {
		f.Close()
		return err
	}
	if err = f.Close(); err != nil {
		return err
	}
	return os.Rename(f.Name(), name)
}

func (h *History) get(id string) (Record, error) {
	var record Record
	if !validID(id) {
		return record, ErrNotFound
	}
	data, err := os.ReadFile(filepath.Join(h.opts.Directory, id+".json"))
	if os.IsNotExist(err) {
		return record, ErrNotFound
	}
	if err != nil {
		return record, err
	}
	if err = json.Unmarshal(data, &record); err != nil {
		return record, err
	}
	if record.ID != id {
		return record, errors.New("invalid backup record")
	}
	return record, nil
}

func (h *History) List() ([]Record, error) {
	h.mu.Lock()
	defer h.mu.Unlock()
	entries, err := os.ReadDir(h.opts.Directory)
	if err != nil {
		return nil, err
	}
	records := []Record{}
	for _, entry := range entries {
		id := strings.TrimSuffix(entry.Name(), ".json")
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".json") || !validID(id) {
			continue
		}
		record, err := h.get(id)
		if err != nil {
			return nil, err
		}
		records = append(records, record)
	}
	sort.Slice(records, func(i, j int) bool { return records[i].CreatedAt.After(records[j].CreatedAt) })
	return records, nil
}

func (h *History) newRecord(source, status string) (Record, error) {
	var random [16]byte
	if _, err := rand.Read(random[:]); err != nil {
		return Record{}, err
	}
	id := hex.EncodeToString(random[:])
	record := Record{ID: id, Name: "easyssh-" + time.Now().UTC().Format("20060102-150405") + "-" + id[:8] + ".easyssh.age", CreatedAt: time.Now().UTC(), Source: source, Status: status}
	if source == "created" {
		record.AppVersion = h.opts.AppVersion
		record.Driver = h.opts.Driver
		record.SchemaVersion = h.opts.SchemaVersion
	}
	return record, h.save(record)
}

func (h *History) archive(id string) string {
	return filepath.Join(h.opts.Directory, id+".easyssh.age")
}

// Worker operations are serialized, and own their password only in memory.
func (h *History) Create(password string) (Record, error) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.closed || h.busy {
		return Record{}, ErrBusy
	}
	if strings.TrimSpace(password) == "" || len(password) > 1024 {
		return Record{}, errors.New("backup password is required (maximum 1024 bytes)")
	}
	record, err := h.newRecord("created", "creating")
	if err != nil {
		return record, err
	}
	h.start(record, func(ctx context.Context, record *Record) error {
		partial := filepath.Join(h.opts.Directory, record.ID+".partial")
		defer os.Remove(partial)
		if err := h.opts.Snapshot(ctx, partial, password); err != nil {
			return err
		}
		if err := ctx.Err(); err != nil {
			return err
		}
		info, err := os.Stat(partial)
		if err != nil {
			return err
		}
		if err = os.Rename(partial, h.archive(record.ID)); err != nil {
			return err
		}
		record.Size = info.Size()
		return nil
	})
	return record, nil
}

func (h *History) start(record Record, fn func(context.Context, *Record) error) {
	h.busy = true
	h.wg.Add(1)
	go func() {
		defer h.wg.Done()
		ctx, cancel := context.WithTimeout(h.ctx, 4*time.Hour)
		defer cancel()
		err := fn(ctx, &record)
		h.mu.Lock()
		defer h.mu.Unlock()
		record.Status = "ready"
		if err != nil {
			record.Error = err.Error()
			if record.Size == 0 {
				record.Status = "failed"
			}
		}
		// A catalog write failure must be visible to the operator in the next list,
		// which retains the in-progress record rather than claiming success.
		if err := h.save(record); err != nil {
			fmt.Fprintf(os.Stderr, "backup catalog update failed: %v\n", err)
		}
		h.busy = false
	}()
}

func (h *History) Upload(reader io.Reader) (Record, error) {
	h.mu.Lock()
	if h.closed || h.busy {
		h.mu.Unlock()
		return Record{}, ErrBusy
	}
	record, err := h.newRecord("uploaded", "uploading")
	if err != nil {
		h.mu.Unlock()
		return record, err
	}
	h.busy = true
	h.wg.Add(1)
	h.mu.Unlock()
	defer h.wg.Done()
	partial := filepath.Join(h.opts.Directory, record.ID+".partial")
	defer os.Remove(partial)
	err = func() error {
		file, err := os.OpenFile(partial, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
		if err != nil {
			return err
		}
		defer file.Close()
		n, err := io.Copy(file, io.LimitReader(contextReader{h.ctx, reader}, MaxUploadBytes+1))
		if err != nil {
			return err
		}
		if n == 0 || n > MaxUploadBytes {
			return errors.New("backup file must be between 1 byte and 16 GiB")
		}
		if err = file.Sync(); err != nil {
			return err
		}
		if err = file.Close(); err != nil {
			return err
		}
		if err = os.Rename(partial, h.archive(record.ID)); err != nil {
			return err
		}
		record.Size = n
		return nil
	}()
	h.mu.Lock()
	defer h.mu.Unlock()
	h.busy = false
	record.Status = "ready"
	if err != nil {
		record.Status = "failed"
		record.Error = err.Error()
	}
	if saveErr := h.save(record); saveErr != nil {
		return record, saveErr
	}
	return record, err
}

func (h *History) Inspect(id, password string, restore bool) (Record, error) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.closed || h.busy {
		return Record{}, ErrBusy
	}
	if strings.TrimSpace(password) == "" || len(password) > 1024 {
		return Record{}, errors.New("backup password is required (maximum 1024 bytes)")
	}
	record, err := h.get(id)
	if err != nil {
		return record, err
	}
	if record.Size == 0 {
		return record, errors.New("backup archive is unavailable")
	}
	if restore && h.opts.Restore == nil {
		return record, errors.New("restore is unavailable")
	}
	record.Status = "checking"
	record.Error = ""
	record.VerifiedAt = nil
	if restore {
		record.Status = "restoring"
	}
	if err = h.save(record); err != nil {
		return record, err
	}
	h.start(record, func(ctx context.Context, record *Record) error {
		stage, err := os.MkdirTemp("", "easyssh-inspect-")
		if err != nil {
			return err
		}
		defer os.RemoveAll(stage)
		manifest, err := Unpack(ctx, h.archive(id), stage, password)
		if err != nil {
			return errors.New("unable to verify backup: incorrect password, damaged archive, or insufficient temporary storage")
		}
		if err = ctx.Err(); err != nil {
			return err
		}
		if err = h.opts.Validate(ctx, stage, manifest); err != nil {
			return err
		}
		now := time.Now().UTC()
		record.VerifiedAt = &now
		record.AppVersion = manifest.AppVersion
		record.Driver = manifest.Driver
		record.SchemaVersion = manifest.SchemaVersion
		if restore {
			record.RestoredTo, err = h.opts.Restore(ctx, stage, manifest, record.ID)
		}
		return err
	})
	return record, nil
}

// Open pins a file while it is downloaded; callers must close it before release.
func (h *History) Open(id string) (*os.File, Record, func(), error) {
	h.mu.Lock()
	record, err := h.get(id)
	if err != nil {
		h.mu.Unlock()
		return nil, record, nil, err
	}
	file, err := os.Open(h.archive(id))
	if err != nil {
		h.mu.Unlock()
		return nil, record, nil, err
	}
	h.pins[id]++
	h.mu.Unlock()
	var once sync.Once
	release := func() {
		once.Do(func() {
			h.mu.Lock()
			defer h.mu.Unlock()
			h.pins[id]--
			if h.pins[id] == 0 {
				delete(h.pins, id)
			}
		})
	}
	return file, record, release, nil
}

func (h *History) Delete(id string) error {
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.closed || h.busy || h.pins[id] > 0 {
		return ErrBusy
	}
	if _, err := h.get(id); err != nil {
		return err
	}
	if err := os.Remove(h.archive(id)); err != nil && !os.IsNotExist(err) {
		return err
	}
	return os.Remove(filepath.Join(h.opts.Directory, id+".json"))
}
