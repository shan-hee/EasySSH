package aitools

import (
	"testing"

	"github.com/easyssh/shared/aipermission"
)

func TestDefinitionsHavePoliciesAndIndependentSchemas(t *testing.T) {
	definitions := Definitions()
	if len(definitions) != 9 {
		t.Fatalf("got %d tools", len(definitions))
	}
	seen := map[string]bool{}
	for _, definition := range definitions {
		if seen[definition.Name] || definition.Name == "" || definition.DisplayName == "" || definition.Description == "" {
			t.Fatalf("invalid definition: %+v", definition)
		}
		seen[definition.Name] = true
		_ = aipermission.PolicyFor(definition.Name)
		definition.Parameters["additionalProperties"] = false
		properties := definition.Parameters["properties"].(map[string]interface{})
		if server, ok := properties["server_id"].(map[string]interface{}); ok {
			server["const"] = "terminal-server"
		}
		if required := definition.Parameters["required"].([]string); len(required) > 0 {
			required[0] = "mutated"
		}
	}
	for _, definition := range Definitions() {
		if _, ok := definition.Parameters["additionalProperties"]; ok {
			t.Fatal("automation schema changes leaked")
		}
		properties := definition.Parameters["properties"].(map[string]interface{})
		if server, ok := properties["server_id"].(map[string]interface{}); ok {
			if _, pinned := server["const"]; pinned {
				t.Fatal("terminal server pin leaked")
			}
		}
		if required := definition.Parameters["required"].([]string); len(required) > 0 && required[0] == "mutated" {
			t.Fatal("required parameter mutation leaked")
		}
		var added []string
		switch definition.Name {
		case "write_file":
			added = []string{"expected_sha256"}
		case "read_file":
			added = []string{"start_line", "max_lines"}
		case "list_directory":
			added = []string{"offset", "limit"}
		}
		for _, name := range added {
			if _, ok := properties[name]; !ok {
				t.Fatalf("%s missing %s", definition.Name, name)
			}
		}
	}
}
