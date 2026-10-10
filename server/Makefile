.PHONY: dev dev-simple build test clean deps mock migrate-up help

# 默认目标 - 显示帮助
.DEFAULT_GOAL := help

# 显示帮助信息
help:
	@echo "EasySSH 服务端 Makefile 命令:"
	@echo ""
	@echo "  make dev         - 开发模式运行 (支持热重载)"
	@echo "  make dev-simple  - 开发模式运行 (无热重载)"
	@echo "  make build       - 构建二进制文件"
	@echo "  make test        - 运行测试"
	@echo "  make clean       - 清理构建文件"
	@echo "  make deps        - 安装依赖"
	@echo "  make mock        - 生成 mock 文件"
	@echo ""

# 开发模式运行 - 支持热重载
dev: sync-deps
	@if [ -f /root/go/bin/air ]; then \
		/root/go/bin/air; \
	elif command -v air >/dev/null 2>&1; then \
		air; \
	else \
		echo "⚠️  Air 未安装,使用普通模式 (无热重载)"; \
		echo "💡 安装 Air: go install github.com/cosmtrek/air@latest"; \
		go run ./cmd/api; \
	fi

# 开发模式运行 - 无热重载
dev-simple: sync-deps
	go run ./cmd/api

# 构建
build:
	go build -o bin/easyssh-api ./cmd/api

# 运行测试
test: sync-deps
	go test -v ./...

# 清理构建文件
clean:
	rm -rf bin/

# Automerge worker runtime; Go remains CGO-free.
.PHONY: sync-deps
sync-deps:
	npm ci --prefix sync-runtime --ignore-scripts --no-audit --no-fund

# 安装依赖
deps: sync-deps
	go mod download
	go mod tidy

# 生成 mock 文件
mock:
	mockgen -source=internal/domain/repository.go -destination=internal/mock/repository.go

# 数据库迁移
# Use an already built binary; migrations never trigger a build implicitly.
# Existing versioned upgrades require BACKUP_FILE and PASSWORD_FILE.
BACKUP_FILE ?=
PASSWORD_FILE ?=
migrate-up:
	./bin/easyssh-api maintenance migrate --file "$(BACKUP_FILE)" --password-file "$(PASSWORD_FILE)"
