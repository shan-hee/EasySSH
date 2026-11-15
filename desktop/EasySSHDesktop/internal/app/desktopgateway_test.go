package app

import "testing"

func TestDesktopGatewayTokenMatches(t *testing.T) {
	tests := []struct {
		name     string
		provided string
		expected string
		want     bool
	}{
		{name: "correct token", provided: "gateway-token", expected: "gateway-token", want: true},
		{name: "wrong token", provided: "gateway-tokex", expected: "gateway-token"},
		{name: "shorter token", provided: "gateway", expected: "gateway-token"},
		{name: "longer token", provided: "gateway-token-extra", expected: "gateway-token"},
		{name: "missing request token", expected: "gateway-token"},
		{name: "empty gateway token", provided: "gateway-token"},
		{name: "both tokens empty"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := desktopGatewayTokenMatches(tt.provided, tt.expected); got != tt.want {
				t.Fatalf("desktopGatewayTokenMatches() = %v, want %v", got, tt.want)
			}
		})
	}
}
