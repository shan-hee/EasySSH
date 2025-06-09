# GitHub Actions 配置指南

## 概述

本项目使用 GitHub Actions 自动构建和发布 Docker 镜像到 Docker Hub。

## 工作流说明

### docker-publish.yml

这个工作流负责：
1. 构建多架构 Docker 镜像（amd64, arm64）
2. 推送镜像到 Docker Hub
3. 生成构建证明（attestation）

### 触发条件

- 推送到 `main`、`master`、`develop` 分支
- 创建版本标签（如 `v1.0.0`）
- Pull Request 到主分支（仅构建，不推送）
- 手动触发

## 配置步骤

### 1. 设置 Docker Hub 凭据

在 GitHub 仓库设置中添加以下 Secrets：

1. 进入仓库 → Settings → Secrets and variables → Actions
2. 添加以下 Repository secrets：
   - `DOCKER_PASSWORD`: Docker Hub 访问令牌（推荐）或密码

注意：用户名已硬编码为 `shanheee`，只需要设置访问令牌即可。

### 2. 创建 Docker Hub 访问令牌

1. 登录 [Docker Hub](https://hub.docker.com/)
2. 进入 Account Settings → Security
3. 点击 "New Access Token"
4. 输入描述（如 "GitHub Actions"）
5. 选择权限（推荐 Read, Write, Delete）
6. 复制生成的令牌

### 3. 更新镜像名称

镜像名称已配置为 `shanheee/easyssh`，如需修改请更新以下文件：

- `.github/workflows/docker-publish.yml`
- `README.md`
- `DOCKER.md`

## 镜像标签策略

| 触发条件 | 生成的标签 |
|---------|-----------|
| 推送到 main/master | `latest` |
| 推送到 develop | `develop` |
| 推送到其他分支 | `branch-name` |
| 创建标签 v1.2.3 | `v1.2.3`, `v1.2`, `v1` |
| Pull Request | `pr-123` |

## 构建特性

- **多架构支持**: 同时构建 AMD64 和 ARM64 架构
- **构建缓存**: 使用 GitHub Actions 缓存加速构建
- **安全扫描**: 自动生成构建证明
- **并行构建**: 前端和后端并行构建以提高效率

## 本地测试

在推送代码前，建议本地测试 Docker 构建：

```bash
# 构建镜像
docker build -t easyssh:test .

# 运行测试
chmod +x test-docker.sh
./test-docker.sh
```

## 故障排除

### 构建失败

1. 检查 Docker Hub 凭据是否正确
2. 确认镜像名称格式正确
3. 查看 Actions 日志中的详细错误信息

### 推送失败

1. 验证 Docker Hub 访问令牌权限
2. 确认仓库名称存在且有推送权限
3. 检查网络连接问题

### 多架构构建问题

如果 ARM64 构建失败，可以临时禁用：

```yaml
platforms: linux/amd64
# platforms: linux/amd64,linux/arm64
```

## 监控和维护

- 定期检查 Actions 运行状态
- 更新 Docker Hub 访问令牌（建议每年更新）
- 监控镜像大小和构建时间
- 定期更新基础镜像版本

## 安全最佳实践

1. 使用访问令牌而非密码
2. 定期轮换访问令牌
3. 限制令牌权限范围
4. 启用 Docker Hub 的安全扫描
5. 使用签名镜像（如果需要）
