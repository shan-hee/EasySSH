package permission

import (
	"context"
	"testing"

	"github.com/glebarez/sqlite"
	"github.com/google/uuid"
	"gorm.io/gorm"
)

func TestEnsureDefaultsSynchronizesExistingSystemAdminPermissions(t *testing.T) {
	db, err := gorm.Open(sqlite.Open("file:"+uuid.NewString()+"?mode=memory&cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&Role{}); err != nil {
		t.Fatal(err)
	}
	admin := &Role{Key: "admin", Name: "旧管理员", Description: "旧定义", System: true}
	if err := db.Create(admin).Error; err != nil {
		t.Fatal(err)
	}

	permissionService, err := NewService(db)
	if err != nil {
		t.Fatal(err)
	}
	service := permissionService.(*service)
	resourcePolicy := []string{roleSubject("admin"), "server/host-1", "server:view"}
	if added, err := service.enforcer.AddPolicy(resourcePolicy[0], resourcePolicy[1], resourcePolicy[2]); err != nil || !added {
		t.Fatalf("failed to seed resource policy: added=%v err=%v", added, err)
	}

	if err := service.EnsureDefaults(context.Background()); err != nil {
		t.Fatal(err)
	}
	allowed, err := service.Authorize(context.Background(), uuid.New(), "admin", "audit:manage", "audit/*")
	if err != nil {
		t.Fatal(err)
	}
	if !allowed {
		t.Fatal("existing System admin must receive audit:manage")
	}
	hasResourcePolicy, err := service.enforcer.HasPolicy(resourcePolicy[0], resourcePolicy[1], resourcePolicy[2])
	if err != nil {
		t.Fatal(err)
	}
	if !hasResourcePolicy {
		t.Fatal("default permission synchronization must preserve resource-level policies")
	}
	if err := db.First(admin, "key = ?", "admin").Error; err != nil {
		t.Fatal(err)
	}
	if admin.Name != "管理员" || admin.Description != "拥有全部系统管理权限" || !admin.System {
		t.Fatalf("unexpected synchronized role: %#v", admin)
	}
}
