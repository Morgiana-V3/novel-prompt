# 发布应用内更新

Windows NSIS 安装版在启动后和每 6 小时检查 GitHub Releases，发现正式新版会在后台下载，下载完成后提示「重启并更新」。只有用户点击并确认，且界面任务已结束、关键编辑已保存时，才静默安装并重新打开应用。普通退出不自动安装。

便携版、开发预览和缺少更新配置的旧安装包只提供下载入口。v0.6.0 是首个包含本功能的正式版本；v0.5.0 及更早版本需要用户先手动安装一次新版安装版，后续版本才能走应用内更新。

## 发布步骤

1. 用 `npm version <新版本号> --no-git-tag-version` 同步更新 package.json 和 package-lock.json。版本必须递增；例如从 0.5.0 发布到 0.5.1。
2. 执行 `npm ci`、`npm run typecheck`、`npm run update:smoke` 和项目功能回归，再运行 `npm run dist`。
3. 在 `Morgiana-V3/novel-prompt` 创建与版本号对应的 GitHub Release（例如 `v0.5.1`），先保存为草稿。
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

`npm run update:smoke` 使用本机临时 HTTP 服务与无害文件验证真实 electron-updater 的更新清单读取、下载校验、损坏文件拒绝、失败重试、差量失败回退和重启缓存复用；不运行安装器，不读取用户数据。

正式上线前，还需在 Windows 测试机实际安装旧版本，发布一个更高版本的测试安装包，验证下载、确认重启、安装成功以及数据保留。当前仓库的本地测试不等同于 GitHub 线上发布和真实覆盖安装验收。

v0.6.0 本地验证已覆盖构建、更新下载与校验、打包后应用的 MCP 冷启动/重连/数据持久化、内置资源一致性及更新清单哈希。本次未执行真实 NSIS 覆盖安装；该环节及 v0.6.0 到后续正式版本的完整更新安装仍需在独立 Windows 测试环境验收。

v0.8.0 发布验收已使用独立应用身份，实际完成从 v0.7.0 源码构建的 NSIS 安装包覆盖升级至 v0.8.0 验收包。通过旧版真实接口创建数据，核对升级后的用户 Skill 正文与顺序、内置开关、全部历史版本及冻结规则，检查图库、配方、设置、文件占用后的重试、正常退出与异常恢复，以及漫画删除后不补回。验收身份和 profile 均与真实用户隔离；该测试验证安装和数据保留，不等同于从 GitHub 下载到点击更新的整条线上链路。

参考：[electron-builder 自动更新文档](https://www.electron.build/docs/features/auto-update/)。本项目使用 electron-updater 6.x，与 electron-builder 26.x 配套，调用 `quitAndInstall(true, true)`；升级依赖大版本时需核对 API 变更。
