// Manual desktop binding shim for DesktopScriptService.
// Wails generated bindings use numeric method IDs; this development-only shim
// calls by fully-qualified method name so the new service is usable before the
// next binding generation pass.

// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore: Unused imports
import { Call as $Call, CancellablePromise as $CancellablePromise } from "@wailsio/runtime";

export interface DesktopScript {
    id: string;
    user_id: string;
    name: string;
    description: string;
    content: string;
    language: string;
    tags: string[];
    executions: number;
    author: string;
    created_at: string;
    updated_at: string;
}

export interface DesktopScriptInput {
    name: string;
    description?: string;
    content: string;
    language?: string;
    tags?: string[];
}

export interface DesktopScriptListParams {
    page?: number;
    limit?: number;
    search?: string;
    tags?: string[];
    language?: string;
}

export interface DesktopScriptListResult {
    data: DesktopScript[];
    total: number;
    page: number;
    limit: number;
    total_pages: number;
}

export interface DesktopBatchTask {
    id: string;
    user_id: string;
    task_name: string;
    task_type: string;
    content: string;
    script_id?: string;
    server_ids: string[];
    execution_mode: string;
    status: string;
    success_count: number;
    failed_count: number;
    started_at?: string;
    completed_at?: string;
    duration?: number;
    created_at: string;
    updated_at: string;
}

export interface DesktopBatchTaskInput {
    task_name: string;
    task_type: string;
    content?: string;
    script_id?: string;
    server_ids: string[];
    execution_mode?: string;
}

export interface DesktopBatchTaskListParams {
    page?: number;
    limit?: number;
    status?: string;
    task_type?: string;
}

export interface DesktopBatchTaskListResult {
    data: DesktopBatchTask[];
    total: number;
    page: number;
    limit: number;
    total_pages: number;
}

export interface DesktopBatchTaskStartResult {
    message: string;
}

const service = "github.com/easyssh/easyssh-desktop.DesktopScriptService";

export function Create(input: DesktopScriptInput): $CancellablePromise<DesktopScript> {
    return $Call.ByName(`${service}.Create`, input);
}

export function CreateBatchTask(input: DesktopBatchTaskInput): $CancellablePromise<DesktopBatchTask> {
    return $Call.ByName(`${service}.CreateBatchTask`, input);
}

export function Delete(id: string): $CancellablePromise<void> {
    return $Call.ByName(`${service}.Delete`, id);
}

export function Execute(id: string): $CancellablePromise<void> {
    return $Call.ByName(`${service}.Execute`, id);
}

export function GetBatchTaskById(id: string): $CancellablePromise<DesktopBatchTask> {
    return $Call.ByName(`${service}.GetBatchTaskById`, id);
}

export function GetById(id: string): $CancellablePromise<DesktopScript> {
    return $Call.ByName(`${service}.GetById`, id);
}

export function List(params: DesktopScriptListParams): $CancellablePromise<DesktopScriptListResult> {
    return $Call.ByName(`${service}.List`, params);
}

export function ListBatchTasks(params: DesktopBatchTaskListParams): $CancellablePromise<DesktopBatchTaskListResult> {
    return $Call.ByName(`${service}.ListBatchTasks`, params);
}

export function StartBatchTask(id: string): $CancellablePromise<DesktopBatchTaskStartResult> {
    return $Call.ByName(`${service}.StartBatchTask`, id);
}

export function Update(id: string, input: DesktopScriptInput): $CancellablePromise<DesktopScript> {
    return $Call.ByName(`${service}.Update`, id, input);
}
