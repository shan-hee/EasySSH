package updatecheck

import "testing"

func TestIsNewerIgnoresNonComparableVersions(t *testing.T) {
	if IsNewer("1.0.18", "dev") {
		t.Fatal("dev current version must not be treated as older than a release")
	}
	if IsNewer("1.0.18", "") {
		t.Fatal("empty current version must not be treated as older than a release")
	}
	if IsNewer("dev", "1.0.18") {
		t.Fatal("dev candidate version must not be treated as newer than a release")
	}
}

func TestIsNewerComparesReleaseVersions(t *testing.T) {
	if !IsNewer("1.0.19", "1.0.18") {
		t.Fatal("higher release version should be newer")
	}
	if IsNewer("1.0.18", "1.0.18") {
		t.Fatal("same release version should not be newer")
	}
	if IsNewer("1.0.17", "1.0.18") {
		t.Fatal("lower release version should not be newer")
	}
}
