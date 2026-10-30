package script

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/easyssh/shared/protocol"
	"strings"

	"github.com/easyssh/server/internal/access"
	"github.com/easyssh/shared/scriptutil"
	"github.com/google/uuid"
	"gorm.io/gorm"
)

var (
	ErrScriptNotFound    = errors.New("script not found")
	ErrInvalidScriptData = errors.New("invalid script data")
)

type ExecutionPolicy interface {
	ScriptParameters(context.Context, access.Scope, access.Requirement) (map[string]protocol.GrantParameterRule, error)
	CheckScript(context.Context, access.Scope, access.Requirement, map[string]string) error
}

type Execution struct {
	ID      uuid.UUID
	Name    string
	Version string
	Command string
}

type Service interface {
	CreateScript(context.Context, string, *CreateScriptRequest) (*Script, error)
	UpdateScript(context.Context, uuid.UUID, *UpdateScriptRequest) (*Script, error)
	DeleteScript(context.Context, uuid.UUID) error
	GetScript(context.Context, uuid.UUID) (*Script, error)
	ListScripts(context.Context, *ListScriptsRequest) (*ListScriptsResponse, error)
	Available(context.Context, string, protocol.ScriptCatalogInput) (*protocol.ScriptCatalogPage, error)
	Resolve(context.Context, uuid.UUID, []string, map[string]string, string) (*Execution, error)
	RecordExecution(context.Context, uuid.UUID, string, string, map[string]string) error
}

type service struct {
	repo    Repository
	policy  ExecutionPolicy
	runtime *access.Runtime
}

func NewService(repo Repository, policy ExecutionPolicy, runtime *access.Runtime) Service {
	return &service{repo: repo, policy: policy, runtime: runtime}
}

func validate(row *Script) error {
	if err := scriptutil.ValidateMetadata(row.Name, row.Description, row.Tags); err != nil {
		return ErrInvalidScriptData
	}
	if _, err := scriptutil.Command(row.Language, row.Content, nil); err != nil {
		return fmt.Errorf("%w: %v", ErrInvalidScriptData, err)
	}
	return nil
}
func owner(ctx context.Context) error {
	return access.Current(ctx).RequireOwner(ctx, protocol.ResourcesManage)
}
func (s *service) CreateScript(ctx context.Context, author string, req *CreateScriptRequest) (*Script, error) {
	if err := owner(ctx); err != nil {
		return nil, err
	}
	if req == nil {
		return nil, ErrInvalidScriptData
	}
	language := req.Language
	if language == "" {
		language = "bash"
	}
	row := &Script{Name: strings.TrimSpace(req.Name), Description: req.Description, Content: req.Content, Language: language, Tags: req.Tags, Author: author}
	if err := validate(row); err != nil {
		return nil, err
	}
	if err := s.repo.Create(ctx, row); err != nil {
		return nil, err
	}
	return row, nil
}
func (s *service) UpdateScript(ctx context.Context, id uuid.UUID, req *UpdateScriptRequest) (*Script, error) {
	if err := owner(ctx); err != nil {
		return nil, err
	}
	if req == nil {
		return nil, ErrInvalidScriptData
	}
	row, err := s.lookup(ctx, id)
	if err != nil {
		return nil, err
	}
	before := row.Version
	beforeContent, beforeLanguage := row.Content, row.Language
	if req.Name != nil {
		row.Name = strings.TrimSpace(*req.Name)
	}
	if req.Description != nil {
		row.Description = *req.Description
	}
	if req.Content != nil {
		row.Content = *req.Content
	}
	if req.Language != nil {
		row.Language = *req.Language
	}
	if req.Tags != nil {
		row.Tags = req.Tags
	}
	if err := validate(row); err != nil {
		return nil, err
	}
	if err := s.repo.Update(ctx, id, beforeContent, beforeLanguage, map[string]interface{}{"name": row.Name, "description": row.Description, "content": row.Content, "language": row.Language, "tags": row.Tags}); err != nil {
		return nil, err
	}
	if before != scriptutil.Version(row.Language, row.Content) {
		s.runtime.InvalidateScript(id.String(), access.ErrResourceChanged)
	}
	return s.lookup(ctx, id)
}
func (s *service) DeleteScript(ctx context.Context, id uuid.UUID) error {
	if err := owner(ctx); err != nil {
		return err
	}
	if _, err := s.lookup(ctx, id); err != nil {
		return err
	}
	if err := s.repo.Delete(ctx, id); err != nil {
		return err
	}
	s.runtime.InvalidateScript(id.String(), access.ErrResourceChanged)
	return nil
}
func (s *service) lookup(ctx context.Context, id uuid.UUID) (*Script, error) {
	row, err := s.repo.GetByID(ctx, id)
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, ErrScriptNotFound
	}
	if err == nil && row.Version != scriptutil.Version(row.Language, row.Content) {
		return nil, access.ErrResourceChanged
	}
	return row, err
}
func (s *service) GetScript(ctx context.Context, id uuid.UUID) (*Script, error) {
	if err := owner(ctx); err != nil {
		return nil, err
	}
	return s.lookup(ctx, id)
}
func (s *service) ListScripts(ctx context.Context, req *ListScriptsRequest) (*ListScriptsResponse, error) {
	if err := owner(ctx); err != nil {
		return nil, err
	}
	if req == nil {
		req = &ListScriptsRequest{}
	}
	req.Page = max(1, req.Page)
	if req.Limit < 1 {
		req.Limit = 20
	}
	req.Limit = min(100, req.Limit)
	rows, total, err := s.repo.List(ctx, req)
	if err != nil {
		return nil, err
	}
	items := make([]protocol.Script, len(rows))
	for i := range rows {
		items[i] = rows[i].Public()
	}
	return &ListScriptsResponse{Data: items, Total: total, Page: req.Page, PageSize: req.Limit, TotalPages: int((total + int64(req.Limit) - 1) / int64(req.Limit))}, nil
}
func (s *service) Available(ctx context.Context, serverID string, input protocol.ScriptCatalogInput) (*protocol.ScriptCatalogPage, error) {
	input, err := scriptutil.NormalizeCatalogInput(input)
	if err != nil {
		return nil, err
	}
	scope := access.Current(ctx)
	if err := scope.Check(ctx, access.Requirement{Action: protocol.WorkspaceRead}); err != nil {
		return nil, err
	}
	id, err := uuid.Parse(serverID)
	if err != nil || id == uuid.Nil || id.String() != serverID {
		return nil, ErrInvalidScriptData
	}
	grantID := scope.Actor().GrantID
	if scope.IsOwner() {
		if err := scope.RequireOwner(ctx, protocol.ResourcesManage); err != nil {
			return nil, err
		}
	} else if grantID == "" {
		return nil, access.ErrForbidden
	}
	rows, more, err := s.repo.Available(ctx, grantID, serverID, input)
	if err != nil {
		return nil, err
	}
	page := &protocol.ScriptCatalogPage{ServerID: serverID, Items: []protocol.AvailableScript{}, NextAfterID: input.AfterID, HasMore: more}
	// Reserve envelope overhead; budget each encoded item before appending it.
	bytes := 512
	for _, candidate := range rows {
		row := protocol.AvailableScript{ID: candidate.ID, Name: candidate.Name, Description: candidate.Description, Language: candidate.Language, Version: candidate.Version}
		req := access.Requirement{Action: protocol.ScriptsExecute, ServerID: serverID, ScriptID: row.ID.String(), ScriptVersion: row.Version}
		rules, err := s.policy.ScriptParameters(ctx, scope, req)
		if err != nil {
			if errors.Is(err, access.ErrForbidden) || errors.Is(err, access.ErrResourceChanged) {
				page.NextAfterID = row.ID.String()
				continue
			}
			return nil, err
		}
		if err := scriptutil.ValidateParameterRules(rules); err != nil {
			return nil, err
		}
		row.Parameters = rules
		encoded, err := json.Marshal(row)
		if err != nil {
			return nil, err
		}
		if bytes+len(encoded)+1 > scriptutil.MaxCatalogBytes {
			// Do not consume this row. The next request must still see it.
			if len(page.Items) == 0 {
				return nil, ErrInvalidScriptData
			}
			page.HasMore = true
			break
		}
		bytes += len(encoded) + 1
		page.Items = append(page.Items, row)
		page.NextAfterID = row.ID.String()
	}
	if err := scope.Check(ctx, access.Requirement{Action: protocol.WorkspaceRead}); err != nil {
		return nil, err
	}
	return page, nil
}
func (s *service) Resolve(ctx context.Context, id uuid.UUID, servers []string, parameters map[string]string, expected string) (*Execution, error) {
	if len(servers) == 0 || len(servers) > 100 {
		return nil, ErrInvalidScriptData
	}
	if err := scriptutil.ValidateParameters(parameters); err != nil {
		return nil, fmt.Errorf("%w: %v", ErrInvalidScriptData, err)
	}
	row, err := s.lookup(ctx, id)
	if err != nil {
		return nil, err
	}
	scope := access.Current(ctx)
	if expected == "" && !scope.IsOwner() || expected != "" && expected != row.Version {
		return nil, access.ErrResourceChanged
	}
	for _, serverID := range servers {
		req := access.Requirement{Action: protocol.ScriptsExecute, ServerID: serverID, ScriptID: id.String(), ScriptVersion: row.Version}
		if err := s.policy.CheckScript(ctx, scope, req, parameters); err != nil {
			return nil, err
		}
	}
	command, err := scriptutil.Command(row.Language, row.Content, parameters)
	if err != nil {
		return nil, err
	}
	return &Execution{ID: id, Name: row.Name, Version: row.Version, Command: command}, nil
}
func (s *service) RecordExecution(ctx context.Context, id uuid.UUID, serverID, version string, parameters map[string]string) error {
	if _, err := s.Resolve(ctx, id, []string{serverID}, parameters, version); err != nil {
		return err
	}
	return s.repo.IncrementExecutions(ctx, id, version)
}
