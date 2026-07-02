package rest

import (
	"context"
	"net/http"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/easyssh/server/internal/platform"
	"github.com/easyssh/shared/updatecheck"
	"github.com/gin-gonic/gin"
)

const updateCheckCacheTTL = 10 * time.Minute

type UpdateCheckHandler struct {
	runtimeInfo platform.RuntimeInfo
	fetcher     updatecheck.Fetcher

	mu       sync.Mutex
	cached   *updatecheck.Manifest
	cachedAt time.Time
}

func NewUpdateCheckHandler(runtimeInfo platform.RuntimeInfo) *UpdateCheckHandler {
	manifestURL := strings.TrimSpace(os.Getenv("EASYSSH_UPDATE_MANIFEST_URL"))
	if manifestURL == "" {
		manifestURL = updatecheck.DefaultManifestURL
	}

	return &UpdateCheckHandler{
		runtimeInfo: runtimeInfo,
		fetcher: updatecheck.Fetcher{
			URL: manifestURL,
		},
	}
}

func (h *UpdateCheckHandler) Check(c *gin.Context) {
	target := strings.ToLower(strings.TrimSpace(c.DefaultQuery("target", "web")))
	if target == "" {
		target = "web"
	}
	if target != "web" {
		RespondError(c, http.StatusBadRequest, "invalid_target", "Only web update checks are supported by this endpoint")
		return
	}

	manifest, err := h.getManifest(c.Request.Context())
	if err != nil {
		RespondError(c, http.StatusBadGateway, "update_check_failed", err.Error())
		return
	}

	currentVersion := h.runtimeInfo.Version
	if requestedVersion := strings.TrimSpace(c.Query("current_version")); updatecheck.IsComparableVersion(requestedVersion) {
		currentVersion = requestedVersion
	}

	result := updatecheck.BuildCheckResult(currentVersion, target, manifest)
	RespondSuccess(c, result)
}

func (h *UpdateCheckHandler) getManifest(ctx context.Context) (*updatecheck.Manifest, error) {
	h.mu.Lock()
	if h.cached != nil && time.Since(h.cachedAt) < updateCheckCacheTTL {
		manifest := h.cached
		h.mu.Unlock()
		return manifest, nil
	}
	h.mu.Unlock()

	manifest, err := h.fetcher.Fetch(ctx)

	h.mu.Lock()
	defer h.mu.Unlock()
	if err != nil {
		if h.cached != nil {
			return h.cached, nil
		}
		return nil, err
	}
	h.cached = manifest
	h.cachedAt = time.Now()
	return manifest, nil
}
