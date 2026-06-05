# Desktop Frontend Architecture Exceptions

This file tracks temporary Desktop frontend dependencies that are allowed while the Web/Desktop Workspace boundary is being tightened. Each entry should have an exit condition before it grows into a default pattern.

## Active Exceptions

No active exceptions.

## Rules

- Do not add new Web Dashboard imports to `@easyssh/ssh-workspace/desktop`.
- New exceptions must explain why an adapter contract is not enough yet.
- When touching an exception, either reduce its scope or update the exit condition.
