package main

import (
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"os"
	"time"

	"github.com/easyssh/shared/instancebackup"
)

// Extraction never opens the live database, initializes config, or applies an
// upgrade. Operators restore the verified native dump into an isolated target.
func extractMigrationRecovery(args []string) (result error) {
	flags := flag.NewFlagSet("maintenance migration-extract", flag.ContinueOnError)
	file := flags.String("file", "", "encrypted startup migration recovery point")
	into := flags.String("into", "", "new empty extraction directory (must not exist)")
	keyFile := flags.String("root-key-file", "", "private file containing the original instance root key")
	if err := flags.Parse(args); err != nil {
		return err
	}
	if flags.NArg() != 0 || *file == "" || *into == "" || *keyFile == "" {
		return errors.New("--file, --into and --root-key-file are required, with no positional arguments")
	}
	key, err := os.ReadFile(*keyFile)
	if err != nil {
		return err
	}
	password, err := migrationPassword(string(key))
	if err != nil {
		return err
	}
	if err = os.Mkdir(*into, 0700); err != nil {
		return err
	}
	defer func() {
		if result != nil {
			_ = os.RemoveAll(*into)
		}
	}()
	ctx, cancel := context.WithTimeout(context.Background(), 4*time.Hour)
	defer cancel()
	manifest, err := instancebackup.Unpack(ctx, *file, *into, password)
	if err != nil {
		return err
	}
	if manifest.Profile != "server-migration" {
		return errors.New("not a startup migration recovery point; use maintenance restore for full instance backups")
	}
	if _, ok := manifest.Files["database.dump"]; !ok {
		return errors.New("recovery point has no native database dump")
	}
	data, err := json.MarshalIndent(manifest, "", "  ")
	if err != nil {
		return err
	}
	if err = os.WriteFile(*into+string(os.PathSeparator)+"manifest.json", data, 0600); err != nil {
		return err
	}
	fmt.Fprintf(os.Stdout, "Verified recovery point extracted to %s (driver=%s schema=%d). Live database unchanged; restore database.dump to a new target before switching.\n", *into, manifest.Driver, manifest.SchemaVersion)
	return nil
}
