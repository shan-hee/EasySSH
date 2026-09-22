package aiprovider

import (
	"encoding/json"

	"github.com/easyssh/shared/aitooloutput"
)

// prepareToolContext filters binary output and removes echoed commands without
// imposing a size or age limit on readable results. Stored history is unchanged.
func prepareToolContext(messages []Message) []Message {
	projected := append([]Message(nil), messages...)
	for i, message := range messages {
		if message.Role != "tool" {
			continue
		}
		// Command results have a human-readable title followed by a JSON object.
		// Preserve execution metadata and omit the echoed command, whose exact
		// arguments are already in the matching assistant tool call.
		if prefix, payload, output, ok := aitooloutput.ParseCommandResult(message.Content); ok {
			delete(payload, "command")
			payload["output"], _ = json.Marshal(aitooloutput.Sanitize(output))
			encoded, _ := json.Marshal(payload)
			projected[i].Content = prefix + string(encoded)
			continue
		}
		projected[i].Content = aitooloutput.Sanitize(message.Content)
	}
	return projected
}
