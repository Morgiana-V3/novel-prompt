# 验证入口

`npm run check:quick` 先执行全范围格式、ESLint、Stylelint、依赖边界和类型检查，再构建一次，运行测试产物路径、代理启动/重连、工作台索引与图片清理。`npm run check:full` 复用同一次构建运行 20 个离线回归场景。失败立即退出；日志目录在启动时打印，位于系统临时目录。

定向运行：`node scripts/check.mjs pages mcp:index workspace:cleanup`。窗口场景按需构建一次，纯源码服务场景通过测试专用 TypeScript 加载器运行。定向命令执行类型检查；完整风格检查由 quick/full 负责。

| 场景 | 运行方式 | 前提 |
| --- | --- | --- |
| artifacts、electron:errors、mcp:launch、mcp:relay | Node；异常验证额外启动隔离 Electron | 不需要构建 |
| mcp:recovery、mcp:context、mcp:index、mcp:preview-cache、desktop:lifecycle、inpaint:mcp、retention、workspace:cleanup、update | Electron + TS 源码 | 不需要构建 |
| prompt、tasks、pages、inpaint、desktop | Electron + TS 服务与真实渲染页 | 先构建一次 |
| mcp:host、startup | Node 启动真实应用与代理 | 先构建一次 |
| isolation | 开发程序与打包程序同时运行 | 设置 NP_PACKAGED_EXECUTABLE；统一入口会构建 |
| mcp:performance | Electron + TS 服务与 MCP 调度 | 独立运行同规模合成数据基准 |
| installed-retention | 两个隔离身份 NSIS 安装包 | 先运行 acceptance:build；不能使用正式安装包 |

环境隔离场景必须在构建完成后启动；不要与改写 out/ 的 dev/build 并行，否则开发窗口可能在重载时丢失正在等待的 CDP 请求。

完整离线回归不请求真实供应商。安装/升级与性能单独执行，避免普通开发重复打包或跑大规模夹具。未知结果的写入不自动重试。

## 日志、异常与产物

- 测试的用户目录、图片、截图、日志、报告和验收包必须在项目外。tests/support/fixtures.cjs 在创建目录前解析已有祖先和 junction，拒绝指向仓库的输出路径。已有 docs/screenshots 是产品文档资源。
- 统一入口把子进程 stdout/stderr 直接连接日志文件，避免启动器结束后 Electron 写入已关闭管道引发 EPIPE。每个场景有四分钟超时，主进程加载失败或测试异常标记会让检查失败。
- 源码测试加载 electron-errors.cjs；未捕获异常和未处理 rejection 写入错误日志并以非零码退出，不显示阻塞验收的错误弹窗。这是测试设施，不是生产错误的忽略规则。electron:errors 实际验证两种失败路径。
- 场景的 renderer assertion、协议失败和应用错误仍须处理；不得将错误日志当作通过。只清理自己创建的测试进程，不结束已有开发宿主。

## 风格与边界

`format:check` / `format:fix`、`lint:check` / `lint:fix`、`style:check` / `style:fix` 明确区分检查与修复。格式和 lint 覆盖 src、scripts、tests，样式检查覆盖全部 renderer CSS/Less/Vue；配置文件也纳入格式检查。

ESLint 检查花括号、单行语句、独立变量、嵌套三元、未使用变量、类型导入、显式 any 和未处理 Promise（void 不代表已处理）。Prettier 负责换行与模板属性。Stylelint 检查有效样式及一级内部嵌套，不排序声明；不跨无关 scoped 组件强制选择器顺序。

`boundaries:check` 检查 app/adapters/modules/providers 的反向引用、renderer/shared 越层依赖、shared 平台依赖、preload/renderer 实现耦合、生产引用 scripts/tests，以及运行时循环依赖（排除 type-only 引用）。同时拒绝旧测试输出目录和测试直接创建未受保护的临时目录。命名、职责及生命周期仍需审查。

## 独立安装与环境隔离

```powershell
# 基线源码从改造前提交导出到项目外，并提供 node_modules。
$acceptance = Join-Path $env:TEMP 'novel-prompt-acceptance'
node scripts/build-acceptance-packages.mjs "$acceptance/baseline-source"
node tests/e2e/installed-retention-smoke.mjs "$acceptance/baseline-local/NovelPrompt-Acceptance-baseline.exe" "$acceptance/current/NovelPrompt-Acceptance-current.exe"
$env:NP_PACKAGED_EXECUTABLE = "$acceptance/current/win-unpacked/NovelPrompt Acceptance.exe"
node scripts/check.mjs isolation
```

可通过 NP_ACCEPTANCE_OUTPUT 指定其他项目外目录，通过 NP_ACCEPTANCE_TARGET=baseline 或 current 只构建一侧。安装包具有独立 appId/productName，禁用快捷方式及安装后自动运行；测试核对构建记录和文件 hash，再进行安装、覆盖升级、文件占用、重启与异常恢复，结束后卸载自己的验收程序。

## 性能与视觉

`node scripts/check.mjs mcp:performance` 使用 13/500/3000 条消息、1/50/200 个版本、最多 800 个区域的夹具，并扩展到 200 个项目。比较工具目录、上下文字节数、项目读取次数、耗时与采样 heap/RSS；报告写在输出中打印的临时 profile 下。结果包含 TS 源码加载器开销，采样内存不是峰值，也不是安装版内存；OS 缓存和 GC 未强制清空，应记录这些限制。

`npm run screenshots` 使用离线演示内容，在临时目录输出截图。开发模式可用独立 NOVELPROMPT_USER_DATA 执行 `npm run dev -- -- --screenshots=<项目外目录>`；截图模式另建临时 profile。不要把 `screenshots:ai` 当作离线验收，它会显式调用模型。

Less 仅在 ThemeSelect 试点。验收包括开发/生产编译、scoped 选择器、主题变量、选择/焦点/禁用状态、对话框内菜单及窗口缩放。是否扩大使用范围由实际复用需求决定，不批量改后缀。

Skill 目录包：构建后运行 `npm run skills:smoke`，或 `node scripts/check.mjs skills`。覆盖目录预览/复制/导出、旧单文件保留、越界及链接拒绝、冻结按需读取和真实界面编辑；界面验证包括 Markdown 排版、包内链接/图片、草稿与撤销隔离、查找框 Esc、Ctrl+S 保存、只读源码、窄窗口布局，以及禁用原生 HTML 和外部图片。合成资料与截图仅写入系统临时目录，不调用真实模型。
