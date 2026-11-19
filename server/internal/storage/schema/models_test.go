package schema_test

import (
	"context"
	"database/sql"
	"sync"
	"testing"
	"time"

	airuntime "github.com/easyssh/server/internal/domain/aichat/runtime"
	"github.com/easyssh/server/internal/domain/aiconfig"
	"github.com/easyssh/server/internal/domain/auth"
	"github.com/easyssh/server/internal/domain/batchtask"
	"github.com/easyssh/server/internal/domain/chatbridge"
	"github.com/easyssh/server/internal/domain/content"
	"github.com/easyssh/server/internal/domain/datasync"
	"github.com/easyssh/server/internal/domain/grant"
	"github.com/easyssh/server/internal/domain/inboxnotification"
	"github.com/easyssh/server/internal/domain/jobqueue"
	"github.com/easyssh/server/internal/domain/notificationconfig"
	"github.com/easyssh/server/internal/domain/operationrecord"
	"github.com/easyssh/server/internal/domain/rdp"
	"github.com/easyssh/server/internal/domain/recyclebin"
	"github.com/easyssh/server/internal/domain/scheduledtask"
	"github.com/easyssh/server/internal/domain/script"
	"github.com/easyssh/server/internal/domain/security"
	"github.com/easyssh/server/internal/domain/server"
	"github.com/easyssh/server/internal/domain/sshhostkey"
	"github.com/easyssh/server/internal/domain/sshkey"
	"github.com/easyssh/server/internal/domain/systemconfig"
	"github.com/easyssh/server/internal/domain/taskcenter"
	"github.com/easyssh/server/internal/domain/transferjob"
	"github.com/easyssh/server/internal/domain/vnc"
	"github.com/easyssh/server/internal/storage/schema"
	"github.com/easyssh/shared/dbmigration"
	gormschema "gorm.io/gorm/schema"
)

// One model per table. A new table needs its model here; a new model field
// needs its column in every dialect's scripts.
var models = []any{
	&airuntime.AIMessageRecord{},
	&airuntime.AIModelMessageRecord{},
	&airuntime.AISessionRecord{},
	&airuntime.AISessionTaskRecord{},
	&airuntime.ToolExecutionRecord{},
	&aiconfig.Config{},
	&auth.KnownLoginDevice{},
	&auth.LoginAttempt{},
	&auth.Owner{},
	&auth.Session{},
	&auth.TicketRecord{},
	&auth.TOTPReplay{},
	&batchtask.BatchTask{},
	&chatbridge.Approval{},
	&chatbridge.Binding{},
	&chatbridge.BindRequest{},
	&chatbridge.Connection{},
	&chatbridge.ReceivedEvent{},
	&content.Record{},
	&datasync.Authorization{},
	&datasync.Device{},
	&datasync.Instance{},
	&datasync.State{},
	&datasync.VaultDocument{},
	&datasync.VaultObject{},
	&grant.AutomationToken{},
	&grant.BrowserContainer{},
	&grant.Grant{},
	&grant.Handoff{},
	&grant.Resource{},
	&grant.ScriptScope{},
	&grant.Session{},
	&inboxnotification.Notification{},
	&jobqueue.Job{},
	&notificationconfig.NotificationConfig{},
	&operationrecord.Coverage{},
	&operationrecord.OperationRecord{},
	&operationrecord.Resource{},
	&rdp.Config{},
	&recyclebin.Entry{},
	&scheduledtask.ScheduledTask{},
	&script.Script{},
	&security.SecurityConfig{},
	&server.Server{},
	&server.ServerAuth{},
	&server.ServerGroup{},
	&server.ServerTag{},
	&server.Tag{},
	&sshhostkey.SSHHostKey{},
	&sshkey.Alias{},
	&sshkey.SSHKey{},
	&systemconfig.SystemConfig{},
	&taskcenter.NotificationDelivery{},
	&taskcenter.TaskEvent{},
	&taskcenter.TaskRun{},
	&transferjob.TransferJob{},
	&vnc.Config{},
}

// Most service tests build tables from the models, while installations build
// them from the scripts. This is the check that both describe the same columns.
func TestModelsMatchInitializedSchema(t *testing.T) {
	for _, driver := range []string{"sqlite", "postgres", "mysql"} {
		t.Run(driver, func(t *testing.T) {
			ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
			defer cancel()
			db := newSchemaDatabase(t, ctx, driver)
			if err := schema.Initialize(ctx, db, driver); err != nil {
				t.Fatalf("initialize %s: %v", driver, err)
			}
			assertModelColumns(t, ctx, db, driver)
		})
	}
}

func assertModelColumns(t *testing.T, ctx context.Context, db *sql.DB, driver string) {
	t.Helper()
	tables, err := dbmigration.Tables(ctx, db, driver)
	if err != nil {
		t.Fatal(err)
	}
	columns := make(map[string]map[string]bool, len(tables))
	for _, table := range tables {
		columns[table] = map[string]bool{}
		for _, name := range schemaColumnNames(t, ctx, db, driver, table) {
			columns[table][name] = true
		}
	}

	modeled := map[string]bool{"goose_db_version": true}
	for _, model := range models {
		parsed, err := gormschema.Parse(model, &sync.Map{}, gormschema.NamingStrategy{})
		if err != nil {
			t.Fatalf("%T: %v", model, err)
		}
		existing, found := columns[parsed.Table]
		if !found {
			t.Errorf("%T maps to table %s, which the scripts do not create", model, parsed.Table)
			continue
		}
		modeled[parsed.Table] = true
		for _, name := range parsed.DBNames {
			if !existing[name] {
				t.Errorf("%T maps to column %s.%s, which the scripts do not create", model, parsed.Table, name)
			}
		}
	}
	for _, table := range tables {
		if !modeled[table] {
			t.Errorf("table %s has no model in this test", table)
		}
	}
}
