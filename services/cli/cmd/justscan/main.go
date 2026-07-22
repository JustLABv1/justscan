package main

import (
	"os"

	"github.com/JustLABv1/justscan/services/cli/internal/app"
)

var (
	version = "dev"
	commit  = "none"
	date    = "unknown"
)

func main() {
	os.Exit(app.Execute(version, commit, date))
}
