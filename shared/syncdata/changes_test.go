package syncdata

import (
	"reflect"
	"testing"
)

func TestConfigurationChangesCompareValuesAndRetainExplicitClears(t *testing.T) {
	before := Record{"name": "server", "tags": `[]`, "connection": `{"host":"host","port":22,"username":"owner","auth_method":"password"}`, "description": "", "group_id": ""}
	after := Record{"name": "server", "tags": `[ ]`, "connection": ` { "auth_method":"password", "username":"owner", "port":22,"host":"host" } `}
	names := []string{"name", "tags", "connection", "description", "group_id"}
	if fields := ConfigurationChangedFields(before, after, names...); len(fields) != 0 {
		t.Fatal("equivalent values counted as work", fields)
	}
	before["description"] = "note"
	if fields := ConfigurationChangedFields(before, after, names...); !reflect.DeepEqual(fields, []string{"description"}) {
		t.Fatal("clearing existing optional value was omitted", fields)
	}
	if fields := ConfigurationChangedFields(nil, after, names...); !reflect.DeepEqual(fields, []string{"created"}) {
		t.Fatal("creation lost its intent", fields)
	}
}
