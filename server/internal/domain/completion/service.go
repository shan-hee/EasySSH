package completion

import (
	"context"
	"github.com/easyssh/server/internal/access"
	"github.com/easyssh/shared/protocol"
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
	FetchCompletionData(ctx context.Context, client *ssh.Client, serverID uuid.UUID, opts FetchOptions) (*CompletionData, error)
	ClearCache(actor protocol.Actor, serverID uuid.UUID)
	ClearActorCache(actor protocol.Actor)
	ClearAllCache()
}

type cacheKey struct {
	actor          protocol.Actor
	serverID       uuid.UUID
	includeHistory bool
	includeScripts bool
}

type service struct {
	scripts script.Service
	cache   *ttlcache.Cache[cacheKey, *CompletionData]
}

func NewService(scripts script.Service) Service {
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
	return &service{scripts: scripts, cache: cache}
}

func (s *service) FetchCompletionData(ctx context.Context, client *ssh.Client, serverID uuid.UUID, opts FetchOptions) (*CompletionData, error) {
	scope := access.Current(ctx)
	if err := scope.Check(ctx, access.Requirement{Action: protocol.TerminalConnect, ServerID: serverID.String()}); err != nil {
		return nil, err
	}
	if scope.RequireOwner(ctx, protocol.ResourcesManage) != nil {
		opts.IncludeScripts = false
	}
	key := cacheKey{
		actor:          scope.Actor(),
		serverID:       serverID,
		includeHistory: opts.IncludeHistory,
		includeScripts: opts.IncludeScripts,
	}
	if item := s.cache.Get(key); item != nil {
		slog.Debug("completion cache hit", "actor", scope.Actor(), "server_id", serverID)
		return cloneCompletionData(item.Value()), nil
	}

	slog.Debug("completion cache miss", "actor", scope.Actor(), "server_id", serverID)
	history := []string{}
	if opts.IncludeHistory {
		remoteHistory, err := sshutil.FetchCompletionHistory(ctx, client)
		if err != nil {
			slog.Warn("failed to fetch shell history", "error", err)
		} else {
			history = remoteHistory
		}
	}

	scripts := []ScriptItem{}
	if opts.IncludeScripts {
		response, err := s.scripts.ListScripts(ctx, &script.ListScriptsRequest{
			Page:      1,
			Limit:     100,
			SkipCount: true,
		})
		if err != nil {
			slog.Warn("failed to fetch completion scripts", "error", err)
		} else {
			for _, item := range response.Data {
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

	if err := scope.Check(ctx, access.Requirement{Action: protocol.TerminalConnect, ServerID: serverID.String()}); err != nil {
		return nil, err
	}
	data := &CompletionData{History: history, Scripts: scripts}
	s.cache.Set(key, cloneCompletionData(data), completionCacheTTL)
	return data, nil
}

func (s *service) ClearCache(actor protocol.Actor, serverID uuid.UUID) {
	s.deleteMatching(func(key cacheKey) bool {
		return key.actor == actor && key.serverID == serverID
	})
}

func (s *service) ClearActorCache(actor protocol.Actor) {
	s.deleteMatching(func(key cacheKey) bool { return key.actor == actor })
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
