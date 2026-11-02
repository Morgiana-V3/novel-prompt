# 验证入口

`npm run check:quick` 先执行全范围格式、ESLint、Stylelint、依赖边界和类型检查，再构建一次，运行测试产物路径、代理启动/重连、工作台索引与图片清理。`npm run check:full` 复用同一次构建运行统一入口登记的全部离线回归场景（当前 33 个）。失败立即退出；日志目录在启动时打印，位于系统临时目录。

定向运行：`node scripts/check.mjs pages mcp:index workspace:cleanup`。窗口场景按需构建一次，纯源码服务场景通过测试专用 TypeScript 加载器运行。定向命令执行类型检查；完整风格检查由 quick/full 负责。

`node scripts/check.mjs prompt` 同时运行创作实验回归（`tests/e2e/creation-checks.cjs`）：新旧入口保留与切换、单实例复用、Tag 替换及原生撤销、角色焦点、过期 AI 建议保护、纯画面推测与旧版完整评估的隔离、生成快捷键及跨页互斥、浏览图片与恢复配置、1100/1440 宽度布局。`preview-forecast-checks.cjs` 验证真实推测编排忽略旧期望、不返回改写字段，并保留旧入口行为。AI 与生图响应来自离线夹具，不使用真实账户额度。

| 场景                                                                                                                                                                                                 | 运行方式                            | 前提                                        |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- | ------------------------------------------- |
| artifacts、electron:errors、reverse:models、mcp:launch、mcp:relay                                                                                                                                    | Node；异常验证额外启动隔离 Electron | 不需要构建                                  |
| mcp:recovery、mcp:context、mcp:index、mcp:preview-cache、desktop:lifecycle、inpaint:mcp、retention、workspace:cleanup、tasks:background、skills:builtins、skills:templates、discussion:tools、update | Electron + TS 源码                  | 不需要构建                                  |
| prompt、tasks、pages、inpaint、desktop、favorites、settings、reverse:recommendations、skills                                                                                                         | Electron + TS 服务与真实渲染页      | 先构建一次                                  |
| favorites:dev                                                                                                                                                                                        | 临时 Vite 服务 + Electron           | 开发模式真实渲染页                          |
| mcp:host、startup                                                                                                                                                                                    | Node 启动真实应用与代理             | 先构建一次                                  |
| isolation                                                                                                                                                                                            | 开发程序与打包程序同时运行          | 设置 NP_PACKAGED_EXECUTABLE；统一入口会构建 |
| mcp:performance                                                                                                                                                                                      | Electron + TS 服务与 MCP 调度       | 独立运行同规模合成数据基准                  |
| installed-retention                                                                                                                                                                                  | 两个隔离身份 NSIS 安装包            | 先运行 acceptance:build；不能使用正式安装包 |

环境隔离场景必须在构建完成后启动；不要与改写 out/ 的 dev/build 并行，否则开发窗口可能在重载时丢失正在等待的 CDP 请求。

完整离线回归不请求真实供应商。安装/升级与性能单独执行，避免普通开发重复打包或跑大规模夹具。未知结果的写入不自动重试。

## 本次发布整理

- 移除未被测试入口或其他脚本引用的 `tests/support/mcp-call.mjs`、`tests/support/mcp-session-client.mjs`：它们是历史手工调试客户端，不属于隔离回归测试。正式 MCP 验证继续使用下列已登记场景。
- 一次性调试脚本、生图草稿、视频试片和预览产物放在仓库外，按项目归档；不要把这些制作过程文件放进源码或测试目录。
- 删除 `tests/integration/mcp-smoke.mjs`：旧手工脚本连接真实开发 profile，协议与宿主检查已由隔离的 `mcp:host`、`mcp:relay` 和 `mcp:context` 覆盖。`npm run mcp:smoke` 改为统一入口的 `mcp:host`。
- 删除 `tests/integration/mcp-read-smoke.mjs`：面向已有真实项目的只读测量脚本不作为发版回归；保留合成数据的 `mcp:context`、`mcp:index` 和可选 `mcp:performance`。
- 将账户设置回归 `settings` 加入完整检查，覆盖 Token 保存、清空、失败回滚及余额刷新。
- 增加 `favorites:dev`：独立启动临时 Vite 服务和隔离 Electron，复用收藏测试，直接验证开发模式初始化。生产与开发两种模式均将前端错误视为失败，防止页面看似可用却隐藏运行异常。
- 保留收藏、任务、图片清理、Skill 内容指纹、安装升级和更新器测试；这些分别覆盖数据与用户操作风险，不能通过删除失败测试使发版通过。
- 统一文本换行，避免 Windows 检出 CRLF 与 Prettier 的 LF 要求冲突。

`node scripts/check.mjs favorites favorites:dev settings` 验证本版主要交互。测试覆盖 v0.8 旁置 JSON 图片记录、独立收藏、种子分组、普通图库、搜索、滚动位置恢复、气泡确认、提示消息、参数载入、悬停状态和窄窗口布局。不下载真实识别模型，也不调用付费生图。

## 日志、异常与产物

- 测试的用户目录、图片、截图、日志、报告和验收包必须在项目外。tests/support/fixtures.cjs 在创建目录前解析已有祖先和 junction，拒绝指向仓库的输出路径。已有 docs/screenshots 是产品文档资源。
- 统一入口把子进程 stdout/stderr 直接连接日志文件，避免启动器结束后 Electron 写入已关闭管道引发 EPIPE。每个场景有四分钟超时，主进程加载失败或测试异常标记会让检查失败。
- 源码测试加载 electron-errors.cjs；未捕获异常和未处理 rejection 写入错误日志并以非零码退出，不显示阻塞验收的错误弹窗。这是测试设施，不是生产错误的忽略规则。electron:errors 实际验证两种失败路径。
- 场景的 renderer assertion、协议失败和应用错误仍须处理；不得将错误日志当作通过。只清理自己创建的测试进程，不结束已有开发宿主。

## 风格与边界

创作实验的 `generation-popover-checks.cjs` 随 prompt 场景验证左侧生成栏与右侧完整高度、浮层不遮挡右侧、不挤压编辑区、参数保留、下拉菜单选择、Esc / 点击外部关闭，并保存宽窄窗口截图。

`node scripts/check.mjs prompt tasks` 同时覆盖逐项采纳与任务执行记录：`unit/partial-adoption-checks.cjs` 检查文字精确重组、独立开关、角色中间增删、重排和歧义结构整组采纳、位置、重复词和自然语言、完整 Tag 与权重组不可拆分、后续手动编辑冲突；`e2e/partial-adoption-checks.cjs` 检查实际点击同步、已采纳标记、再次点击取消、导航不隐式采纳剩余项，以及冲突时不覆盖编辑。tasks 场景检查执行步骤展开、重复合并、容量上限和快照独立性。全部使用隔离数据和模拟供应商，不产生真实 AI / 生图消耗。

prompt 场景还包含 `integration/prompt-presets-checks.cjs` 和 `e2e/preset-settings-checks.cjs`：前者执行真实优化编排，以模拟 AI 检查 V4.5 / V5 × 质量词 Standard / Light / None × 各 UC 档的上下文与实际生图请求一致，遗漏设置时不假定状态；后者操作输入框底部开关、检查优化/推测请求、设置变化提示、全部尺寸档及自定义输入、实际免费资格计算，并保存宽窄窗口底栏截图。这些测试验证请求和交互，不保证真实模型每次遵守建议规则。

词条移除回归 `unit/remove-tokens-checks.cjs` 覆盖嵌套大括号 / 方括号 / 数值权重、共享权重组、重复词、尾部逗号、引号、转义、Text 块和批量删除，并逐项枚举删除组合验证剩余文本及有效权重不变。`e2e/editor-refinement-checks.cjs` 验证卡片连点不进入翻译编辑、无新增删除按钮 / 定位后退格及原生撤销、自动留存保存与浮层不重复展示。局部采纳场景额外验证默认前后对比、分区切换时说明跟随当前字段、无独立修改说明页签或重复概述悬浮提示、对比下直接采纳、完整上下文默认显示、修改要求折叠、采纳标记保留且对照原文不变，保存宽窄对比截图。`unit/review-explanation-checks.cjs` 覆盖角色插入、删除、重排以及旧说明无法明确归属时的保留；预设集成检查同时验证后端过滤空角色后的说明索引。

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

验收版本从两侧 package.json 派生并写入构建记录，不再固定为某一历史版本。覆盖升级额外核对用户 Skill 正文与启用顺序、内置开关、历史版本和讨论冻结规则；附带漫画首次默认关闭，删除后重启不恢复。数据夹具通过旧版实际接口创建，真实用户目录不用于覆盖安装测试。

## 性能与视觉

`node scripts/check.mjs mcp:performance` 使用 13/500/3000 条消息、1/50/200 个版本、最多 800 个区域的夹具，并扩展到 200 个项目。比较工具目录、上下文字节数、项目读取次数、耗时与采样 heap/RSS；报告写在输出中打印的临时 profile 下。结果包含 TS 源码加载器开销，采样内存不是峰值，也不是安装版内存；OS 缓存和 GC 未强制清空，应记录这些限制。

`npm run screenshots` 使用离线演示内容，在临时目录输出截图。开发模式可用独立 NOVELPROMPT_USER_DATA 执行 `npm run dev -- -- --screenshots=<项目外目录>`；截图模式另建临时 profile。不要把 `screenshots:ai` 当作离线验收，它会显式调用模型。

Less 仅在 ThemeSelect 试点。验收包括开发/生产编译、scoped 选择器、主题变量、选择/焦点/禁用状态、对话框内菜单及窗口缩放。是否扩大使用范围由实际复用需求决定，不批量改后缀。

Skill 目录包：构建后运行 `npm run skills:smoke`，或 `node scripts/check.mjs skills`。覆盖目录预览/复制/导出、旧单文件保留、越界及链接拒绝、冻结按需读取和真实界面编辑；界面验证包括 Markdown 排版、包内链接/图片、草稿与撤销隔离、查找框 Esc、Ctrl+S 保存、只读源码、窄窗口布局，以及禁用原生 HTML 和外部图片。合成资料与截图仅写入系统临时目录，不调用真实模型。

内置 Skill 完整交付：`node scripts/check.mjs skills:builtins` 校验历史及合并前全部段落的内容指纹、稳定 ID/启用/顺序、完整复制导出、模拟安装资源路径、内置 AI 首次全文交付及 MCP 完整入口读取。编排仅组合示例按需，预览与重绘不需要额外参考读取。历史 `builtin-skills-baseline.json` / `builtin-skills-revisions.json` / `builtin-skills-content.json` 保留不改；`builtin-skills-precision-revisions.json` 记录此前精度修订；`builtin-skills-merge-baseline.json` 保存合并前正文段落和代码块指纹，`builtin-skills-merge-revisions.json` 记录逐段替代和理由。检查沿修订链追踪旧内容，验证代码块完整保留，并确认原必需参考的规则已经出现在首次正文中；删除关键段落的故障样例必须被拒绝。frontmatter 由加载后的名称、scope/model 与配置行为检查，正文指纹不包含 YAML。仅执行流程和编排顺序使用有序列表，引用不使用数字章节。内置包与漫画包均通过实际 Markdown 渲染验证文件和标题锚点。字符数报告与合成工具场景不能证明真实模型遵循或成图质量，不以缩减上下文比例作为通过门槛。

附带用户 Skill：`node scripts/check.mjs skills:templates skills` 验证首次初始化默认关闭、直接编辑/启用/导出/删除、重启不补回、旧模板删除记录迁移、已有副本不覆盖及顺序保留、完整正文和 Markdown 链接、安装资源路径。保留原漫画内容指纹与修订记录。界面验证只有内置与用户两组，漫画可直接编辑与删除。测试使用临时 profile，不改真实用户数据，也不调用真实模型。

工作台工具调度：`node scripts/check.mjs discussion:tools` 覆盖一次超过 8 个工具调用、批量参考读取、混合资料/标签调用的应答完整性、重复查询去重、最多 4 个查询并发、48 次唯一查询上限、6 轮查询后收束作答和取消清理。参考读取预算在同一轮讨论中共享，不在每次标签查询后重置。测试使用假供应商与临时用户目录。

`desktop` 的真实 MCP 契约回归覆盖 `get_skill` 入口、总则、参考文件和不存在的路径；该测试会经过输出 schema 校验，不能用直接 `.run()` 替代。

## 2026-11-02 架构调整验收

新增图库/聚焦对比回归：`node scripts/check.mjs collections statistics tasks prompt retention`。collections 使用真实 PNG 验证分类持久化、默认兜底、改名、删除图集保留原图及配方、临时图留存保留分组；tasks 验证图库筛选、移动、新建/重命名/删除、生成图集选择、1100/1440 布局，以及 AI 用量折叠、统计导航顺序和 Anlas 趋势。statistics 验证旧文件升级、积分扣减与未知用量；prompt 验证范围切换、完整对比和长段整段采纳/取消，不影响未选字段。

页面精简回归还检查：分区对比没有重复标题、折叠节点或上下文切换；图库紧邻收藏上方，新建图集输入使用公共表单样式；1100/1440 窗口下生图底栏的设置、图集、自动留存、费用标记与生成按钮位于同一行且互不重叠、高度不超过 52px，费用状态在按钮外，设置入口只有图标，参数仍能通过浮层调整。滚动容器不预留滚动条空槽，创作实验的出图结果不附带推测与实际对照。

- 改动前 quick 检查通过；改动后格式、ESLint、Stylelint、依赖边界、类型和生产构建通过。
- full 登记的 33 个离线场景全部分批通过：首批 15 个，后续 17 个，桌面综合场景单独复验通过。覆盖工作台、重绘、收藏、设置、Skill、MCP、任务、数据保留和更新。
- 桌面测试原先假设设置页同时显示两个密钥输入框，并直接操作隐藏的 Agent 面板。独立 HEAD 副本复现了原有密钥计数失败；测试现逐页检查两个密钥的遮挡，并先打开 Agent 标签页再检查键盘焦点，保留原有隐私和交互断言。
- Windows x64 解包构建成功；13 个内置规则、初始用户规则和词库文件均与源码逐字节一致，安装包中的旧资源路径保持不变。该检查不包含安装器安装或签名流程。
- 回归使用独立临时数据与模拟供应商请求，不消耗真实 AI/生图额度。日志、截图和验收包保存在系统临时目录，不写入用户创作数据。

局部采纳还回归了行尾 Tag 后插入互动词的案例：`standing` 保留，只把 `target#pointing at another` 标为新增；反向操作只标删除该新增词。覆盖末尾追加、换行与逗号变化、重复词次数、真实前缀替换、Text 块标点及采纳 / 取消后的逐字恢复。

`node scripts/check.mjs statistics tasks prompt` 验证统计和界面：statistics 使用隔离目录和模拟供应商，覆盖缓存不重复累计、并行任务归属、缺失 usage、已收费但结果无效、重试、取消、部分图片批次、跨天存储、重读与清空、持久化内容不含密钥。tasks 额外验证任务用量、设置统计入口、累计摘要、图表切换和每日选择、宽窄布局、取消清空与实际清空。prompt 验证采纳状态仍可切换，按钮不再铺设「采纳 / 已采纳」和「（删除）」文字。截图与数据留在临时隔离目录，所有供应商请求都由夹具响应。
