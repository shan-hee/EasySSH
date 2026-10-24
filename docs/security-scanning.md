# 安全扫描与发布门禁

## 默认分支依赖报告

`.github/workflows/security-scan.yml` 在推送 `main`、每天北京时间 09:23
以及手动触发时运行 Trivy 文件系统依赖扫描。它读取仓库中的 Go、npm、pnpm
依赖文件，不安装项目依赖、不构建镜像、不运行测试。

报告使用固定类别 `trivy-dependencies`，收录 HIGH、CRITICAL 漏洞，包括尚无
修复版本的漏洞。发现漏洞会显示在 Security → Code scanning；报告生成或上传
失败会使工作流失败。工作流成功仅表示报告已更新，不表示没有漏洞。

## 发布镜像门禁

`.github/workflows/docker-build.yml` 先构建待扫描镜像，再按不可变摘要分别扫描
所选的 amd64、arm64 架构。每个架构的报告生成、报告上传和漏洞门禁均须成功，
之后才会将该镜像提升为正式版本及可选的 `latest` 标签。

报告收录 HIGH、CRITICAL 漏洞；发布门禁阻断已有修复版本的 CRITICAL 漏洞。
未覆盖的平台参数会在构建前被拒绝。依赖报告不覆盖运行时基础镜像中的系统包，
因此不能代替发布镜像扫描。

## 过期配置与扫描警告

2026-10-24 已清理默认分支上停用的 `.github/workflows/docker-build.yml:build`
配置及其 8 份历史分析。其最后扫描提交为 `87443fa2`，日期为 2026-07-10；
GitHub 因该配置长期未更新而显示 `Code Scanning results may be out of date`。
清理前已确认 `039f0d2` 的 `trivy-dependencies` 报告上传成功，并备份旧分析。
现行依赖报告及发布镜像的 `trivy-linux-amd64`、`trivy-linux-arm64` 报告均保留。

GitHub 保存的旧配置不会因新增工作流自动消失。清理旧配置只是移除过期记录，
不代表其中的历史漏洞已修复；当前依赖和发布镜像的安全状态应以各自的新报告为准。

以后若再次出现顶部警告，先打开警告中的 status page，区分报告过期、扫描执行
失败和上传失败。仅在新配置已成功覆盖默认分支、旧配置确实停用时清理旧配置；
不要通过删除有效报告或忽略漏洞来消除告警。

## 依赖与工具链修复

2026-10-24 的依赖修复覆盖当前默认分支报告中的 38 条 HIGH、CRITICAL 告警：

- Web 更新 Zod，并为 DOMPurify、fast-uri、Undici 和 Zod 4 的易受影响版本设置
  pnpm overrides；锁文件同步记录修复版本。
- Go 更新 kin-openapi、go-jose/v3、gRPC、OpenTelemetry、go-git、x/net、x/mod
  及其必要的关联依赖，并同步各模块的 go.sum。
- 本地 Wails 副本只包含运行时代码。通过 `go mod tidy` 移除不再使用的上游
  CLI、图像与打包依赖，包括 x/image、klauspost/compress。
- Go 模块最低工具链及 Docker 构建镜像统一为 1.26.10，修复发布镜像中
  Go 1.25.14 的标准库漏洞。开发启动脚本也检查补丁版本。

使用 Trivy 0.76.1 与当日漏洞库扫描更新后的受版本控制依赖清单，HIGH、CRITICAL
结果为 0。此结果采用与依赖工作流相同的扫描范围，不包含镜像系统包，也不代表
构建或测试已通过。推送后由默认分支工作流更新 GitHub 告警；已经发布的镜像
不会随源码修改自动修复，须在后续发布中重新构建并通过逐架构扫描。
