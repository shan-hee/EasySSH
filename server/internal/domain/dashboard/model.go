package dashboard

import "time"

// StatsBlock 顶部统计卡片数据块
type StatsBlock struct {
	OnlineServers  int64 `json:"online_servers"`
	TotalServers   int64 `json:"total_servers"`
	ActiveSessions int64 `json:"active_sessions"`
	TodayCommands  int64 `json:"today_commands"`
}

// RegionCount 服务器区域分布项
type RegionCount struct {
	Region      string `json:"region"`       // 展示名（优先 country，回退 region）
	CountryCode string `json:"country_code"` // 国家代码，用于前端地图打点
	Count       int    `json:"count"`
}

// RecentServer 是仪表盘最近连接列表所需的最小服务器投影。
type RecentServer struct {
	ID            string     `json:"id"`
	Name          string     `json:"name"`
	Host          string     `json:"host"`
	Port          int        `json:"port"`
	Username      string     `json:"username"`
	Group         string     `gorm:"column:server_group" json:"group"`
	Status        string     `json:"status"`
	Country       string     `json:"country"`
	City          string     `json:"city"`
	LastConnected *time.Time `json:"last_connected,omitempty"`
}

// Overview 仪表盘聚合响应
type Overview struct {
	Stats         StatsBlock     `json:"stats"`
	Distribution  []RegionCount  `json:"distribution"`
	RecentServers []RecentServer `json:"recent_servers"`
}
