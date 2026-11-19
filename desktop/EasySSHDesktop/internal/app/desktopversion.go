package app

// desktopBundledVersion is injected by the Taskfile build from the vX.Y.Z tag:
// -ldflags "-X github.com/easyssh/easyssh-desktop/internal/app.desktopBundledVersion=...".
var desktopBundledVersion = "dev"
