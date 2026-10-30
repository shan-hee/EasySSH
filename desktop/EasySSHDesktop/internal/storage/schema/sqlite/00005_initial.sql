-- +goose Up

CREATE TABLE desktop_network_proxy (
 id INTEGER PRIMARY KEY CHECK(id=1),
 mode TEXT NOT NULL CHECK(mode IN ('system','direct','manual')),
 url TEXT NOT NULL DEFAULT '',
 username TEXT NOT NULL DEFAULT '',
 password TEXT NOT NULL DEFAULT ''
);
INSERT INTO desktop_network_proxy(id,mode) VALUES(1,'system');

-- Public metadata only. Access-session credentials live in the OS keychain;
-- original share secrets and desktop handoff verifiers are never persisted.
CREATE TABLE desktop_remote_workspaces (
 id TEXT PRIMARY KEY NOT NULL,
 origin TEXT NOT NULL,
 grant_id TEXT NOT NULL,
 public_id TEXT NOT NULL DEFAULT '',
 name TEXT NOT NULL,
 expires_at TEXT NOT NULL,
 last_opened_at TEXT NOT NULL,
 UNIQUE(origin, grant_id)
);

-- Transport receipts only: source-side tasks remain authoritative and these
-- rows never participate in local task/activity totals. No reusable credential
-- or native filesystem path is stored here.
CREATE TABLE desktop_remote_transfers (
 id TEXT PRIMARY KEY NOT NULL,
 workspace_id TEXT NOT NULL REFERENCES desktop_remote_workspaces(id) ON DELETE CASCADE,
 origin TEXT NOT NULL,
 actor_kind TEXT NOT NULL CHECK(actor_kind = 'access_session'),
 actor_id TEXT NOT NULL,
 actor_session_id TEXT NOT NULL,
 actor_grant_id TEXT NOT NULL,
 connection_id TEXT NOT NULL,
 server_id TEXT NOT NULL,
 kind TEXT NOT NULL CHECK(kind IN ('upload', 'download')),
 name TEXT NOT NULL,
 remote_path TEXT NOT NULL,
 source_task_id TEXT NOT NULL DEFAULT '',
 status TEXT NOT NULL CHECK(status IN ('running', 'canceling', 'succeeded', 'failed', 'canceled', 'unknown')),
 transferred INTEGER NOT NULL DEFAULT 0 CHECK(transferred >= 0),
 total INTEGER NOT NULL CHECK(total >= -1),
 error_code TEXT NOT NULL DEFAULT '',
 created_at TEXT NOT NULL,
 updated_at TEXT NOT NULL,
 finished_at TEXT NOT NULL DEFAULT '',
 CHECK(actor_id = actor_session_id)
);
CREATE INDEX idx_desktop_remote_transfers_scope ON desktop_remote_transfers(workspace_id, origin, actor_session_id, actor_grant_id, created_at DESC, id DESC);
CREATE INDEX idx_desktop_remote_transfers_source ON desktop_remote_transfers(origin, actor_session_id, source_task_id);
CREATE INDEX idx_desktop_remote_transfers_retention ON desktop_remote_transfers(status, updated_at);

CREATE TABLE desktop_ssh_keys (
 id TEXT PRIMARY KEY NOT NULL,
 saved_passphrase TEXT NOT NULL DEFAULT '',
 name TEXT NOT NULL, public_key TEXT NOT NULL, fingerprint TEXT NOT NULL UNIQUE,
 algorithm TEXT NOT NULL, key_size INTEGER NOT NULL DEFAULT 0,
 passphrase_required INTEGER NOT NULL DEFAULT 0,
 private_key TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
 );

CREATE TABLE desktop_server_groups (
 id TEXT PRIMARY KEY NOT NULL,
 name TEXT NOT NULL,
 sort_order INTEGER NOT NULL DEFAULT 0 CHECK(sort_order >= 0)
);
CREATE INDEX idx_desktop_server_groups_order ON desktop_server_groups(sort_order,id);

CREATE TABLE desktop_servers (
            connection_revision INTEGER NOT NULL DEFAULT 1 CHECK(connection_revision > 0),
			id TEXT PRIMARY KEY,
			user_id TEXT NOT NULL DEFAULT 'local',
			name TEXT NOT NULL DEFAULT '',
			host TEXT NOT NULL,
			port INTEGER NOT NULL DEFAULT 22 CHECK(port BETWEEN 1 AND 65535),
			username TEXT NOT NULL,
			group_id TEXT REFERENCES desktop_server_groups(id) ON DELETE SET NULL,
			last_connected TEXT NOT NULL DEFAULT '',
			description TEXT NOT NULL DEFAULT '',
			os TEXT NOT NULL DEFAULT '',
			sort_order INTEGER NOT NULL DEFAULT 0,
			created_at TEXT NOT NULL,
			updated_at TEXT NOT NULL
		);

CREATE TABLE desktop_tags (name TEXT PRIMARY KEY NOT NULL);
CREATE TABLE desktop_server_tags (
 server_id TEXT NOT NULL REFERENCES desktop_servers(id) ON DELETE CASCADE,
 tag_name TEXT NOT NULL REFERENCES desktop_tags(name) ON DELETE RESTRICT,
 PRIMARY KEY(server_id,tag_name)
);
CREATE INDEX idx_desktop_server_tags_name ON desktop_server_tags(tag_name,server_id);


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
            kind TEXT NOT NULL CHECK(kind IN ('server','script','group')),
            local_id TEXT NOT NULL,
            space_id TEXT NOT NULL REFERENCES desktop_sync_spaces(id),
            remote_id TEXT NOT NULL,
            PRIMARY KEY(kind,local_id),
            UNIQUE(space_id,kind,remote_id)
        );

CREATE TABLE desktop_ai_config (
			id TEXT PRIMARY KEY,
			enabled INTEGER NOT NULL DEFAULT 0,
			provider TEXT NOT NULL DEFAULT 'openai',
			endpoint TEXT NOT NULL DEFAULT '',
			api_key TEXT NOT NULL DEFAULT '',
			models TEXT NOT NULL DEFAULT '[]',
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



CREATE INDEX idx_desktop_servers_host ON desktop_servers (host);

CREATE INDEX idx_desktop_servers_group ON desktop_servers (group_id);

CREATE INDEX idx_desktop_servers_sort ON desktop_servers (sort_order);

CREATE TABLE desktop_scripts (
			id TEXT PRIMARY KEY,
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
			task_name TEXT NOT NULL,
			task_type TEXT NOT NULL,
			content TEXT NOT NULL DEFAULT '',
			script_id TEXT NOT NULL DEFAULT '',
			script_version TEXT NOT NULL DEFAULT '',
			parameters_json TEXT NOT NULL DEFAULT '{}',
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
			exit_code INTEGER,
			output TEXT NOT NULL DEFAULT '',
 output_content_id TEXT REFERENCES desktop_content_objects(id) ON DELETE RESTRICT,
			error_message TEXT NOT NULL DEFAULT '',
			started_at TEXT NOT NULL,
			completed_at TEXT NOT NULL,
			duration_ms INTEGER NOT NULL DEFAULT 0,
			created_at TEXT NOT NULL,
 CHECK (output_content_id IS NULL OR output='')
		);

CREATE INDEX idx_desktop_batch_results_content ON desktop_batch_task_results(output_content_id);

CREATE UNIQUE INDEX idx_desktop_batch_results_target ON desktop_batch_task_results(task_id,server_id);

CREATE INDEX idx_desktop_batch_results_server ON desktop_batch_task_results (server_id);

CREATE TABLE desktop_notifications (
 id TEXT PRIMARY KEY,
 event_type TEXT NOT NULL, severity TEXT NOT NULL, title TEXT NOT NULL, message TEXT NOT NULL,
 source_type TEXT NOT NULL DEFAULT '', source_id TEXT NOT NULL DEFAULT '', action_url TEXT NOT NULL DEFAULT '',
 read_at TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL
);
CREATE INDEX idx_desktop_notifications_created ON desktop_notifications(created_at,id);
CREATE INDEX idx_desktop_notifications_source ON desktop_notifications(source_type,source_id);

CREATE TABLE desktop_activity_coverage (
 id TEXT PRIMARY KEY CHECK(id='activity'),
 started_at TEXT NOT NULL,
 pruned_before TEXT NOT NULL DEFAULT ''
);
INSERT INTO desktop_activity_coverage(id,started_at) VALUES('activity',strftime('%Y-%m-%dT%H:%M:%fZ','now'));

CREATE TABLE activity_logs (
 detail_content_id TEXT REFERENCES desktop_content_objects(id) ON DELETE RESTRICT,
 detail_content_size INTEGER NOT NULL DEFAULT 0,
 detail_content_sha256 TEXT NOT NULL DEFAULT '',
 error_message TEXT NOT NULL DEFAULT '',
 task_content_id TEXT REFERENCES desktop_content_objects(id) ON DELETE RESTRICT,
 task_content_size INTEGER NOT NULL DEFAULT 0,
 task_content_sha256 TEXT NOT NULL DEFAULT '',

            id TEXT PRIMARY KEY,
            actor_kind TEXT NOT NULL, actor_id TEXT NOT NULL, actor_session_id TEXT NOT NULL, actor_grant_id TEXT NOT NULL DEFAULT '',
            work_id TEXT NOT NULL, parent_work_id TEXT NOT NULL DEFAULT '', work_started_at TEXT NOT NULL, attempt INTEGER NOT NULL DEFAULT 1,
            source_table TEXT NOT NULL, source_id TEXT NOT NULL, server_name TEXT NOT NULL DEFAULT '',
            kind TEXT NOT NULL, source TEXT NOT NULL, established_at TEXT NOT NULL DEFAULT '', connection_uncertain_until TEXT NOT NULL DEFAULT '',
            started_at TEXT NOT NULL DEFAULT '', finished_at TEXT NOT NULL DEFAULT '',
            total_count INTEGER NOT NULL DEFAULT 0, success_count INTEGER NOT NULL DEFAULT 0, failure_count INTEGER NOT NULL DEFAULT 0,
            bytes_total INTEGER NOT NULL DEFAULT 0, bytes_processed INTEGER NOT NULL DEFAULT 0, bytes_completed INTEGER NOT NULL DEFAULT 0,
			action TEXT NOT NULL,
			resource TEXT NOT NULL DEFAULT '',
			status TEXT NOT NULL DEFAULT 'success',
			server_id TEXT,
			duration_ms INTEGER,
			detail TEXT,
			created_at TEXT NOT NULL,
			updated_at TEXT NOT NULL,
 CHECK (detail_content_id IS NULL OR (COALESCE(detail,'')='' AND task_content_id IS NULL)),
 CHECK (task_content_id IS NULL OR COALESCE(detail,'')='')
		);

CREATE INDEX idx_activity_logs_detail_content ON activity_logs(detail_content_id);
CREATE INDEX idx_activity_logs_task_content ON activity_logs(task_content_id);
CREATE UNIQUE INDEX idx_activity_logs_source ON activity_logs(source_table,source_id);
CREATE INDEX idx_activity_logs_work ON activity_logs(work_id,attempt);
CREATE INDEX idx_activity_logs_parent ON activity_logs(parent_work_id,work_started_at);

CREATE INDEX idx_activity_logs_created_at ON activity_logs (created_at DESC);

CREATE INDEX idx_activity_logs_action ON activity_logs (action);

CREATE INDEX idx_activity_logs_status ON activity_logs (status);

CREATE INDEX idx_activity_logs_server ON activity_logs (server_id);

CREATE TABLE desktop_activity_resources (
 activity_id TEXT NOT NULL REFERENCES activity_logs(id) ON DELETE CASCADE,
 server_id TEXT NOT NULL, name TEXT NOT NULL,
 PRIMARY KEY(activity_id,server_id)
);
CREATE INDEX idx_desktop_activity_resources_server ON desktop_activity_resources(server_id,activity_id);
CREATE INDEX idx_desktop_activity_work_started ON activity_logs(work_started_at);
CREATE INDEX idx_desktop_activity_finished ON activity_logs(finished_at);

CREATE TABLE desktop_configuration_events (
 id TEXT PRIMARY KEY,
 activity_id TEXT NOT NULL UNIQUE REFERENCES activity_logs(id) ON DELETE CASCADE,
 actor_kind TEXT NOT NULL, actor_id TEXT NOT NULL, actor_session_id TEXT NOT NULL, actor_grant_id TEXT NOT NULL DEFAULT '',
 action TEXT NOT NULL, resource_kind TEXT NOT NULL, resource_id TEXT NOT NULL, resource_name TEXT NOT NULL,
 source TEXT NOT NULL, changed_fields_json TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE INDEX idx_desktop_configuration_resource ON desktop_configuration_events(resource_kind,resource_id,created_at);

CREATE TABLE desktop_connections (
 id TEXT PRIMARY KEY,
 activity_id TEXT NOT NULL UNIQUE REFERENCES activity_logs(id) ON DELETE CASCADE,
 actor_kind TEXT NOT NULL, actor_id TEXT NOT NULL, actor_session_id TEXT NOT NULL, actor_grant_id TEXT NOT NULL DEFAULT '',
 server_id TEXT NOT NULL, server_name TEXT NOT NULL,
 action TEXT NOT NULL, source TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('pending','running','success','failure','canceled','timeout','unknown')),
 started_at TEXT NOT NULL, established_at TEXT NOT NULL DEFAULT '', last_observed_at TEXT NOT NULL,
 finished_at TEXT NOT NULL DEFAULT '', recovered_at TEXT NOT NULL DEFAULT '', error_code TEXT NOT NULL DEFAULT ''
);
CREATE INDEX idx_desktop_connections_active ON desktop_connections(finished_at);

CREATE TABLE desktop_task_runs (
            content_id TEXT REFERENCES desktop_content_objects(id) ON DELETE RESTRICT,
            work_id TEXT NOT NULL, parent_work_id TEXT NOT NULL DEFAULT '', work_started_at TEXT NOT NULL,
			id TEXT PRIMARY KEY, actor_kind TEXT NOT NULL, actor_id TEXT NOT NULL, actor_session_id TEXT NOT NULL, actor_grant_id TEXT NOT NULL DEFAULT '', definition_id TEXT NOT NULL DEFAULT '',
			retry_of_id TEXT NOT NULL DEFAULT '', source_type TEXT NOT NULL DEFAULT '', source_id TEXT NOT NULL DEFAULT '',
			task_type TEXT NOT NULL, title TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', trigger_type TEXT NOT NULL DEFAULT 'manual',
			runner TEXT NOT NULL DEFAULT 'desktop', status TEXT NOT NULL DEFAULT 'queued', stage TEXT NOT NULL DEFAULT '',
			server_id TEXT NOT NULL DEFAULT '', server_name TEXT NOT NULL DEFAULT '', resource TEXT NOT NULL DEFAULT '',
			payload_json TEXT NOT NULL DEFAULT '', result_json TEXT NOT NULL DEFAULT '', progress INTEGER NOT NULL DEFAULT 0,
			total_count INTEGER NOT NULL DEFAULT 0, success_count INTEGER NOT NULL DEFAULT 0, failure_count INTEGER NOT NULL DEFAULT 0,
			bytes_total INTEGER NOT NULL DEFAULT 0, bytes_processed INTEGER NOT NULL DEFAULT 0, bytes_completed INTEGER NOT NULL DEFAULT 0, progress_json TEXT NOT NULL DEFAULT '',
			cancelable INTEGER NOT NULL DEFAULT 0, retryable INTEGER NOT NULL DEFAULT 0, attempt INTEGER NOT NULL DEFAULT 1,
			max_attempts INTEGER NOT NULL DEFAULT 1, error_code TEXT NOT NULL DEFAULT '', error_message TEXT NOT NULL DEFAULT '',
			cancel_requested_at TEXT NOT NULL DEFAULT '', started_at TEXT NOT NULL DEFAULT '', finished_at TEXT NOT NULL DEFAULT '',
			created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
            CHECK (content_id IS NULL OR (description='' AND payload_json='' AND result_json='' AND progress_json=''))
		);

CREATE INDEX idx_desktop_task_runs_content ON desktop_task_runs(content_id);
CREATE INDEX idx_desktop_task_runs_work ON desktop_task_runs(work_id,attempt);

CREATE INDEX idx_desktop_task_runs_status ON desktop_task_runs (status);

CREATE INDEX idx_desktop_task_runs_finished ON desktop_task_runs (finished_at);

CREATE INDEX idx_desktop_task_runs_created ON desktop_task_runs (created_at DESC);

CREATE INDEX idx_desktop_task_runs_type ON desktop_task_runs (task_type);

CREATE TABLE transfer_settings (
 id INTEGER PRIMARY KEY CHECK(id=1),
 max_entries INTEGER NOT NULL CHECK(max_entries BETWEEN 1 AND 1000000),
 max_depth INTEGER NOT NULL CHECK(max_depth BETWEEN 1 AND 256)
);
INSERT INTO transfer_settings(id,max_entries,max_depth) VALUES(1,100000,128);

-- Transfer intent only; execution state/metrics are owned by the referenced task.
CREATE TABLE transfer_jobs (
 id TEXT PRIMARY KEY NOT NULL REFERENCES desktop_task_runs(id) ON DELETE CASCADE,
 kind TEXT NOT NULL CHECK(kind IN ('upload','download','transfer')),
 file_name TEXT NOT NULL,
 source_server_id TEXT NOT NULL DEFAULT '',
 target_server_id TEXT NOT NULL DEFAULT '',
 selection_json TEXT NOT NULL,
 target_path TEXT NOT NULL,
 result_path TEXT NOT NULL DEFAULT '',
 CHECK((kind='upload' AND source_server_id='' AND target_server_id!='') OR
       (kind='download' AND source_server_id!='' AND target_server_id='') OR
       (kind='transfer' AND source_server_id!='' AND target_server_id!='' AND source_server_id!=target_server_id))
);

CREATE TABLE desktop_task_events (
 content_id TEXT REFERENCES desktop_content_objects(id) ON DELETE RESTRICT,
 content_size INTEGER NOT NULL DEFAULT 0,
 content_sha256 TEXT NOT NULL DEFAULT '',

			id INTEGER PRIMARY KEY AUTOINCREMENT, task_run_id TEXT NOT NULL, actor_kind TEXT NOT NULL, actor_id TEXT NOT NULL, actor_session_id TEXT NOT NULL, actor_grant_id TEXT NOT NULL DEFAULT '',
			level TEXT NOT NULL DEFAULT 'info', message TEXT NOT NULL, data_json TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL,
			FOREIGN KEY (task_run_id) REFERENCES desktop_task_runs(id) ON DELETE CASCADE
		);

CREATE INDEX idx_desktop_task_events_content ON desktop_task_events(content_id);
CREATE INDEX idx_desktop_task_events_run_cursor ON desktop_task_events (task_run_id, id);

CREATE TABLE desktop_ai_sessions (
			id TEXT PRIMARY KEY,
 config_space_id TEXT NOT NULL DEFAULT 'local',
			title TEXT NOT NULL DEFAULT '',
			custom_title INTEGER NOT NULL DEFAULT 0,
			model TEXT NOT NULL DEFAULT '',
			permission_mode TEXT NOT NULL DEFAULT 'balanced',
			scope_json TEXT NOT NULL DEFAULT '{}',
			status TEXT NOT NULL DEFAULT 'idle',
            list_title TEXT NOT NULL DEFAULT '',
            title_folded TEXT NOT NULL DEFAULT '',
            search_text TEXT NOT NULL DEFAULT '',
            search_folded TEXT NOT NULL DEFAULT '',
            preview TEXT NOT NULL DEFAULT '',
            scope_kind TEXT NOT NULL DEFAULT '',
            scope_server_id TEXT NOT NULL DEFAULT '',
            scope_terminal_session_id TEXT NOT NULL DEFAULT '',
            message_count INTEGER NOT NULL DEFAULT 0,
            task_count INTEGER NOT NULL DEFAULT 0,
			created_at TEXT NOT NULL,
			updated_at TEXT NOT NULL
		);

CREATE TABLE desktop_content_objects (
 id TEXT PRIMARY KEY NOT NULL,
 source_type TEXT NOT NULL, source_id TEXT NOT NULL,
 media_type TEXT NOT NULL, size INTEGER NOT NULL CHECK(size >= 0),
 sha256 TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE INDEX idx_desktop_content_source ON desktop_content_objects(source_type,source_id);

CREATE TABLE desktop_ai_messages (
 session_id TEXT NOT NULL REFERENCES desktop_ai_sessions(id) ON DELETE CASCADE,
 item_id TEXT NOT NULL CHECK(length(item_id) BETWEEN 1 AND 256),
 position INTEGER NOT NULL CHECK(position >= 0),
 content_id TEXT REFERENCES desktop_content_objects(id) ON DELETE RESTRICT,
 payload TEXT NOT NULL, content_hash TEXT NOT NULL,
 PRIMARY KEY(session_id,item_id)
);
CREATE INDEX idx_desktop_ai_messages_content ON desktop_ai_messages(content_id);
CREATE INDEX idx_desktop_ai_messages_order ON desktop_ai_messages(session_id,position);

CREATE TABLE desktop_ai_session_tasks (
 session_id TEXT NOT NULL REFERENCES desktop_ai_sessions(id) ON DELETE CASCADE,
 item_id TEXT NOT NULL CHECK(length(item_id) BETWEEN 1 AND 256),
 position INTEGER NOT NULL CHECK(position >= 0),
 status TEXT NOT NULL,
 content_id TEXT REFERENCES desktop_content_objects(id) ON DELETE RESTRICT,
 public_payload TEXT NOT NULL,
 public_content_id TEXT REFERENCES desktop_content_objects(id) ON DELETE RESTRICT,
 artifact_content_id TEXT REFERENCES desktop_content_objects(id) ON DELETE RESTRICT,
 payload TEXT NOT NULL, content_hash TEXT NOT NULL,
 PRIMARY KEY(session_id,item_id)
);
CREATE INDEX idx_desktop_ai_session_tasks_content ON desktop_ai_session_tasks(content_id);
CREATE INDEX idx_desktop_ai_session_tasks_public_content ON desktop_ai_session_tasks(public_content_id);
CREATE INDEX idx_desktop_ai_session_tasks_artifact_content ON desktop_ai_session_tasks(artifact_content_id);
CREATE INDEX idx_desktop_ai_session_tasks_order ON desktop_ai_session_tasks(session_id,position);
CREATE INDEX idx_desktop_ai_session_tasks_state ON desktop_ai_session_tasks(session_id,status);

CREATE TABLE desktop_ai_tool_executions (
 id TEXT PRIMARY KEY, session_id TEXT NOT NULL, task_id TEXT NOT NULL,
 actor_kind TEXT NOT NULL, actor_id TEXT NOT NULL, actor_session_id TEXT NOT NULL, actor_grant_id TEXT NOT NULL DEFAULT '',
 server_id TEXT NOT NULL DEFAULT '', server_name TEXT NOT NULL DEFAULT '', tool_name TEXT NOT NULL,
 status TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
 started_at TEXT NOT NULL DEFAULT '', finished_at TEXT NOT NULL DEFAULT '', recovered_at TEXT NOT NULL DEFAULT ''
);
CREATE UNIQUE INDEX idx_desktop_ai_tool_identity ON desktop_ai_tool_executions(session_id,task_id);
CREATE INDEX idx_desktop_ai_tool_session_state ON desktop_ai_tool_executions(session_id,status);
CREATE INDEX idx_desktop_ai_tool_status ON desktop_ai_tool_executions(status);

CREATE INDEX idx_desktop_ai_sessions_updated ON desktop_ai_sessions (updated_at DESC);

CREATE INDEX idx_desktop_ai_sessions_scope ON desktop_ai_sessions (scope_kind,scope_server_id,scope_terminal_session_id,updated_at DESC,id);

CREATE TABLE ssh_host_keys (
    host TEXT NOT NULL,
    port INTEGER NOT NULL CHECK(port BETWEEN 1 AND 65535),
    key_type TEXT NOT NULL,
    public_key TEXT NOT NULL,
    fingerprint TEXT NOT NULL,
    confirmed_at TEXT NOT NULL,
    first_seen TEXT NOT NULL,
    last_seen TEXT NOT NULL,
    trust_status TEXT NOT NULL CHECK(trust_status IN ('trusted', 'revoked')),
    PRIMARY KEY(host, port, key_type)
);

CREATE TABLE desktop_ssh_key_aliases (alias_id TEXT PRIMARY KEY NOT NULL, canonical_id TEXT NOT NULL REFERENCES desktop_ssh_keys(id) ON UPDATE CASCADE ON DELETE CASCADE, fingerprint TEXT NOT NULL);

CREATE TABLE desktop_server_auth (
 server_id TEXT PRIMARY KEY NOT NULL REFERENCES desktop_servers(id) ON DELETE CASCADE,
 auth_method TEXT NOT NULL,
 password TEXT NOT NULL DEFAULT '',
 ssh_key_id TEXT REFERENCES desktop_ssh_keys(id) ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX idx_desktop_server_auth_key ON desktop_server_auth(ssh_key_id);
CREATE VIEW desktop_server_details AS SELECT s.*,(SELECT json_group_array(tag_name) FROM (SELECT tag_name FROM desktop_server_tags WHERE server_id=s.id ORDER BY tag_name)) AS tags_json,COALESCE(g.name,'') AS server_group,COALESCE(g.sort_order,0) AS group_sort_order,a.auth_method,a.password,a.ssh_key_id FROM desktop_servers s JOIN desktop_server_auth a ON a.server_id=s.id LEFT JOIN desktop_server_groups g ON g.id=s.group_id;
