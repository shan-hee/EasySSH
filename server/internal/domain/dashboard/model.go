package dashboard

// StatsBlock 统计卡片数据块
type StatsBlock struct {
	OnlineServers  int64 `json:"online_servers"`
	TotalServers   int64 `json:"total_servers"`
	ActiveSessions int64 `json:"active_sessions"`
	TodayCommands  int64 `json:"today_commands"`
}

// RegionCount 服务器区域分布项
type RegionCount struct {
	Region      string         `json:"region"`       // 国家展示名
	CountryCode string         `json:"country_code"` // 国家代码，用于前端地图打点
	Count       int            `json:"count"`
	Servers     []RegionServer `json:"servers"`
}

// RegionServer 是地区列表所需的最小服务器投影，不包含连接凭据。
type RegionServer struct {
	ID       string `json:"id"`
	Name     string `json:"name"`
	Host     string `json:"host"`
	Port     int    `json:"port"`
	Username string `json:"username"`
	Status   string `json:"status"`
}

// Overview 仪表盘聚合响应
type Overview struct {
	Stats        StatsBlock    `json:"stats"`
	Distribution []RegionCount `json:"distribution"`
}
