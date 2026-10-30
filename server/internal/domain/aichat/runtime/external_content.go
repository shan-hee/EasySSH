package runtime

// Caller holds Manager.mu. The marker is stored with ordinary message items,
// so restart, history pagination and sync do not need a separate tracking store.
func (s *session) hasExternalContent() bool {
	for _, message := range s.messageViews {
		if message.ExternalContent {
			return true
		}
	}
	for _, message := range s.messages {
		if message.Role == "tool" {
			return true
		}
	}
	// Imported history can contain task results without provider tool messages.
	for _, task := range s.tasks {
		v := task.view
		if v.Result != "" || v.Error != "" || v.CommandOutput != "" || v.File != nil || v.Artifact != nil {
			return true
		}
	}
	return false
}
