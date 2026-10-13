package syncdata

// Documents are base64-encoded Automerge histories. Wire limits also allow
// JSON envelopes and responses containing both a document and its projection.
const (
	MaxDocumentBytes         = 32 << 20
	MaxExchangeRequestBytes  = 48 << 20
	MaxExchangeResponseBytes = 96 << 20
	MaxRuntimeMessageBytes   = 128 << 20
)
