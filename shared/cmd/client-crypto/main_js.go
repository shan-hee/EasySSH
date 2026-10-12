//go:build js && wasm

package main

import (
	"encoding/json"
	"syscall/js"

	"github.com/easyssh/shared/synccrypto"
)

func main() {
	var vault synccrypto.Vault
	requests := make(chan string, 16)
	go func() {
		for input := range requests {
			var request struct {
				ID      string `json:"id"`
				Payload string `json:"payload"`
			}
			if json.Unmarshal([]byte(input), &request) != nil {
				continue
			}
			result, err := vault.Dispatch(request.Payload)
			response := map[string]any{"id": request.ID, "result": result}
			if err != nil {
				response["error"] = err.Error()
			}
			encoded, _ := json.Marshal(response)
			js.Global().Call("postMessage", string(encoded))
		}
	}()
	dispatch := js.FuncOf(func(_ js.Value, args []js.Value) any {
		if len(args) != 1 {
			return false
		}
		select {
		case requests <- args[0].String():
			return true
		default:
			return false
		}
	})
	js.Global().Set("easysshCryptoDispatch", dispatch)
	js.Global().Call("postMessage", `{"id":"ready","result":"null"}`)
	select {}
}
