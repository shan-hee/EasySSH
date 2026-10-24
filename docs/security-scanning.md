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

## 首次切换时清理过期配置

1. 将工作流变更合入 `main`，等待 `Dependency Security Scan` 成功，并确认
   Security → Code scanning 中出现最新的 `trivy-dependencies` 报告。
2. 打开 Tools → Trivy，定位旧的 `Build EasySSH Docker Image → build` 配置：
   路径为 `.github/workflows/docker-build.yml:build`，最后扫描提交为
   `87443fa2`，日期为 2026-07-10。
3. 确认仍是上述已停用的默认分支配置后，通过该配置的菜单删除历史配置；不要
   删除新依赖扫描配置或发布镜像的 `trivy-linux-amd64`、`trivy-linux-arm64` 报告。

GitHub 保存的旧配置不会因新增工作流自动消失。清理旧配置只是移除过期记录，
不代表其中的历史漏洞已修复；当前依赖和发布镜像的安全状态应以各自的新报告为准。
