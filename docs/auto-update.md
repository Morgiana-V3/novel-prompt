# 发布应用内更新

Windows NSIS 安装版在启动后和每 6 小时检查 GitHub Releases，发现正式新版会在后台下载，下载完成后提示「重启并更新」。只有用户点击并确认，且界面任务已结束、关键编辑已保存时，才静默安装并重新打开应用。普通退出不自动安装。

便携版、开发预览和缺少更新配置的旧安装包只提供下载入口。v0.6.0 是首个包含本功能的正式版本；v0.5.0 及更早版本需要用户先手动安装一次新版安装版，后续版本才能走应用内更新。

## 发布步骤

1. 用 `npm version <新版本号> --no-git-tag-version` 同步更新 package.json 和 package-lock.json。版本必须递增；例如从 0.8.0 发布到 0.9.0。
2. 完成依赖安装后，按 [测试说明](testing.md) 连接已加载当前代码的本机开发实例，运行 `npm run check:full` 的自动真实灰度；涉及 MCP、AI 或工作台行为时，再完成外部 Agent 交互验收。明确记录未覆盖的安装更新链路。完成当前实例验收后再安排 `npm run dist`，不要与同目录开发服务并行改写构建输出，也不要打断未保存编辑或执行中的任务。
3. 提交全部源码、文档和新增文件，以对应提交创建版本标签；在 `Morgiana-V3/novel-prompt` 创建 GitHub Release（例如 `v0.9.0`），先保存为草稿。
4. 将同一次构建的以下文件一起上传，保持原名：
   - `release/NovelPrompt-Setup-<版本>.exe`
   - `release/NovelPrompt-Setup-<版本>.exe.blockmap`
   - `release/latest.yml`
   - 可选：`release/NovelPrompt-Portable-<版本>.exe`，供便携版用户手动下载。
5. 核对 `latest.yml` 中的版本、安装包文件名和 SHA-512 摘要，再发布为正式 Release。不要标为 prerelease，也不要在附件上传完之前公开发布。

`npm run dist` 仅在本地打包，不会自动公开发布。构建器根据 package.json 的 publish 配置写入 `resources/app-update.yml`，客户端使用固定仓库，不携带 GitHub 发布令牌。

## 更新与数据

- `.blockmap` 让更新器尝试差量下载；无法复用旧文件时自动下载完整安装包。它不是运行时替换 JavaScript：应用代码在重启后整体切换到新版本。
- 下载完成前会校验 SHA-512，文件损坏不会进入可安装状态。校验过的下载缓存可在下次启动复用。
- 应用 ID、包名与用户数据路径保持稳定。设置、用户 Skill、图库、会话与提示词仍保存在原用户目录，不随程序安装目录一起替换。未来数据格式变化需要单独设计兼容迁移；自动更新器不会自动迁移业务数据。
- 后续使用 Windows 代码签名时，持续使用同一发布者身份；electron-updater 会使用构建生成的发布者信息校验更新包签名。
- GitHub 无法访问时显示错误、允许重试，现有功能继续可用。如果以后改用自有 CDN，需要先发布带新更新源的过渡版本。

## 发布前验收

当前功能验收直接使用当前本机开发实例、现有配置和数据，按 [测试说明](testing.md) 执行。`check:full` 是自动灰度部分，不能替代涉及 MCP、AI 或工作台改动所要求的外部 Agent 实际交互。

开发实例的验收不包含 NSIS 覆盖安装，也不能证明 GitHub 下载、确认重启、安装与数据保留的整条更新链路通过。报告须明确这一限制；不得按旧流程启动隔离应用或模拟更新服务，也不得为补足验收覆盖安装当前用户软件。

### 历史更新验收（已停用）

`npm run update:smoke` 曾使用本机临时 HTTP 服务与无害文件验证 electron-updater 的更新清单读取、下载校验、损坏文件拒绝、失败重试、差量失败回退和重启缓存复用。该入口现已明确拒绝执行，历史源码仅供追溯，不是当前验收指令。

此前 `tests/e2e/installed-retention-smoke.mjs` 在独立应用身份下验证覆盖安装与数据保留：从基线源码构建安装包，覆盖升级后核对设置、图片、图库与图集、用户 Skill 正文与顺序、历史版本及冻结规则，并检查文件占用重试、正常退出和异常恢复。各版本的历史结果记录在 [更新记录](../CHANGELOG.md)。此隔离流程已停用，不能作为当前真实开发验收依据；其历史结果也不证明从 GitHub 下载到点击更新的整条线上链路通过。

参考：[electron-builder 自动更新文档](https://www.electron.build/docs/features/auto-update/)。本项目使用 electron-updater 6.x，与 electron-builder 26.x 配套，调用 `quitAndInstall(true, true)`；升级依赖大版本时需核对 API 变更。
