package dashboard

import "github.com/easyssh/shared/protocol"

// Overview holds the dashboard snapshot. Only the figures the page shows are
// returned; the full day's activity is served by the activity overview API.
type Overview struct {
	Stats        protocol.DashboardStats
	Distribution []protocol.DashboardRegionCount
}
