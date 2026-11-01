package sshutil

import "fmt"

const MaxJumpHops = 16

// ValidateJumpServers validates the complete graph, including dependents of an
// edited host. Empty values mean direct connections.
func ValidateJumpServers(links map[string]string) error {
	for id := range links {
		seen := map[string]bool{id: true}
		next := links[id]
		for depth := 0; next != ""; depth++ {
			if seen[next] {
				return fmt.Errorf("jump server cycle involving %s", next)
			}
			if depth >= MaxJumpHops {
				return fmt.Errorf("SSH route exceeds %d jump hosts", MaxJumpHops)
			}
			seen[next] = true
			parent, ok := links[next]
			if !ok {
				return fmt.Errorf("jump server %s does not exist", next)
			}
			next = parent
		}
	}
	return nil
}
