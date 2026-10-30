package syncdata

import "slices"

// ConfigurationChangedFields compares validated, applied configuration values.
// It ignores JSON formatting and omitted empty optional fields, while retaining
// meaningful key metadata/binding changes. It does not decide authorization.
func ConfigurationChangedFields(before, after Record, names ...string) []string {
	if before == nil {
		return []string{"created"}
	}
	fields := []string{}
	for _, name := range names {
		changed := before[name] != after[name]
		switch name {
		case "tags":
			changed = !slices.Equal(Tags(before[name]), Tags(after[name]))
		case "connection":
			previous, oldErr := ParseConnection(before[name])
			next, newErr := ParseConnection(after[name])
			changed = oldErr != nil || newErr != nil || JSON(previous) != JSON(next)
		}
		if changed {
			fields = append(fields, name)
		}
	}
	return fields
}
