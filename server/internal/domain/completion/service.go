package completion

import (
	"log/slog"
	"time"

	"github.com/easyssh/server/internal/domain/script"
	"github.com/easyssh/shared/sshutil"
	"github.com/google/uuid"
	"github.com/jellydator/ttlcache/v3"
	"golang.org/x/crypto/ssh"
)

const (
	completionCacheTTL     = 5 * time.Minute
	completionMaxCacheSize = 1000
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
	IncludeHistory bool
	IncludeScripts bool
}

type Service interface {
	FetchCompletionData(client *ssh.Client, userID uuid.UUID, serverID uuid.UUID, opts FetchOptions) (*CompletionData, error)
	ClearCache(userID uuid.UUID, serverID uuid.UUID)
	ClearUserCache(userID uuid.UUID)
	ClearAllCache()
}

type cacheKey struct {
	userID         uuid.UUID
	serverID       uuid.UUID
	includeHistory bool
	includeScripts bool
}

type service struct {
	scriptRepo script.Repository
	cache      *ttlcache.Cache[cacheKey, *CompletionData]
}

func NewService(scriptRepo script.Repository) Service {
	cache := ttlcache.New(
		ttlcache.WithTTL[cacheKey, *CompletionData](completionCacheTTL),
		ttlcache.WithCapacity[cacheKey, *CompletionData](completionMaxCacheSize),
		ttlcache.WithDisableTouchOnHit[cacheKey, *CompletionData](),
	)
	go cache.Start()

	slog.Info("completion cache initialized",
		"ttl_minutes", int(completionCacheTTL/time.Minute),
		"max_entries", completionMaxCacheSize,
	)
	return &service{scriptRepo: scriptRepo, cache: cache}
}

func (s *service) FetchCompletionData(client *ssh.Client, userID uuid.UUID, serverID uuid.UUID, opts FetchOptions) (*CompletionData, error) {
	key := cacheKey{
		userID:         userID,
		serverID:       serverID,
		includeHistory: opts.IncludeHistory,
		includeScripts: opts.IncludeScripts,
	}
	if item := s.cache.Get(key); item != nil {
		slog.Debug("completion cache hit", "user_id", userID, "server_id", serverID)
		return cloneCompletionData(item.Value()), nil
	}

	slog.Debug("completion cache miss", "user_id", userID, "server_id", serverID)
	history := []string{}
	if opts.IncludeHistory {
		remoteHistory, err := sshutil.FetchCompletionHistory(client)
		if err != nil {
			slog.Warn("failed to fetch shell history", "error", err)
		} else {
			history = remoteHistory
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
	s.cache.Set(key, cloneCompletionData(data), completionCacheTTL)
	return data, nil
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
