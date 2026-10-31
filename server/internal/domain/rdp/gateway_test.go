package rdp

import (
	"bufio"
	"strings"
	"testing"
)

func TestGuacamoleUnicodeAndInstructionBoundaries(t *testing.T) {
	// Length is code points: non-BMP characters count as one, not UTF-16 pairs.
	r := bufio.NewReader(strings.NewReader("4.name,3.甲😀乙;4.sync,3.123;"))
	got, err := ReadInstruction(r)
	if err != nil || len(got) != 2 || got[1] != "甲😀乙" {
		t.Fatalf("unicode instruction: %v %v", got, err)
	}
	if encoded := EncodeInstruction("name", "甲😀乙"); encoded != "4.name,3.甲😀乙;" {
		t.Fatal(encoded)
	}
	got, err = ReadInstruction(r)
	if err != nil || len(got) != 2 || got[0] != "sync" || got[1] != "123" {
		t.Fatalf("next instruction: %v %v", got, err)
	}
}
func TestGuacamoleRejectsMalformedOrUnboundedInput(t *testing.T) {
	for _, input := range []string{"-1.x;", ".x;", "1.a!", "2.a;", "99999999.x;", "1048577.x;", "1.\xff;"} {
		if _, err := ReadInstruction(bufio.NewReader(strings.NewReader(input))); err == nil {
			t.Errorf("accepted malformed input %q", input)
		}
	}
}
func TestBrowserCannotChangeGuacdTargetOrOpenDevices(t *testing.T) {
	for _, v := range [][]string{{"select", "rdp"}, {"connect", "another-host"}, {"file", "1", "text/plain", "x"}, {"pipe", "1", "x", "x"}, {"audio", "1", "audio/L16"}, {"size", "9999999", "9999999"}, {"clipboard", "1", "application/octet-stream"}} {
		if ValidClientInstruction(v) {
			t.Errorf("accepted prohibited client instruction: %v", v)
		}
	}
	for _, v := range [][]string{{"key", "65", "1"}, {"sync", "123"}, {"size", "1280", "720"}, {"clipboard", "1", "text/plain"}, {"blob", "1", "SGk="}, {"end", "1"}, {"nop"}} {
		if !ValidClientInstruction(v) {
			t.Errorf("rejected expected client instruction: %v", v)
		}
	}
}
