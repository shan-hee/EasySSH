package app

func desktopAIHasExternalContent(record desktopAISessionRecord) bool {
	for _, message := range record.Messages {
		if message.ExternalContent {
			return true
		}
	}
	for _, task := range record.Tasks {
		if task.Result != "" || task.Error != "" || task.CommandOutput != "" || task.File != nil || task.Artifact != nil {
			return true
		}
	}
	return false
}
