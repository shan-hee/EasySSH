package completion

import (
	"log/slog"
	"strings"
	"time"

	"github.com/easyssh/server/internal/domain/script"
	"github.com/google/uuid"
	"github.com/jellydator/ttlcache/v3"
	"golang.org/x/crypto/ssh"
)

const (
	defaultCacheTTLMinutes = 5
	defaultMaxCacheSize    = 1000
	defaultHistoryLimit    = 500
)

type ScriptItem struct {
	Name        string   `json:"name"`
	Content     string   `json:"content"`
	Description string   `json:"description"`
	Executions  int      `json:"executions"`
	Tags        []string `json:"tags"`
}

type CompletionData struct {
	History   []string     `json:"history"`
	Scripts   []ScriptItem `json:"scripts"`
	Timestamp int64        `json:"timestamp"`
}

type FetchOptions struct {
	HistoryLimit    int
	IncludeHistory  bool
	IncludeScripts  bool
	CacheTTLMinutes int
}

type Service interface {
	FetchCompletionData(client *ssh.Client, userID uuid.UUID, serverID uuid.UUID, opts FetchOptions) (*CompletionData, error)
	AppendHistoryCommand(userID uuid.UUID, serverID uuid.UUID, command string)
	ClearCache(userID uuid.UUID, serverID uuid.UUID)
	ClearUserCache(userID uuid.UUID)
	ClearAllCache()
}

type cacheKey struct {
	userID          uuid.UUID
	serverID        uuid.UUID
	historyLimit    int
	includeHistory  bool
	includeScripts  bool
	cacheTTLMinutes int
}

type service struct {
	scriptRepo script.Repository
	cache      *ttlcache.Cache[cacheKey, *CompletionData]
}

func NewService(scriptRepo script.Repository, cacheTTLMinutes int, maxCacheSize int) Service {
	if cacheTTLMinutes <= 0 {
		cacheTTLMinutes = defaultCacheTTLMinutes
	}
	if maxCacheSize <= 0 {
		maxCacheSize = defaultMaxCacheSize
	}
	cache := ttlcache.New(
		ttlcache.WithTTL[cacheKey, *CompletionData](time.Duration(cacheTTLMinutes)*time.Minute),
		ttlcache.WithCapacity[cacheKey, *CompletionData](uint64(maxCacheSize)),
		ttlcache.WithDisableTouchOnHit[cacheKey, *CompletionData](),
	)
	go cache.Start()

	slog.Info("completion cache initialized",
		"ttl_minutes", cacheTTLMinutes,
		"max_entries", maxCacheSize,
	)
	return &service{scriptRepo: scriptRepo, cache: cache}
}

func normalizeFetchOptions(opts FetchOptions) FetchOptions {
	if opts.IncludeHistory && opts.HistoryLimit <= 0 {
		opts.HistoryLimit = defaultHistoryLimit
	}
	if !opts.IncludeHistory {
		opts.HistoryLimit = 0
	}
	if opts.CacheTTLMinutes <= 0 {
		opts.CacheTTLMinutes = defaultCacheTTLMinutes
	}
	return opts
}

func (s *service) FetchCompletionData(client *ssh.Client, userID uuid.UUID, serverID uuid.UUID, opts FetchOptions) (*CompletionData, error) {
	opts = normalizeFetchOptions(opts)
	key := cacheKey{
		userID:          userID,
		serverID:        serverID,
		historyLimit:    opts.HistoryLimit,
		includeHistory:  opts.IncludeHistory,
		includeScripts:  opts.IncludeScripts,
		cacheTTLMinutes: opts.CacheTTLMinutes,
	}
	if item := s.cache.Get(key); item != nil {
		slog.Debug("completion cache hit", "user_id", userID, "server_id", serverID)
		return cloneCompletionData(item.Value()), nil
	}

	slog.Debug("completion cache miss", "user_id", userID, "server_id", serverID)
	history := []string{}
	if opts.IncludeHistory {
		shellType, err := DetectShellType(client)
		if err != nil {
			slog.Warn("failed to detect shell type", "error", err)
			shellType = ShellBash
		}
		history, err = FetchHistory(client, shellType, opts.HistoryLimit)
		if err != nil {
			slog.Warn("failed to fetch shell history", "error", err)
			history = []string{}
		}
	}

	scripts := []ScriptItem{}
	if opts.IncludeScripts {
		scriptList, _, err := s.scriptRepo.List(userID, &script.ListScriptsRequest{
			Page:      1,
			Limit:     100,
			SkipCount: true,
		})
		if err != nil {
			slog.Warn("failed to fetch completion scripts", "error", err)
		} else {
			for _, item := range scriptList {
				scripts = append(scripts, ScriptItem{
					Name:        item.Name,
					Content:     item.Content,
					Description: item.Description,
					Executions:  item.Executions,
					Tags:        append([]string(nil), item.Tags...),
				})
			}
		}
	}

	data := &CompletionData{History: history, Scripts: scripts}
	s.cache.Set(key, cloneCompletionData(data), time.Duration(opts.CacheTTLMinutes)*time.Minute)
	return data, nil
}

func (s *service) AppendHistoryCommand(userID uuid.UUID, serverID uuid.UUID, command string) {
	command = strings.TrimSpace(command)
	if command == "" {
		return
	}

	type update struct {
		key  cacheKey
		data *CompletionData
		ttl  time.Duration
	}
	updates := make([]update, 0)
	s.cache.Range(func(item *ttlcache.Item[cacheKey, *CompletionData]) bool {
		key := item.Key()
		if key.userID != userID || key.serverID != serverID || !key.includeHistory {
			return true
		}
		data := cloneCompletionData(item.Value())
		if data == nil {
			return true
		}
		nextHistory := make([]string, 0, len(data.History)+1)
		nextHistory = append(nextHistory, command)
		for _, existing := range data.History {
			if existing != command {
				nextHistory = append(nextHistory, existing)
			}
		}
		if key.historyLimit > 0 && len(nextHistory) > key.historyLimit {
			nextHistory = nextHistory[:key.historyLimit]
		}
		data.History = nextHistory
		updates = append(updates, update{key: key, data: data, ttl: item.TTL()})
		return true
	})
	for _, item := range updates {
		s.cache.Set(item.key, item.data, item.ttl)
	}
}

func (s *service) ClearCache(userID uuid.UUID, serverID uuid.UUID) {
	s.deleteMatching(func(key cacheKey) bool {
		return key.userID == userID && key.serverID == serverID
	})
}

func (s *service) ClearUserCache(userID uuid.UUID) {
	s.deleteMatching(func(key cacheKey) bool { return key.userID == userID })
}

func (s *service) ClearAllCache() {
	s.cache.DeleteAll()
}

func (s *service) deleteMatching(matches func(cacheKey) bool) {
	keys := make([]cacheKey, 0)
	s.cache.Range(func(item *ttlcache.Item[cacheKey, *CompletionData]) bool {
		if matches(item.Key()) {
			keys = append(keys, item.Key())
		}
		return true
	})
	for _, key := range keys {
		s.cache.Delete(key)
	}
}

func cloneCompletionData(data *CompletionData) *CompletionData {
	if data == nil {
		return nil
	}
	cloned := &CompletionData{
		History:   append([]string(nil), data.History...),
		Scripts:   make([]ScriptItem, len(data.Scripts)),
		Timestamp: data.Timestamp,
	}
	for i, item := range data.Scripts {
		cloned.Scripts[i] = item
		cloned.Scripts[i].Tags = append([]string(nil), item.Tags...)
	}
	return cloned
}
