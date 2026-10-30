package accesslink

import (
	"net/url"
	"testing"
)

func TestDesktopLaunchRoundTrip(t *testing.T) {
	id := "4048d449-a871-4c5c-9be9-20fe78388908"
	raw, err := DesktopLaunchURL("https://Example.com:443/", id)
	if err != nil {
		t.Fatal(err)
	}
	launch, err := ParseDesktopLaunch(raw)
	if err != nil || launch.Origin != "https://example.com" || launch.HandoffID != id {
		t.Fatalf("unexpected launch: %+v, %v", launch, err)
	}
}

func TestDesktopLaunchRejectsExtraAuthorityAndAmbiguity(t *testing.T) {
	id := "4048d449-a871-4c5c-9be9-20fe78388908"
	base := "easyssh://access?origin=https%3A%2F%2Fexample.com&handoff=" + id
	for _, raw := range []string{
		base + "&token=secret", base + "&origin=https%3A%2F%2Fother.example",
		base + "#secret", base + "#", base + "&handoff=" + id,
		"easyssh://access/path?origin=https%3A%2F%2Fexample.com&handoff=" + id,
		"easyssh://user@access?origin=https%3A%2F%2Fexample.com&handoff=" + id,
		"easyssh://access?origin=" + url.QueryEscape("https://user:password@example.com") + "&handoff=" + id,
		"easyssh://access?origin=" + url.QueryEscape("http://example.com") + "&handoff=" + id,
		"easyssh://access?origin=" + url.QueryEscape("https://example.com/api") + "&handoff=" + id,
		"easyssh://access?origin=https%3A%2F%2Fexample.com&handoff=00000000-0000-0000-0000-000000000000",
	} {
		if _, err := ParseDesktopLaunch(raw); err == nil {
			t.Fatalf("accepted invalid launch %q", raw)
		}
	}
}
