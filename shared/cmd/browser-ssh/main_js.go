//go:build js && wasm

package main

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"os"
	"path"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"syscall/js"
	"time"

	"github.com/easyssh/shared/sshclient"
	"github.com/pkg/sftp"
	"golang.org/x/crypto/ssh"
)

type command struct {
	SFTPOnly    bool                  `json:"sftp_only"`
	Container   string                `json:"container"`
	All         bool                  `json:"all"`
	Force       bool                  `json:"force"`
	Tail        int                   `json:"tail"`
	Destination string                `json:"destination"`
	Mode        string                `json:"mode"`
	Overwrite   bool                  `json:"overwrite"`
	Exec        string                `json:"exec"`
	Type        string                `json:"type"`
	ID          string                `json:"id"`
	URL         string                `json:"url"`
	Target      sshclient.Config      `json:"target"`
	Credentials sshclient.Credentials `json:"credentials"`
	Data        string                `json:"data"`
	Path        string                `json:"path"`
	Handle      string                `json:"handle"`
	Offset      int64                 `json:"offset"`
	Cols        int                   `json:"cols"`
	Rows        int                   `json:"rows"`
	Accepted    bool                  `json:"accepted"`
	Fingerprint string                `json:"fingerprint"`
	Answers     []string              `json:"answers"`
}

type openedFile struct {
	file  *sftp.File
	write bool
}

type runtime struct {
	ctx         context.Context
	cancel      context.CancelFunc
	mu          sync.Mutex
	client      *ssh.Client
	terminal    *ssh.Session
	stdin       io.WriteCloser
	sftp        *sftp.Client
	prompts     map[string]chan command
	files       map[string]openedFile
	sequence    atomic.Uint64
	input       chan []byte
	outputSlots chan struct{}
	closed      bool
}

func emit(kind string, data any) {
	value, err := json.Marshal(map[string]any{"type": kind, "data": data})
	if err == nil {
		js.Global().Call("postMessage", string(value))
	}
}

func (r *runtime) ask(kind string, details map[string]any) (command, error) {
	id := fmt.Sprint(r.sequence.Add(1))
	answer := make(chan command, 1)
	r.mu.Lock()
	r.prompts[id] = answer
	r.mu.Unlock()
	defer func() { r.mu.Lock(); delete(r.prompts, id); r.mu.Unlock() }()
	details["id"] = id
	emit(kind, details)
	select {
	case response := <-answer:
		if !response.Accepted {
			return command{}, errors.New("authentication cancelled")
		}
		return response, nil
	case <-r.ctx.Done():
		return command{}, r.ctx.Err()
	case <-time.After(2 * time.Minute):
		return command{}, errors.New("authentication prompt expired")
	}
}

func (r *runtime) hostKey(host string, remote net.Addr, key ssh.PublicKey) error {
	fingerprint := ssh.FingerprintSHA256(key)
	answer, err := r.ask("host_key", map[string]any{"host": host, "fingerprint": fingerprint, "algorithm": key.Type()})
	if err != nil {
		return err
	}
	if answer.Fingerprint != fingerprint {
		return errors.New("host key confirmation mismatch")
	}
	return nil
}

func (r *runtime) keyboard(user, instruction string, questions []string, echoes []bool) ([]string, error) {
	answer, err := r.ask("auth_prompt", map[string]any{"user": user, "instruction": instruction, "questions": questions, "echoes": echoes})
	if err != nil {
		return nil, err
	}
	if len(answer.Answers) != len(questions) {
		return nil, errors.New("invalid authentication response")
	}
	return answer.Answers, nil
}

func (r *runtime) start(input command) {
	defer r.close()
	config, err := sshclient.ClientConfig(input.Target, input.Credentials, r.hostKey, r.keyboard)
	input.Credentials = sshclient.Credentials{}
	if err != nil {
		emit("error", err.Error())
		return
	}
	connectCtx, cancel := context.WithTimeout(r.ctx, 5*time.Minute)
	defer cancel()
	stream, err := dialSocket(connectCtx, input.URL)
	if err != nil {
		emit("error", err.Error())
		return
	}
	stop := context.AfterFunc(r.ctx, func() { stream.Close() })
	defer stop()
	client, err := sshclient.Connect(connectCtx, stream, input.Target, config)
	config.Auth = nil
	if err != nil {
		emit("error", err.Error())
		return
	}
	defer client.Close()
	r.mu.Lock()
	r.client = client
	r.mu.Unlock()
	if input.SFTPOnly {
		emit("ready", nil)
		go r.keepAlive(client)
		_ = client.Wait()
		return
	}
	terminal, err := client.NewSession()
	if err != nil {
		emit("error", err.Error())
		return
	}
	defer terminal.Close()
	if input.Cols < 1 || input.Cols > 1000 || input.Rows < 1 || input.Rows > 1000 {
		emit("error", "invalid terminal dimensions")
		return
	}
	if err = terminal.RequestPty("xterm-256color", input.Rows, input.Cols, ssh.TerminalModes{ssh.ECHO: 1}); err != nil {
		emit("error", err.Error())
		return
	}
	stdin, err := terminal.StdinPipe()
	if err != nil {
		emit("error", err.Error())
		return
	}
	terminal.Stdout, terminal.Stderr = terminalOutput{r}, terminalOutput{r}
	if err = terminal.Shell(); err != nil {
		emit("error", err.Error())
		return
	}
	r.mu.Lock()
	r.terminal, r.stdin = terminal, stdin
	r.mu.Unlock()
	emit("ready", nil)
	go r.writeInput()
	go r.keepAlive(client)
	err = terminal.Wait()
	if err != nil && r.ctx.Err() == nil {
		emit("error", err.Error())
	}
}

type terminalOutput struct{ runtime *runtime }

func (out terminalOutput) Write(p []byte) (int, error) {
	for offset := 0; offset < len(p); offset += 32 << 10 {
		select {
		case out.runtime.outputSlots <- struct{}{}:
		case <-out.runtime.ctx.Done():
			return offset, out.runtime.ctx.Err()
		}
		end := min(offset+(32<<10), len(p))
		emit("output", base64.StdEncoding.EncodeToString(p[offset:end]))
	}
	return len(p), nil
}

func (r *runtime) writeInput() {
	for {
		select {
		case data := <-r.input:
			r.mu.Lock()
			stdin := r.stdin
			r.mu.Unlock()
			if stdin == nil {
				continue
			}
			if n, err := stdin.Write(data); err != nil || n != len(data) {
				r.close()
				return
			}
			emit("input_ack", nil)
		case <-r.ctx.Done():
			return
		}
	}
}

func (r *runtime) keepAlive(client *ssh.Client) {
	ticker := time.NewTicker(30 * time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-ticker.C:
			done := make(chan error, 1)
			go func() { _, _, err := client.SendRequest("keepalive@openssh.com", true, nil); done <- err }()
			select {
			case err := <-done:
				if err != nil {
					r.close()
					return
				}
			case <-time.After(30 * time.Second):
				r.close()
				return
			case <-r.ctx.Done():
				return
			}
		case <-r.ctx.Done():
			return
		}
	}
}

func (r *runtime) close() {
	r.cancel()
	r.mu.Lock()
	if r.closed {
		r.mu.Unlock()
		return
	}
	r.closed = true
	client := r.client
	r.files = make(map[string]openedFile)
	r.mu.Unlock()
	if client != nil {
		client.Close()
	}
	emit("closed", nil)
}

func (r *runtime) reply(input command) {
	r.mu.Lock()
	prompt := r.prompts[input.ID]
	r.mu.Unlock()
	if prompt != nil {
		select {
		case prompt <- input:
		default:
		}
	}
}

// File operations are serialized in their own bounded queue by the JS bridge.
// Each transfer reads/writes small chunks and requires explicit close/cancel.
func (r *runtime) fileCommand(input command) (any, error) {
	r.mu.Lock()
	client, fileClient := r.client, r.sftp
	r.mu.Unlock()
	if client == nil || r.ctx.Err() != nil {
		return nil, errors.New("SSH is not connected")
	}
	if strings.HasPrefix(input.Type, "docker_") {
		return r.dockerCommand(client, input)
	}
	if input.Type == "metrics" {
		return r.metrics(client)
	}
	if input.Type == "exec" {
		if len(input.Exec) > 1<<20 {
			return nil, errors.New("command too large")
		}
		session, err := client.NewSession()
		if err != nil {
			return nil, err
		}
		defer session.Close()
		ctx, cancel := context.WithTimeout(r.ctx, 55*time.Second)
		defer cancel()
		stop := context.AfterFunc(ctx, func() { session.Close() })
		defer stop()
		output := &boundedOutput{limit: 4 << 20}
		session.Stdout = output
		session.Stderr = output
		err = session.Run(input.Exec)
		code := 0
		if err != nil {
			var status *ssh.ExitError
			if !errors.As(err, &status) {
				return nil, err
			}
			code = status.ExitStatus()
		}
		return map[string]any{"output": string(output.data), "exit_code": code}, nil
	}
	if fileClient == nil {
		var err error
		fileClient, err = sftp.NewClient(client)
		if err != nil {
			return nil, err
		}
		r.mu.Lock()
		r.sftp = fileClient
		r.mu.Unlock()
	}
	switch input.Type {
	case "realpath":
		return fileClient.RealPath(input.Path)
	case "list_directory":
		resolved, err := fileClient.RealPath(input.Path)
		if err != nil {
			return nil, err
		}
		files, err := fileClient.ReadDir(resolved)
		if err != nil {
			return nil, err
		}
		if len(files) > 10000 {
			return nil, errors.New("directory contains too many entries")
		}
		result := make([]map[string]any, 0, len(files))
		for _, f := range files {
			result = append(result, fileMetadata(path.Join(resolved, f.Name()), f))
		}
		return map[string]any{"path": resolved, "parent": path.Dir(resolved), "files": result, "can_read": true}, nil
	case "stat":
		f, err := fileClient.Lstat(input.Path)
		if err != nil {
			return nil, err
		}
		return fileMetadata(input.Path, f), nil
	case "mkdir":
		if err := fileClient.Mkdir(input.Path); err != nil {
			return nil, err
		}
		f, err := fileClient.Lstat(input.Path)
		if err != nil {
			return nil, err
		}
		return fileMetadata(input.Path, f), nil
	case "remove":
		if path.Clean(input.Path) == "/" || path.Clean(input.Path) == "." || path.Clean(input.Path) == ".." {
			return nil, errors.New("cannot remove root directory")
		}
		f, err := fileClient.Lstat(input.Path)
		if err != nil {
			return nil, err
		}
		if f.IsDir() {
			err = fileClient.RemoveDirectory(input.Path)
		} else {
			err = fileClient.Remove(input.Path)
		}
		return fileMetadata(input.Path, f), err
	case "rename":
		var err error
		if input.Overwrite {
			err = fileClient.PosixRename(input.Path, input.Destination)
		} else {
			err = fileClient.Rename(input.Path, input.Destination)
		}
		if err != nil {
			return nil, err
		}
		f, err := fileClient.Lstat(input.Destination)
		if err != nil {
			return nil, err
		}
		return fileMetadata(input.Destination, f), nil
	case "chmod":
		mode, err := strconv.ParseUint(input.Mode, 8, 12)
		if err != nil {
			return nil, err
		}
		return nil, fileClient.Chmod(input.Path, os.FileMode(mode))
	case "disk_usage":
		stat, err := fileClient.StatVFS(input.Path)
		if err != nil {
			return nil, err
		}
		total := stat.Blocks * stat.Frsize
		available := stat.Bavail * stat.Frsize
		used := (stat.Blocks - stat.Bfree) * stat.Frsize
		percent := float64(0)
		if total > 0 {
			percent = 100 * float64(used) / float64(total)
		}
		return map[string]any{"path": input.Path, "total": total, "available": available, "used": used, "usage_percent": percent}, nil
	case "list":
		files, err := fileClient.ReadDir(input.Path)
		if err != nil {
			return nil, err
		}
		if len(files) > 10000 {
			return nil, errors.New("directory contains too many entries")
		}
		result := make([]map[string]any, 0, len(files))
		for _, f := range files {
			result = append(result, map[string]any{"name": f.Name(), "size": f.Size(), "directory": f.IsDir(), "mode": f.Mode().String()})
		}
		return result, nil
	case "download_open", "upload_open":
		r.mu.Lock()
		count := len(r.files)
		r.mu.Unlock()
		if count >= 4 {
			return nil, errors.New("too many open files")
		}
		flags := os.O_RDONLY
		if input.Type == "upload_open" {
			flags = os.O_WRONLY | os.O_CREATE | os.O_EXCL
		}
		file, err := fileClient.OpenFile(input.Path, flags)
		if err != nil {
			return nil, err
		}
		info, err := file.Stat()
		if err != nil {
			file.Close()
			return nil, err
		}
		if !info.Mode().IsRegular() {
			file.Close()
			return nil, errors.New("only regular files can be transferred")
		}
		handle := fmt.Sprint(r.sequence.Add(1))
		r.mu.Lock()
		r.files[handle] = openedFile{file: file, write: input.Type == "upload_open"}
		r.mu.Unlock()
		return map[string]any{"handle": handle, "size": info.Size()}, nil
	case "download_chunk", "upload_chunk", "file_close":
		r.mu.Lock()
		entry, ok := r.files[input.Handle]
		r.mu.Unlock()
		if !ok {
			return nil, errors.New("file handle is closed")
		}
		if input.Type == "file_close" {
			r.mu.Lock()
			delete(r.files, input.Handle)
			r.mu.Unlock()
			return nil, entry.file.Close()
		}
		if input.Offset < 0 {
			return nil, errors.New("invalid file offset")
		}
		if input.Type == "upload_chunk" {
			if !entry.write || len(input.Data) > 90000 {
				return nil, errors.New("invalid upload chunk")
			}
			data, err := base64.StdEncoding.DecodeString(input.Data)
			if err != nil || len(data) > 64<<10 {
				return nil, errors.New("invalid upload chunk")
			}
			n, err := entry.file.WriteAt(data, input.Offset)
			if err == nil && n != len(data) {
				err = io.ErrShortWrite
			}
			return n, err
		}
		if entry.write {
			return nil, errors.New("file is not open for reading")
		}
		buffer := make([]byte, 64<<10)
		n, err := entry.file.ReadAt(buffer, input.Offset)
		if err != nil && err != io.EOF {
			return nil, err
		}
		return map[string]any{"data": base64.StdEncoding.EncodeToString(buffer[:n]), "eof": err == io.EOF}, nil
	}
	return nil, errors.New("unknown file operation")
}

func fileMetadata(filename string, f os.FileInfo) map[string]any {
	return map[string]any{"name": f.Name(), "path": filename, "size": f.Size(), "mode": uint32(f.Mode().Perm()), "mod_time": f.ModTime().UTC().Format(time.RFC3339), "is_dir": f.IsDir(), "is_link": f.Mode()&os.ModeSymlink != 0, "permission": f.Mode().String()}
}

type boundedOutput struct {
	mu    sync.Mutex
	data  []byte
	limit int
}

func (b *boundedOutput) Write(data []byte) (int, error) {
	b.mu.Lock()
	defer b.mu.Unlock()
	if len(b.data)+len(data) > b.limit {
		return 0, errors.New("command output exceeds 4 MiB")
	}
	b.data = append(b.data, data...)
	return len(data), nil
}

func main() {
	ctx, cancel := context.WithCancel(context.Background())
	r := &runtime{ctx: ctx, cancel: cancel, prompts: make(map[string]chan command), files: make(map[string]openedFile), input: make(chan []byte, 64), outputSlots: make(chan struct{}, 32)}
	fileCommands := make(chan command, 8)
	go func() {
		for {
			select {
			case input := <-fileCommands:
				result, err := r.fileCommand(input)
				message := map[string]any{"id": input.ID, "result": result}
				if err != nil {
					message["error"] = err.Error()
				}
				emit("result", message)
			case <-ctx.Done():
				return
			}
		}
	}()
	started := false
	dispatch := js.FuncOf(func(_ js.Value, args []js.Value) any {
		if len(args) != 1 {
			return nil
		}
		var input command
		if err := json.Unmarshal([]byte(args[0].String()), &input); err != nil {
			emit("error", "invalid browser SSH message")
			return nil
		}
		switch input.Type {
		case "connect":
			if started {
				emit("error", "connection already started")
				return nil
			}
			started = true
			go r.start(input)
		case "reply":
			r.reply(input)
		case "close":
			go r.close()
		case "output_ack":
			select {
			case <-r.outputSlots:
			default:
			}
		case "input":
			data, err := base64.StdEncoding.DecodeString(input.Data)
			if err != nil || len(data) > 32<<10 {
				emit("error", "terminal input is too large")
				go r.close()
				return nil
			}
			select {
			case r.input <- data:
			default:
				emit("error", "terminal input queue is full")
				go r.close()
			}
		case "resize":
			if input.Cols > 0 && input.Cols <= 1000 && input.Rows > 0 && input.Rows <= 1000 {
				go func() {
					r.mu.Lock()
					terminal := r.terminal
					r.mu.Unlock()
					if terminal != nil {
						_ = terminal.WindowChange(input.Rows, input.Cols)
					}
				}()
			}
		default:
			select {
			case fileCommands <- input:
			default:
				emit("result", map[string]any{"id": input.ID, "error": "file operation queue is full"})
			}
		}
		return nil
	})
	js.Global().Set("easysshDispatch", dispatch)
	emit("runtime_ready", nil)
	select {}
}
