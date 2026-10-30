package sftputil

import "testing"

func TestFilesystemUsagePreservesReservedSpace(t *testing.T) {
	result, err := FilesystemUsage("/", 100, 30, 20, 4096)
	if err != nil || result.Total != 409600 || result.Used != 286720 || result.Available != 81920 || result.UsedPercent != 70 {
		t.Fatalf("reserved blocks were treated as used: %+v %v", result, err)
	}
	empty, err := FilesystemUsage("/", 0, 0, 0, 4096)
	if err != nil || empty.UsedPercent != 0 {
		t.Fatalf("invalid empty-filesystem percentage: %+v %v", empty, err)
	}
	for _, values := range [][4]uint64{{1, 0, 0, 0}, {100, 101, 0, 4096}, {100, 20, 30, 4096}, {^uint64(0), 0, 0, 2}} {
		if _, err := FilesystemUsage("/", values[0], values[1], values[2], values[3]); err == nil {
			t.Fatalf("accepted invalid statistics %v", values)
		}
	}
}
