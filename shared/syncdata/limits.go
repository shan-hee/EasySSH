package syncdata

// A document is the JSON sync state of one space or vault record. Wire limits
// also allow responses containing both the changes and the projection.
const (
	MaxDocumentBytes = 32 << 20
	// Plaintext JSON is bounded independently of compressed/encrypted documents.
	MaxVaultPayloadBytes     = 32 << 20
	MaxExchangeRequestBytes  = 48 << 20
	MaxExchangeResponseBytes = 96 << 20
)
