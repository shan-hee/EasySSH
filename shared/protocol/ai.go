package protocol

func (a AIImageAttachment) DataURL() string {
	return "data:" + a.MediaType + ";base64," + a.Data
}
