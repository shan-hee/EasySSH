package permission

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"regexp"
	"sort"
	"strings"
	"sync"

	"github.com/casbin/casbin/v2"
	"github.com/casbin/casbin/v2/model"
	gormadapter "github.com/casbin/gorm-adapter/v3"
	"github.com/google/uuid"
	"gorm.io/gorm"
)

var (
	ErrRoleNotFound          = errors.New("role not found")
	ErrRoleKeyExists         = errors.New("role key already exists")
	ErrRoleInUse             = errors.New("role is assigned to users")
	ErrSystemRole            = errors.New("system role cannot be deleted")
	ErrInvalidRole           = errors.New("invalid role")
	ErrInvalidPermission     = errors.New("invalid permission")
	ErrInvalidResourceGrant  = errors.New("invalid resource grant")
	ErrResourceGrantExists   = errors.New("resource grant already exists")
	ErrResourceGrantNotFound = errors.New("resource grant not found")
)

const casbinModel = `
[request_definition]
r = sub, role, obj, act

[policy_definition]
p = sub, obj, act

[role_definition]
g = _, _

[policy_effect]
e = some(where (p.eft == allow))

[matchers]
m = (r.sub == p.sub || r.role == p.sub || g(r.role, p.sub)) && (p.obj == "*" || keyMatch2(r.obj, p.obj)) && (p.act == "*" || r.act == p.act)
`

var roleKeyPattern = regexp.MustCompile(`^[a-z][a-z0-9_-]{1,63}$`)

type Service interface {
	ListPermissions(module, query string) []Permission
	ListRoles(ctx context.Context) ([]RoleView, error)
	GetRole(ctx context.Context, id uuid.UUID) (*RoleView, error)
	CreateRole(ctx context.Context, key, name, description string, parentKey *string, permissionCodes []string) (*RoleView, error)
	UpdateRole(ctx context.Context, id uuid.UUID, name, description string, parentKey *string, permissionCodes []string) (*RoleView, error)
	DeleteRole(ctx context.Context, id uuid.UUID) error
	RoleExists(ctx context.Context, key string) (bool, error)
	Authorize(ctx context.Context, userID uuid.UUID, roleKey, permissionCode, resource string) (bool, error)
	EffectivePermissionCodes(ctx context.Context, userID uuid.UUID, roleKey string) ([]string, error)
	ListResourceGrants(ctx context.Context, subjectType, subjectID string) ([]ResourceGrant, error)
	GrantResource(ctx context.Context, grant ResourceGrant) (*ResourceGrant, error)
	RevokeResource(ctx context.Context, grant ResourceGrant) error
	EnsureDefaults(ctx context.Context) error
}

type service struct {
	db         *gorm.DB
	enforcer   *casbin.SyncedEnforcer
	mu         sync.Mutex
	byCode     map[string]Permission
	permission []Permission
}

func NewService(db *gorm.DB) (Service, error) {
	adapter, err := gormadapter.NewAdapterByDB(db)
	if err != nil {
		return nil, fmt.Errorf("failed to initialize Casbin GORM adapter: %w", err)
	}
	casbinModel, err := model.NewModelFromString(casbinModel)
	if err != nil {
		return nil, fmt.Errorf("failed to parse Casbin model: %w", err)
	}
	enforcer, err := casbin.NewSyncedEnforcer(casbinModel, adapter)
	if err != nil {
		return nil, fmt.Errorf("failed to initialize Casbin enforcer: %w", err)
	}
	enforcer.EnableAutoSave(true)
	if err := enforcer.LoadPolicy(); err != nil {
		return nil, fmt.Errorf("failed to load Casbin policy: %w", err)
	}

	definitions := PermissionDefinitions()
	byCode := make(map[string]Permission, len(definitions))
	for _, definition := range definitions {
		byCode[definition.Code] = definition
	}
	return &service{db: db, enforcer: enforcer, byCode: byCode, permission: definitions}, nil
}

func (s *service) ListPermissions(module, query string) []Permission {
	module = strings.TrimSpace(module)
	query = strings.ToLower(strings.TrimSpace(query))
	result := make([]Permission, 0, len(s.permission))
	for _, definition := range s.permission {
		if module != "" && module != "all" && string(definition.Module) != module {
			continue
		}
		if query != "" && !strings.Contains(strings.ToLower(definition.Name), query) && !strings.Contains(definition.Code, query) {
			continue
		}
		result = append(result, definition)
	}
	return result
}

func (s *service) ListRoles(ctx context.Context) ([]RoleView, error) {
	var roles []Role
	if err := s.db.WithContext(ctx).Order("system DESC, created_at ASC").Find(&roles).Error; err != nil {
		return nil, err
	}
	result := make([]RoleView, 0, len(roles))
	for _, role := range roles {
		view, err := s.roleView(role)
		if err != nil {
			return nil, err
		}
		result = append(result, *view)
	}
	return result, nil
}

func (s *service) GetRole(ctx context.Context, id uuid.UUID) (*RoleView, error) {
	role, err := s.findRoleByID(ctx, id)
	if err != nil {
		return nil, err
	}
	return s.roleView(*role)
}

func (s *service) CreateRole(ctx context.Context, key, name, description string, parentKey *string, permissionCodes []string) (*RoleView, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	key = strings.TrimSpace(key)
	name = strings.TrimSpace(name)
	description = strings.TrimSpace(description)
	parentKey = normalizeParentKey(parentKey)
	if !roleKeyPattern.MatchString(key) || name == "" {
		return nil, ErrInvalidRole
	}
	if err := s.validatePermissionCodes(permissionCodes); err != nil {
		return nil, err
	}
	if parentKey != nil {
		if *parentKey == key {
			return nil, ErrInvalidRole
		}
		if exists, err := s.RoleExists(ctx, *parentKey); err != nil || !exists {
			if err != nil {
				return nil, err
			}
			return nil, ErrInvalidRole
		}
	}

	var count int64
	if err := s.db.WithContext(ctx).Model(&Role{}).Where("key = ?", key).Count(&count).Error; err != nil {
		return nil, err
	}
	if count != 0 {
		return nil, ErrRoleKeyExists
	}

	role := Role{Key: key, Name: name, Description: description, ParentKey: parentKey}
	if err := s.db.WithContext(ctx).Create(&role).Error; err != nil {
		return nil, err
	}
	if err := s.replaceRolePolicies(role.Key, parentKey, permissionCodes); err != nil {
		_ = s.db.WithContext(ctx).Unscoped().Delete(&role).Error
		return nil, err
	}
	return s.roleView(role)
}

func (s *service) UpdateRole(ctx context.Context, id uuid.UUID, name, description string, parentKey *string, permissionCodes []string) (*RoleView, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	role, err := s.findRoleByID(ctx, id)
	if err != nil {
		return nil, err
	}
	if role.System {
		return nil, ErrSystemRole
	}
	name = strings.TrimSpace(name)
	description = strings.TrimSpace(description)
	parentKey = normalizeParentKey(parentKey)
	if name == "" {
		return nil, ErrInvalidRole
	}
	if err := s.validatePermissionCodes(permissionCodes); err != nil {
		return nil, err
	}
	if err := s.validateParent(ctx, role.Key, parentKey); err != nil {
		return nil, err
	}

	role.Name = name
	role.Description = description
	role.ParentKey = parentKey
	if err := s.db.WithContext(ctx).Save(role).Error; err != nil {
		return nil, err
	}
	if err := s.replaceRolePolicies(role.Key, parentKey, permissionCodes); err != nil {
		return nil, err
	}
	return s.roleView(*role)
}

func (s *service) DeleteRole(ctx context.Context, id uuid.UUID) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	role, err := s.findRoleByID(ctx, id)
	if err != nil {
		return err
	}
	if role.System {
		return ErrSystemRole
	}
	var users int64
	if err := s.db.WithContext(ctx).Table("users").Where("role = ? AND deleted_at IS NULL", role.Key).Count(&users).Error; err != nil {
		return err
	}
	if users != 0 {
		return ErrRoleInUse
	}
	var defaults int64
	if err := s.db.WithContext(ctx).Table("system_config").Where("default_role = ? AND deleted_at IS NULL", role.Key).Count(&defaults).Error; err != nil {
		return err
	}
	if defaults != 0 {
		return ErrRoleInUse
	}
	var children int64
	if err := s.db.WithContext(ctx).Model(&Role{}).Where("parent_key = ?", role.Key).Count(&children).Error; err != nil {
		return err
	}
	if children != 0 {
		return ErrRoleInUse
	}
	if _, err := s.enforcer.RemoveFilteredPolicy(0, roleSubject(role.Key)); err != nil {
		return err
	}
	if _, err := s.enforcer.RemoveFilteredGroupingPolicy(0, roleSubject(role.Key)); err != nil {
		return err
	}
	if _, err := s.enforcer.RemoveFilteredGroupingPolicy(1, roleSubject(role.Key)); err != nil {
		return err
	}
	return s.db.WithContext(ctx).Delete(role).Error
}

func (s *service) RoleExists(ctx context.Context, key string) (bool, error) {
	var count int64
	err := s.db.WithContext(ctx).Model(&Role{}).Where("key = ?", strings.TrimSpace(key)).Count(&count).Error
	return count != 0, err
}

func (s *service) Authorize(_ context.Context, userID uuid.UUID, roleKey, permissionCode, resource string) (bool, error) {
	definition, ok := s.byCode[strings.TrimSpace(permissionCode)]
	if !ok {
		return false, ErrInvalidPermission
	}
	resource = strings.TrimSpace(resource)
	if resource == "" {
		resource = definition.Resource
	}
	return s.enforcer.Enforce(userSubject(userID.String()), roleSubject(roleKey), resource, definition.Code)
}

func (s *service) EffectivePermissionCodes(ctx context.Context, userID uuid.UUID, roleKey string) ([]string, error) {
	result := make([]string, 0, len(s.permission))
	for _, definition := range s.permission {
		allowed, err := s.Authorize(ctx, userID, roleKey, definition.Code, definition.Resource)
		if err != nil {
			return nil, err
		}
		if allowed {
			result = append(result, definition.Code)
		}
	}
	sort.Strings(result)
	return result, nil
}

func (s *service) ListResourceGrants(_ context.Context, subjectType, subjectID string) ([]ResourceGrant, error) {
	subject, err := normalizeSubject(subjectType, subjectID)
	if err != nil {
		return nil, err
	}
	policies, err := s.enforcer.GetFilteredPolicy(0, subject)
	if err != nil {
		return nil, err
	}
	result := make([]ResourceGrant, 0)
	for _, policy := range policies {
		if len(policy) < 3 {
			continue
		}
		definition, ok := s.byCode[policy[2]]
		if !ok || policy[1] == definition.Resource || strings.Contains(policy[1], "*") {
			continue
		}
		resourceType, resourceID, ok := strings.Cut(policy[1], "/")
		if !ok || resourceID == "" {
			continue
		}
		grant := ResourceGrant{SubjectType: subjectType, SubjectID: subjectID, PermissionCode: policy[2], ResourceType: resourceType, ResourceID: resourceID}
		grant.ID = grantID(grant)
		result = append(result, grant)
	}
	sort.Slice(result, func(i, j int) bool { return result[i].ID < result[j].ID })
	return result, nil
}

func (s *service) GrantResource(ctx context.Context, grant ResourceGrant) (*ResourceGrant, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	subject, object, err := s.validateGrant(ctx, grant)
	if err != nil {
		return nil, err
	}
	added, err := s.enforcer.AddPolicy(subject, object, grant.PermissionCode)
	if err != nil {
		return nil, err
	}
	if !added {
		return nil, ErrResourceGrantExists
	}
	grant.SubjectType = strings.TrimSpace(grant.SubjectType)
	grant.SubjectID = strings.TrimSpace(grant.SubjectID)
	grant.PermissionCode = strings.TrimSpace(grant.PermissionCode)
	grant.ResourceType = strings.TrimSpace(grant.ResourceType)
	grant.ResourceID = strings.TrimSpace(grant.ResourceID)
	grant.ID = grantID(grant)
	return &grant, nil
}

func (s *service) RevokeResource(ctx context.Context, grant ResourceGrant) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	subject, object, err := s.validateGrant(ctx, grant)
	if err != nil {
		return err
	}
	removed, err := s.enforcer.RemovePolicy(subject, object, grant.PermissionCode)
	if err != nil {
		return err
	}
	if !removed {
		return ErrResourceGrantNotFound
	}
	return nil
}

func (s *service) EnsureDefaults(ctx context.Context) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	for _, definition := range defaultRoles() {
		var role Role
		err := s.db.WithContext(ctx).Where("key = ?", definition.Key).First(&role).Error
		if err == nil {
			continue
		}
		if !errors.Is(err, gorm.ErrRecordNotFound) {
			return err
		}
		role = Role{Key: definition.Key, Name: definition.Name, Description: definition.Description, System: true}
		if err := s.db.WithContext(ctx).Create(&role).Error; err != nil {
			return err
		}
		if err := s.replaceRolePolicies(role.Key, nil, definition.PermissionCodes); err != nil {
			return err
		}
	}
	return nil
}

func (s *service) findRoleByID(ctx context.Context, id uuid.UUID) (*Role, error) {
	var role Role
	if err := s.db.WithContext(ctx).Where("id = ?", id).First(&role).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrRoleNotFound
		}
		return nil, err
	}
	return &role, nil
}

func (s *service) roleView(role Role) (*RoleView, error) {
	directPolicies, err := s.enforcer.GetFilteredPolicy(0, roleSubject(role.Key))
	if err != nil {
		return nil, err
	}
	direct := permissionCodesFromPolicies(directPolicies, s.byCode, true)
	implicitPolicies, err := s.enforcer.GetImplicitPermissionsForUser(roleSubject(role.Key))
	if err != nil {
		return nil, err
	}
	effective := permissionCodesFromPolicies(implicitPolicies, s.byCode, true)
	return &RoleView{Role: role, PermissionCodes: direct, EffectivePermissionCodes: effective}, nil
}

func (s *service) replaceRolePolicies(key string, parentKey *string, permissionCodes []string) error {
	subject := roleSubject(key)
	if _, err := s.enforcer.RemoveFilteredPolicy(0, subject); err != nil {
		return err
	}
	if _, err := s.enforcer.RemoveFilteredGroupingPolicy(0, subject); err != nil {
		return err
	}
	policies := make([][]string, 0, len(permissionCodes))
	for _, code := range uniqueSorted(permissionCodes) {
		definition := s.byCode[code]
		policies = append(policies, []string{subject, definition.Resource, code})
	}
	if len(policies) != 0 {
		if _, err := s.enforcer.AddPolicies(policies); err != nil {
			return err
		}
	}
	if parentKey != nil {
		if _, err := s.enforcer.AddGroupingPolicy(subject, roleSubject(*parentKey)); err != nil {
			return err
		}
	}
	return nil
}

func (s *service) validatePermissionCodes(codes []string) error {
	for _, code := range codes {
		if _, ok := s.byCode[strings.TrimSpace(code)]; !ok {
			return fmt.Errorf("%w: %s", ErrInvalidPermission, code)
		}
	}
	return nil
}

func (s *service) validateParent(ctx context.Context, roleKey string, parentKey *string) error {
	if parentKey == nil {
		return nil
	}
	if *parentKey == roleKey {
		return ErrInvalidRole
	}
	if exists, err := s.RoleExists(ctx, *parentKey); err != nil || !exists {
		if err != nil {
			return err
		}
		return ErrInvalidRole
	}
	current := *parentKey
	seen := map[string]struct{}{roleKey: {}}
	for current != "" {
		if _, ok := seen[current]; ok {
			return ErrInvalidRole
		}
		seen[current] = struct{}{}
		var role Role
		if err := s.db.WithContext(ctx).Where("key = ?", current).First(&role).Error; err != nil {
			return err
		}
		if role.ParentKey == nil {
			break
		}
		current = *role.ParentKey
	}
	return nil
}

func (s *service) validateGrant(ctx context.Context, grant ResourceGrant) (string, string, error) {
	grant.PermissionCode = strings.TrimSpace(grant.PermissionCode)
	definition, ok := s.byCode[grant.PermissionCode]
	if !ok {
		return "", "", ErrInvalidPermission
	}
	subject, err := normalizeSubject(grant.SubjectType, grant.SubjectID)
	if err != nil {
		return "", "", err
	}
	switch strings.TrimSpace(grant.SubjectType) {
	case "role":
		if exists, err := s.RoleExists(ctx, strings.TrimSpace(grant.SubjectID)); err != nil || !exists {
			if err != nil {
				return "", "", err
			}
			return "", "", ErrInvalidResourceGrant
		}
	case "user":
		userID, err := uuid.Parse(strings.TrimSpace(grant.SubjectID))
		if err != nil {
			return "", "", ErrInvalidResourceGrant
		}
		var count int64
		if err := s.db.WithContext(ctx).Table("users").Where("id = ? AND deleted_at IS NULL", userID).Count(&count).Error; err != nil {
			return "", "", err
		}
		if count == 0 {
			return "", "", ErrInvalidResourceGrant
		}
	}
	resourceType := strings.TrimSpace(grant.ResourceType)
	resourceID := strings.TrimSpace(grant.ResourceID)
	if resourceType == "" || resourceID == "" || strings.ContainsAny(resourceType+resourceID, "*?/") {
		return "", "", ErrInvalidResourceGrant
	}
	if definition.Resource != resourceType+"/*" {
		return "", "", ErrInvalidResourceGrant
	}
	return subject, resourceType + "/" + resourceID, nil
}

func normalizeParentKey(parentKey *string) *string {
	if parentKey == nil {
		return nil
	}
	value := strings.TrimSpace(*parentKey)
	if value == "" {
		return nil
	}
	return &value
}

func normalizeSubject(subjectType, subjectID string) (string, error) {
	subjectType = strings.TrimSpace(subjectType)
	subjectID = strings.TrimSpace(subjectID)
	if subjectID == "" {
		return "", ErrInvalidResourceGrant
	}
	switch subjectType {
	case "role":
		return roleSubject(subjectID), nil
	case "user":
		if _, err := uuid.Parse(subjectID); err != nil {
			return "", ErrInvalidResourceGrant
		}
		return userSubject(subjectID), nil
	default:
		return "", ErrInvalidResourceGrant
	}
}

func roleSubject(key string) string {
	return "role:" + strings.TrimSpace(key)
}

func userSubject(id string) string {
	return "user:" + strings.TrimSpace(id)
}

func permissionCodesFromPolicies(policies [][]string, definitions map[string]Permission, broadOnly bool) []string {
	codes := make([]string, 0)
	seen := make(map[string]struct{})
	for _, policy := range policies {
		if len(policy) < 3 {
			continue
		}
		definition, ok := definitions[policy[2]]
		if !ok || broadOnly && policy[1] != definition.Resource {
			continue
		}
		if _, ok := seen[policy[2]]; ok {
			continue
		}
		seen[policy[2]] = struct{}{}
		codes = append(codes, policy[2])
	}
	sort.Strings(codes)
	return codes
}

func uniqueSorted(values []string) []string {
	seen := make(map[string]struct{}, len(values))
	result := make([]string, 0, len(values))
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value == "" {
			continue
		}
		if _, ok := seen[value]; ok {
			continue
		}
		seen[value] = struct{}{}
		result = append(result, value)
	}
	sort.Strings(result)
	return result
}

func grantID(grant ResourceGrant) string {
	raw := strings.Join([]string{grant.SubjectType, grant.SubjectID, grant.PermissionCode, grant.ResourceType, grant.ResourceID}, "\x00")
	digest := sha256.Sum256([]byte(raw))
	return hex.EncodeToString(digest[:16])
}
