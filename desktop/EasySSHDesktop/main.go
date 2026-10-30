package main

import (
	"embed"

	"github.com/easyssh/easyssh-desktop/internal/app"
)

//go:embed all:frontend/dist
var assets embed.FS

//go:embed build/appicon.png
var appIcon []byte

func main() {
	app.Run(assets, appIcon)
}
