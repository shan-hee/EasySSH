package taskcenter

import "github.com/easyssh/shared/protocol"

func (r TaskRun) Wire() protocol.TaskRun {
	return protocol.TaskRun{WorkID: r.WorkID, ParentWorkID: r.ParentWorkID, WorkStartedAt: r.WorkStartedAt, Actor: r.Actor, ID: r.ID, DefinitionVersion: r.DefinitionVersion, DefinitionID: r.DefinitionID, RetryOfID: r.RetryOfID, SourceType: r.SourceType, SourceID: r.SourceID, TaskType: r.TaskType, Title: r.Title, Description: r.Description, TriggerType: r.TriggerType, Runner: r.Runner, Status: r.Status, Stage: r.Stage, ServerID: r.ServerID, ServerName: r.ServerName, Resource: r.Resource, PayloadJSON: r.PayloadJSON, ResultJSON: r.ResultJSON, Progress: r.Progress, TotalCount: r.TotalCount, SuccessCount: r.SuccessCount, FailureCount: r.FailureCount, BytesTotal: r.BytesTotal, BytesProcessed: r.BytesProcessed, ProgressJSON: r.ProgressJSON, Cancelable: r.Cancelable, Retryable: r.Retryable, Attempt: r.Attempt, MaxAttempts: r.MaxAttempts, ErrorCode: r.ErrorCode, ErrorMessage: r.ErrorMessage, CancelRequestedAt: r.CancelRequestedAt, StartedAt: r.StartedAt, FinishedAt: r.FinishedAt, CreatedAt: r.CreatedAt, UpdatedAt: r.UpdatedAt}
}

func (r TaskRunSummary) Wire() protocol.TaskRunSummary {
	return protocol.TaskRunSummary{WorkID: r.WorkID, ParentWorkID: r.ParentWorkID, WorkStartedAt: r.WorkStartedAt, Actor: r.Actor, ID: r.ID, DefinitionID: r.DefinitionID, RetryOfID: r.RetryOfID, SourceType: r.SourceType, SourceID: r.SourceID, TaskType: r.TaskType, Title: r.Title, TriggerType: r.TriggerType, Runner: r.Runner, Status: r.Status, Stage: r.Stage, ServerID: r.ServerID, ServerName: r.ServerName, Resource: r.Resource, Progress: r.Progress, TotalCount: r.TotalCount, SuccessCount: r.SuccessCount, FailureCount: r.FailureCount, BytesTotal: r.BytesTotal, BytesProcessed: r.BytesProcessed, Cancelable: r.Cancelable, Retryable: r.Retryable, Attempt: r.Attempt, MaxAttempts: r.MaxAttempts, ErrorCode: r.ErrorCode, ErrorMessage: r.ErrorMessage, CancelRequestedAt: r.CancelRequestedAt, StartedAt: r.StartedAt, FinishedAt: r.FinishedAt, CreatedAt: r.CreatedAt, UpdatedAt: r.UpdatedAt}
}

func (s Statistics) Wire() protocol.TaskStatistics {
	return protocol.TaskStatistics{Total: s.Total, Queued: s.Queued, Running: s.Running, Canceling: s.Canceling, Succeeded: s.Succeeded, Failed: s.Failed, PartialSuccess: s.PartialSuccess, Canceled: s.Canceled, Timeout: s.Timeout, Unknown: s.Unknown}
}
