package instancebackup

import (
	"fmt"

	"github.com/Masterminds/semver/v3"
)

func CheckApplicationVersion(source, target string) error {
	if source == target {
		return nil
	}
	before, err := semver.NewVersion(source)
	if err != nil {
		return fmt.Errorf("cannot restore unversioned application backup %q with %q", source, target)
	}
	after, err := semver.NewVersion(target)
	if err != nil {
		return fmt.Errorf("restore requires a versioned application build, got %q", target)
	}
	if before.GreaterThan(after) {
		return fmt.Errorf("backup requires EasySSH %s or newer; current version is %s", source, target)
	}
	return nil
}
