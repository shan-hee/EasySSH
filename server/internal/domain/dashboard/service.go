package dashboard

import "context"

type Service interface {
	GetOverview(context.Context, string) (*Overview, error)
}
type service struct{ repo Repository }

func NewService(repo Repository) Service { return &service{repo: repo} }
func (s *service) GetOverview(ctx context.Context, timezone string) (*Overview, error) {
	return s.repo.Overview(ctx, timezone)
}
