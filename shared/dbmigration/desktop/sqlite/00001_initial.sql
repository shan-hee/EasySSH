-- +goose Up

CREATE TABLE desktop_ssh_keys (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 name TEXT NOT NULL, public_key TEXT NOT NULL, fingerprint TEXT NOT NULL UNIQUE,
 algorithm TEXT NOT NULL, key_size INTEGER NOT NULL DEFAULT 0,
 passphrase_required INTEGER NOT NULL DEFAULT 0,
 private_key TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
 );

CREATE TABLE desktop_servers (
			id TEXT PRIMARY KEY,
			user_id TEXT NOT NULL DEFAULT 'local',
			name TEXT NOT NULL DEFAULT '',
			host TEXT NOT NULL,
			port INTEGER NOT NULL DEFAULT 22,
			username TEXT NOT NULL,
			auth_method TEXT NOT NULL DEFAULT 'password',
			password TEXT NOT NULL DEFAULT '',
			ssh_key_id INTEGER REFERENCES desktop_ssh_keys(id) ON DELETE RESTRICT,
			server_group TEXT NOT NULL DEFAULT '',
			tags_json TEXT NOT NULL DEFAULT '[]',
			status TEXT NOT NULL DEFAULT 'offline',
			last_connected TEXT NOT NULL DEFAULT '',
			description TEXT NOT NULL DEFAULT '',
			os TEXT NOT NULL DEFAULT '',
			sort_order INTEGER NOT NULL DEFAULT 0,
			created_at TEXT NOT NULL,
			updated_at TEXT NOT NULL
		);

CREATE TABLE desktop_sync_spaces (
            id TEXT PRIMARY KEY,
            instance_id TEXT NOT NULL,
            user_id TEXT NOT NULL,
            account_name TEXT NOT NULL,
            server_url TEXT NOT NULL,
            scopes TEXT NOT NULL DEFAULT '{}',
            document TEXT NOT NULL DEFAULT '',
            remote_heads TEXT NOT NULL DEFAULT '[]',
            last_sync TEXT NOT NULL DEFAULT '',
            UNIQUE(instance_id,user_id)
        );

CREATE TABLE desktop_sync_records (
            kind TEXT NOT NULL CHECK(kind IN ('server','script')),
            local_id TEXT NOT NULL,
            space_id TEXT NOT NULL REFERENCES desktop_sync_spaces(id),
            remote_id TEXT NOT NULL,
            PRIMARY KEY(kind,local_id),
            UNIQUE(space_id,kind,remote_id)
        );

CREATE TABLE desktop_ai_config (
			id TEXT PRIMARY KEY,
			use_system_config INTEGER NOT NULL DEFAULT 0,
			custom_enabled INTEGER NOT NULL DEFAULT 0,
			custom_provider TEXT NOT NULL DEFAULT 'openai',
			custom_endpoint TEXT NOT NULL DEFAULT '',
			custom_api_key TEXT NOT NULL DEFAULT '',
			custom_models TEXT NOT NULL DEFAULT '',
			updated_at TEXT NOT NULL
		);

CREATE TABLE desktop_sync_vault (
          space_id TEXT NOT NULL REFERENCES desktop_sync_spaces(id),kind TEXT NOT NULL,remote_id TEXT NOT NULL,local_id TEXT NOT NULL DEFAULT '',
          document TEXT NOT NULL DEFAULT '',current_ref TEXT NOT NULL DEFAULT '',observed_ref TEXT NOT NULL DEFAULT '',applied_ref TEXT NOT NULL DEFAULT '',
          heads TEXT NOT NULL DEFAULT '[]',conflicts TEXT NOT NULL DEFAULT '[]',revision INTEGER NOT NULL DEFAULT 0,
          PRIMARY KEY(space_id,kind,remote_id)
        );

CREATE TABLE desktop_sync_objects (
          space_id TEXT NOT NULL,id TEXT NOT NULL,kind TEXT NOT NULL,resource_id TEXT NOT NULL,ciphertext TEXT NOT NULL,
          uploaded INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(space_id,id)
        );

CREATE TABLE desktop_sync_state (
            id INTEGER PRIMARY KEY CHECK(id=1),
            space_id TEXT NOT NULL DEFAULT '',
            token TEXT NOT NULL DEFAULT '',
            grants TEXT NOT NULL DEFAULT '{}',
            enabled INTEGER NOT NULL DEFAULT 0,
            revision INTEGER NOT NULL DEFAULT 0
        );

INSERT OR IGNORE INTO desktop_sync_state(id) VALUES(1);

CREATE INDEX idx_desktop_servers_ssh_key ON desktop_servers (ssh_key_id);

CREATE INDEX idx_desktop_servers_host ON desktop_servers (host);

CREATE INDEX idx_desktop_servers_group ON desktop_servers (server_group);

CREATE INDEX idx_desktop_servers_sort ON desktop_servers (sort_order);

CREATE TABLE desktop_scripts (
			id TEXT PRIMARY KEY,
			user_id TEXT NOT NULL DEFAULT 'local',
			name TEXT NOT NULL,
			description TEXT NOT NULL DEFAULT '',
			content TEXT NOT NULL,
			language TEXT NOT NULL DEFAULT 'bash',
			tags_json TEXT NOT NULL DEFAULT '[]',
			executions INTEGER NOT NULL DEFAULT 0,
			author TEXT NOT NULL DEFAULT 'desktop',
			created_at TEXT NOT NULL,
			updated_at TEXT NOT NULL
		);

CREATE INDEX idx_desktop_scripts_name ON desktop_scripts (name);

CREATE INDEX idx_desktop_scripts_language ON desktop_scripts (language);

CREATE INDEX idx_desktop_scripts_updated_at ON desktop_scripts (updated_at DESC);

CREATE TABLE desktop_batch_tasks (
			id TEXT PRIMARY KEY,
			user_id TEXT NOT NULL DEFAULT 'local',
			task_name TEXT NOT NULL,
			task_type TEXT NOT NULL,
			content TEXT NOT NULL DEFAULT '',
			script_id TEXT NOT NULL DEFAULT '',
			server_ids_json TEXT NOT NULL DEFAULT '[]',
			execution_mode TEXT NOT NULL DEFAULT 'parallel',
			status TEXT NOT NULL DEFAULT 'pending',
			success_count INTEGER NOT NULL DEFAULT 0,
			failed_count INTEGER NOT NULL DEFAULT 0,
			started_at TEXT NOT NULL DEFAULT '',
			completed_at TEXT NOT NULL DEFAULT '',
			duration INTEGER NOT NULL DEFAULT 0,
			created_at TEXT NOT NULL,
			updated_at TEXT NOT NULL
		);

CREATE INDEX idx_desktop_batch_tasks_created_at ON desktop_batch_tasks (created_at DESC);

CREATE INDEX idx_desktop_batch_tasks_status ON desktop_batch_tasks (status);

CREATE INDEX idx_desktop_batch_tasks_type ON desktop_batch_tasks (task_type);

CREATE TABLE desktop_batch_task_results (
			id TEXT PRIMARY KEY,
			task_id TEXT NOT NULL,
			server_id TEXT NOT NULL DEFAULT '',
			server_name TEXT NOT NULL DEFAULT '',
			server_host TEXT NOT NULL DEFAULT '',
			status TEXT NOT NULL,
			exit_code INTEGER NOT NULL DEFAULT 0,
			output TEXT NOT NULL DEFAULT '',
			error_message TEXT NOT NULL DEFAULT '',
			started_at TEXT NOT NULL,
			completed_at TEXT NOT NULL,
			duration_ms INTEGER NOT NULL DEFAULT 0,
			created_at TEXT NOT NULL
		);

CREATE INDEX idx_desktop_batch_results_task ON desktop_batch_task_results (task_id);

CREATE INDEX idx_desktop_batch_results_server ON desktop_batch_task_results (server_id);

CREATE TABLE activity_logs (
			id TEXT PRIMARY KEY,
			action TEXT NOT NULL,
			resource TEXT NOT NULL DEFAULT '',
			status TEXT NOT NULL DEFAULT 'success',
			server_id TEXT,
			duration_ms INTEGER,
			detail TEXT,
			created_at TEXT NOT NULL,
			updated_at TEXT NOT NULL
		);

CREATE INDEX idx_activity_logs_created_at ON activity_logs (created_at DESC);

CREATE INDEX idx_activity_logs_action ON activity_logs (action);

CREATE INDEX idx_activity_logs_status ON activity_logs (status);

CREATE INDEX idx_activity_logs_server ON activity_logs (server_id);

CREATE TABLE desktop_task_runs (
			id TEXT PRIMARY KEY, user_id TEXT NOT NULL DEFAULT 'local_owner', definition_id TEXT NOT NULL DEFAULT '',
			retry_of_id TEXT NOT NULL DEFAULT '', source_type TEXT NOT NULL DEFAULT '', source_id TEXT NOT NULL DEFAULT '',
			task_type TEXT NOT NULL, title TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', trigger_type TEXT NOT NULL DEFAULT 'manual',
			runner TEXT NOT NULL DEFAULT 'desktop', status TEXT NOT NULL DEFAULT 'queued', stage TEXT NOT NULL DEFAULT '',
			server_id TEXT NOT NULL DEFAULT '', server_name TEXT NOT NULL DEFAULT '', resource TEXT NOT NULL DEFAULT '',
			payload_json TEXT NOT NULL DEFAULT '', result_json TEXT NOT NULL DEFAULT '', progress INTEGER NOT NULL DEFAULT 0,
			total_count INTEGER NOT NULL DEFAULT 0, success_count INTEGER NOT NULL DEFAULT 0, failure_count INTEGER NOT NULL DEFAULT 0,
			bytes_total INTEGER NOT NULL DEFAULT 0, bytes_processed INTEGER NOT NULL DEFAULT 0, progress_json TEXT NOT NULL DEFAULT '',
			cancelable INTEGER NOT NULL DEFAULT 0, retryable INTEGER NOT NULL DEFAULT 0, attempt INTEGER NOT NULL DEFAULT 1,
			max_attempts INTEGER NOT NULL DEFAULT 1, error_code TEXT NOT NULL DEFAULT '', error_message TEXT NOT NULL DEFAULT '',
			cancel_requested_at TEXT NOT NULL DEFAULT '', started_at TEXT NOT NULL DEFAULT '', finished_at TEXT NOT NULL DEFAULT '',
			created_at TEXT NOT NULL, updated_at TEXT NOT NULL
		);

CREATE INDEX idx_desktop_task_runs_status ON desktop_task_runs (status);

CREATE INDEX idx_desktop_task_runs_finished ON desktop_task_runs (finished_at);

CREATE INDEX idx_desktop_task_runs_created ON desktop_task_runs (created_at DESC);

CREATE INDEX idx_desktop_task_runs_type ON desktop_task_runs (task_type);

CREATE TABLE desktop_task_events (
			id INTEGER PRIMARY KEY AUTOINCREMENT, task_run_id TEXT NOT NULL, user_id TEXT NOT NULL DEFAULT 'local_owner',
			level TEXT NOT NULL DEFAULT 'info', message TEXT NOT NULL, data_json TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL,
			FOREIGN KEY (task_run_id) REFERENCES desktop_task_runs(id) ON DELETE CASCADE
		);

CREATE INDEX idx_desktop_task_events_run ON desktop_task_events (task_run_id, created_at);

CREATE TABLE desktop_ai_sessions (
			id TEXT PRIMARY KEY,
 config_space_id TEXT NOT NULL DEFAULT 'local',
			title TEXT NOT NULL DEFAULT '',
			custom_title INTEGER NOT NULL DEFAULT 0,
			model TEXT NOT NULL DEFAULT '',
			permission_mode TEXT NOT NULL DEFAULT 'balanced',
			scope_json TEXT NOT NULL DEFAULT '{}',
			status TEXT NOT NULL DEFAULT 'idle',
			messages_json TEXT NOT NULL DEFAULT '[]',
			tasks_json TEXT NOT NULL DEFAULT '[]',
			ui_messages_json TEXT NOT NULL DEFAULT '[]',
			created_at TEXT NOT NULL,
			updated_at TEXT NOT NULL
		);

CREATE INDEX idx_desktop_ai_sessions_updated ON desktop_ai_sessions (updated_at DESC);

CREATE INDEX idx_desktop_ai_sessions_scope ON desktop_ai_sessions (scope_json);

-- +goose Down

DROP TABLE desktop_ai_sessions;
DROP TABLE desktop_task_events;
DROP TABLE desktop_task_runs;
DROP TABLE activity_logs;
DROP TABLE desktop_batch_task_results;
DROP TABLE desktop_batch_tasks;
DROP TABLE desktop_scripts;
DROP TABLE desktop_sync_state;
DROP TABLE desktop_sync_objects;
DROP TABLE desktop_sync_vault;
DROP TABLE desktop_ai_config;
DROP TABLE desktop_sync_records;
DROP TABLE desktop_sync_spaces;
DROP TABLE desktop_servers;
DROP TABLE desktop_ssh_keys;
