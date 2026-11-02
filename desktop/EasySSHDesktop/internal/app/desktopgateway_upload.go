package app

import (
	"errors"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/google/uuid"
)

type desktopUploadBody struct {
	io.ReadCloser
	controller *http.ResponseController
}

func (b desktopUploadBody) Close() error {
	// Closing net/http's body alone can wait behind a blocked Read. Interrupt
	// the socket read first when a task is cancelled or the app shuts down.
	_ = b.controller.SetReadDeadline(time.Now())
	return b.ReadCloser.Close()
}

// Browser File inputs and drag/drop both send a Blob to the authenticated
// loopback gateway. Bytes stream directly into SFTP without a base64 binding.
func (g *DesktopGateway) handleSFTPUpload(w http.ResponseWriter, r *http.Request) {
	// The local owner window holds the gateway token. CORS permits the custom
	// header but never grants authority; every upload must present that token.
	if origin := r.Header.Get("Origin"); origin != "" {
		w.Header().Set("Access-Control-Allow-Origin", origin)
		w.Header().Set("Vary", "Origin")
	}
	w.Header().Set("Cache-Control", "no-store")
	if r.Method == http.MethodOptions {
		w.Header().Set("Access-Control-Allow-Methods", "POST")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, X-EasySSH-Desktop-Gateway-Token")
		if r.Header.Get("Access-Control-Request-Private-Network") == "true" {
			w.Header().Set("Access-Control-Allow-Private-Network", "true")
		}
		w.WriteHeader(http.StatusNoContent)
		return
	}
	if r.Method != http.MethodPost {
		w.Header().Set("Allow", "POST, OPTIONS")
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if g.token == "" || r.Header.Get("X-EasySSH-Desktop-Gateway-Token") != g.token {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	if r.ContentLength < 0 {
		http.Error(w, "content length required", http.StatusLengthRequired)
		return
	}
	serverID := r.URL.Query().Get("serverId")
	taskID := r.URL.Query().Get("taskId")
	fileName := r.URL.Query().Get("fileName")
	remotePath := r.URL.Query().Get("path")
	serverUUID, serverErr := uuid.Parse(serverID)
	taskUUID, taskErr := uuid.Parse(taskID)
	if serverErr != nil || serverUUID == uuid.Nil || taskErr != nil || taskUUID == uuid.Nil ||
		fileName == "" || fileName == "." || fileName == ".." || strings.ContainsAny(fileName, "/\\\x00") || remotePath == "" {
		http.Error(w, "invalid upload destination", http.StatusBadRequest)
		return
	}
	defer r.Body.Close()
	body := desktopUploadBody{ReadCloser: r.Body, controller: http.NewResponseController(w)}
	_, err := g.sftpService.uploadStream(r.Context(), serverID, remotePath, fileName, taskID, r.ContentLength, body)
	if err != nil {
		if errors.Is(err, errDesktopSFTPTaskCancelled) {
			http.Error(w, "upload_cancelled", http.StatusConflict)
			return
		}
		if errors.Is(err, errDesktopSFTPCommitUnknown) {
			http.Error(w, err.Error(), http.StatusConflict)
			return
		}
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
