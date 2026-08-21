package systemconfig

import (
	"context"
	"fmt"
	"testing"

	"github.com/glebarez/sqlite"
	"github.com/google/uuid"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

func TestScheduledTaskConcurrencyDefaultsAndPersists(t *testing.T) {
	dsn := fmt.Sprintf("file:%s?mode=memory&cache=shared", uuid.NewString())
	database, err := gorm.Open(sqlite.Open(dsn), &gorm.Config{Logger: logger.Default.LogMode(logger.Silent)})
	if err != nil {
		t.Fatalf("open test database: %v", err)
	}
	if err := database.AutoMigrate(&SystemConfig{}); err != nil {
		t.Fatalf("migrate system config: %v", err)
	}

	service := NewService(NewRepository(database), nil, false)
	config, err := service.Get(context.Background())
	if err != nil {
		t.Fatalf("get default config: %v", err)
	}
	if config.JobQueueMaxConcurrency != 2 {
		t.Fatalf("default job queue max concurrency = %d, want 2", config.JobQueueMaxConcurrency)
	}

	config.JobQueueMaxConcurrency = 6
	if err := service.SaveScheduledTasks(context.Background(), config); err != nil {
		t.Fatalf("save scheduled task config: %v", err)
	}
	persisted, err := service.Get(context.Background())
	if err != nil {
		t.Fatalf("get persisted config: %v", err)
	}
	if persisted.JobQueueMaxConcurrency != 6 {
		t.Fatalf("persisted job queue max concurrency = %d, want 6", persisted.JobQueueMaxConcurrency)
	}
}

func TestScheduledTaskConcurrencyRejectsOutOfRangeValues(t *testing.T) {
	service := NewService(nil, nil, false)
	for _, value := range []int{0, 17} {
		config := &SystemConfig{JobQueueMaxConcurrency: value}
		if err := service.SaveScheduledTasks(context.Background(), config); err == nil {
			t.Fatalf("expected max concurrency %d to be rejected", value)
		}
	}
}
