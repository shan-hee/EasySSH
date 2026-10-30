package dashboard

import (
	"github.com/easyssh/server/internal/domain/operationrecord"
	"github.com/easyssh/shared/protocol"
)

// Overview holds the domain snapshot. The REST boundary maps activity records
// into protocol.DashboardOverview using the shared activity response mapping.
type Overview struct {
	Activity     *operationrecord.Overview
	Stats        protocol.DashboardStats
	Distribution []protocol.DashboardRegionCount
}
