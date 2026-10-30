package syncdata

import (
	"github.com/easyssh/shared/protocol"
	"strconv"

	"github.com/easyssh/shared/servergroup"
)

func GroupRecord(group protocol.ServerGroup) Record {
	return Record{"name": group.Name, "sort_order": strconv.Itoa(group.SortOrder)}
}

func ParseGroup(id string, record Record) (protocol.ServerGroup, error) {
	order, err := strconv.Atoi(record["sort_order"])
	if err != nil || strconv.Itoa(order) != record["sort_order"] || !servergroup.ValidID(id) || len(record) != 2 {
		return protocol.ServerGroup{}, servergroup.ErrInvalid
	}
	input, err := servergroup.Normalize(protocol.ServerGroupInput{Name: record["name"], SortOrder: order})
	if err != nil || input.Name != record["name"] {
		return protocol.ServerGroup{}, servergroup.ErrInvalid
	}
	return protocol.ServerGroup{ID: id, Name: input.Name, SortOrder: order}, nil
}
