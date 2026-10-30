package scriptutil

import (
	"errors"
	"github.com/easyssh/shared/protocol"
	"github.com/google/uuid"
)

const MaxExecuteBytes = 256 << 10
const MaxCatalogBytes = 2 << 20

var ErrInvalidCatalogQuery = errors.New("invalid script catalogue query")

func NormalizeCatalogInput(input protocol.ScriptCatalogInput) (protocol.ScriptCatalogInput, error) {
	if input.Limit == 0 {
		input.Limit = 20
	}
	if input.Limit < 1 || input.Limit > 100 {
		return input, ErrInvalidCatalogQuery
	}
	if input.AfterID != "" {
		id, err := uuid.Parse(input.AfterID)
		if err != nil || id == uuid.Nil || id.String() != input.AfterID {
			return input, ErrInvalidCatalogQuery
		}
	}
	return input, nil
}
