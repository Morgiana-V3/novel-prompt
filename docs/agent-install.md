# NovelPrompt：agent 自助安装说明

本文档写给 agent 阅读，用于在用户电脑上安装 NovelPrompt 并接入 MCP。**它只负责安装**：提示词怎么写、工具怎么用，接入后调用 MCP 工具 `prompt_guide` 获取（内容由 NovelPrompt 软件维护，用户可以在软件里修改）。

先确认是否真的需要安装：工具列表里已经有 `prompt_guide`、`analyze_prompt` 等 `novel-prompt` 的工具，就不需要安装，直接调用 `prompt_guide`。

**仅支持 Windows 10 / 11 x64。** 其他系统告诉用户暂不支持，不要尝试。

以下命令都是 PowerShell。每一步执行后检查输出，失败就停下来把错误告诉用户，不要猜着绕过。

## 1. 找到已安装的 NovelPrompt

```powershell
$exe = @(
  "$env:LOCALAPPDATA\Programs\NovelPrompt\NovelPrompt.exe",
  "$env:ProgramFiles\NovelPrompt\NovelPrompt.exe"
) + (Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*', 'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*' -ErrorAction SilentlyContinue |
  Where-Object { $_.DisplayName -like 'NovelPrompt*' -and $_.InstallLocation } |
  ForEach-Object { Join-Path $_.InstallLocation 'NovelPrompt.exe' }) |
  Where-Object { Test-Path $_ } | Select-Object -First 1
$exe
```

有输出就是已安装，跳到第 3 步。没有输出，进入第 2 步。

## 2. 下载并安装（需要用户同意）

**先征得用户同意**再下载安装（会从 GitHub 下载约 100 MB 的安装包并安装到用户目录）。

```powershell
$rel = Invoke-RestMethod 'https://api.github.com/repos/Morgiana-V3/novel-prompt/releases/latest' -Headers @{ 'User-Agent' = 'novel-prompt-agent' }
$asset = $rel.assets | Where-Object { $_.name -like 'NovelPrompt-Setup-*.exe' } | Select-Object -First 1
$setup = Join-Path $env:TEMP $asset.name
Invoke-WebRequest $asset.browser_download_url -OutFile $setup
Start-Process $setup -ArgumentList '/S' -Wait      # 静默安装到 %LOCALAPPDATA%\Programs\NovelPrompt
$exe = "$env:LOCALAPPDATA\Programs\NovelPrompt\NovelPrompt.exe"
Test-Path $exe
```

- 不要使用 `NovelPrompt-Portable-*.exe`（便携版）：它每次运行都解压到临时目录，路径不固定，无法接入 agent。
- 网络无法访问 GitHub 时，请用户手动从 https://github.com/Morgiana-V3/novel-prompt/releases 下载安装，装好后回到第 1 步。

## 3. 接入 agent

把 NovelPrompt 写进你自己的 MCP 配置（用户级）。它以 Node 模式运行 NovelPrompt.exe 本身，不需要另装 Node：

| 字段 | 值 |
|---|---|
| 服务名 | `novel-prompt` |
| 传输方式 | stdio |
| `command` | `$exe` 的完整路径 |
| `args` | `[ "<$exe 所在目录>\resources\mcp-proxy.cjs" ]` |
| `env` | `{ "ELECTRON_RUN_AS_NODE": "1", "NOVELPROMPT_MCP_GROUPS": "all" }` |

- 路径用第 1 / 2 步得到的实际路径，不要猜默认位置。
- 写入前先把原配置文件备份为 `.bak`，只新增或覆盖 `novel-prompt` 这一项，其他内容不要动。
- 旧版本曾在 `~/.codex/skills/novel-prompt`、`~/.claude/skills/novel-prompt` 安装过 Skill，存在的话征得用户同意后删除，以免读到过期规则。

Codex（`~/.codex/config.toml`）示例：

```toml
[mcp_servers.novel-prompt]
command = 'C:\Users\你\AppData\Local\Programs\NovelPrompt\NovelPrompt.exe'
args = ['C:\Users\你\AppData\Local\Programs\NovelPrompt\resources\mcp-proxy.cjs']
env = { ELECTRON_RUN_AS_NODE = '1', NOVELPROMPT_MCP_GROUPS = 'all' }
```

Claude Code（`~/.claude.json` 的 `mcpServers`）、Cursor 等 JSON 格式：

```json
{
  "mcpServers": {
    "novel-prompt": {
      "command": "C:\\Users\\你\\AppData\\Local\\Programs\\NovelPrompt\\NovelPrompt.exe",
      "args": ["C:\\Users\\你\\AppData\\Local\\Programs\\NovelPrompt\\resources\\mcp-proxy.cjs"],
      "env": { "ELECTRON_RUN_AS_NODE": "1", "NOVELPROMPT_MCP_GROUPS": "all" }
    }
  }
}
```

## 4. 生效与验证

1. 告诉用户**完全重启 agent**（MCP 配置只在启动时加载）。
2. 重启后调用 `prompt_guide`，能返回使用说明和用户启用的提示词 Skill 即接入成功。之后写 NovelAI 提示词时按它执行；用户要求调整规则时，用 Skill 管理工具（`list_skills` / `create_skill` / `update_skill` / `set_skill_config` 等）修改。
3. 失败时依次检查：配置里的路径是否存在；是否用了便携版；用户是否移动过安装目录（移动后重新执行第 3 步）。

## 5. 可选：告诉用户还可以配置什么

以下设置都在 NovelPrompt 窗口的「设置 / 数据」页，**请用户自己在界面里填写，不要直接编辑 `settings.json`，也不要让用户把 Token 发给你**：

| 设置 | 用途 |
|---|---|
| NovelAI Persistent API Token | `nai_subscription`、`generate_image` 需要 |
| Agent 接入 →「允许生图」 | 开启后才能调用 `generate_image`（默认关闭） |
| DeepSeek API Key + 「允许调用 DeepSeek」 | `optimize_prompt` / `preview_prompt` 需要；agent 本身就是大模型，一般不需要 |

不填这些也能使用查词、标签核对和整套检查等工具。

## 从源码运行（开发者）

用户明确要用源码时才走这条路：

```powershell
git clone https://github.com/Morgiana-V3/novel-prompt.git; cd novel-prompt
npm install; npm run build
```

然后按第 3 步写配置，但 `command` 用 `<项目目录>\node_modules\electron\dist\electron.exe`，`args` 用 `[ "<项目目录>\scripts\mcp-proxy.cjs", "<项目目录>" ]`。

此时 MCP 指向项目目录，改代码后要重新 `npm run build`。

## 与桌面界面共同工作

新版 MCP 代理通过带本地会话认证的管道连接应用主进程。同一安装目录和用户数据目录下，窗口及多个 Agent 共用词库、工作台、任务和生图锁；没有运行中的应用时自动启动无窗口服务。关闭窗口后，只要 Agent 仍连接或任务仍在运行，服务会保留；没有窗口、客户端和任务时自动退出。

接入命令不变。首次升级到这个版本后，需要退出旧版软件并重连 Agent 的 MCP；源码运行还需先重新构建。已经建立的旧连接不会自动获得新工具。

### 后台模式：处理数据，按需同步结果

前后台共享同一套项目数据。后台 create_workspace 默认不打开窗口，需要显示时传 show:true；list_images 返回带分页信息的对象（items/hasMore/nextBeforeName）。适合查词、检查提示词、生成图片，或由外部 Agent 自己整理建议，再同步到工作台。界面可以显示最终结果，但不代表走过前台每一步操作。

调用流程：

1. `get_app_state` 获取当前页面、共享提示词、图片、工作台选择和任务。返回内容不包含账户配置中的密钥。
2. `navigate_app` 打开窗口或切换页面；`tab: "workspace"` 配合 `workspace_id` 打开指定会话。
3. 修改主提示词时，先读取状态，再把 `desktop.token` 作为 `apply_app_prompt.expected_token` 传入。期间用户已编辑则拒绝覆盖，成功写入会保留修改前历史。
4. 在工作台中用 `list_workspaces` / `get_workspace` 读取上下文，用 `propose_workspace_edit` 提交完整建议。建议会显示在界面中，用户可以查看、采纳；也可按用户指示调用 `apply_workspace_action` 采纳、拒绝、撤销或切换历史版本。写入必须使用最新 `revision`，遇到用户正在编辑时先等待。
5. `generate_workspace` 根据已采纳稿生成新版本，也能使用已有区域重绘。必须开启「允许生图」、取得用户授权并传 `confirm: true`；仍检查免费条件。`read_image` 将图库图片或选区预览作为 MCP 图片返回，客户端需要支持图像内容。
6. `list_tasks` 和 `cancel_task` 与软件任务中心共用状态。Agent 任务有来源标记；生图取消等待当前图片保存，保留已完成结果。

支持资源 `novelprompt://app/state` 的读取、订阅与变化通知，以及带 `progressToken` 的调用进度。**变化通知是否触发模型行动由外部客户端决定**：服务端支持通知不等于 Agent 会自动醒来。不支持订阅的客户端可在操作前调用 `get_app_state`。不需要为每次状态变化重新发送整套 Skill，`prompt_guide(detail: "summary")` 提供摘要和规则指纹，写提示词前仍应获取完整有效规则。

### 前台模式：在实际界面中执行工作流

告诉 Agent「这次使用前台可视化模式，每一步在 NovelPrompt 中显示」。同一 MCP 服务提供以下 `ui_*` 工具，不需要电脑操作插件或鼠标模拟：

| 工具 | 软件中可见的效果 |
| --- | --- |
| `ui_open_workspace` | 显示窗口并打开指定会话 |
| `ui_create_workspace` | 显示新建表单，填入名称与来源，再创建会话 |
| `ui_view_workspace` | 切换画布、当前提示词、修改对比、建议或历史 |
| `ui_set_workspace_input` | 填入对话框，选择讨论区域及参考版本；尚不提交 |
| `ui_send_workspace_message` | 提交当前输入；内置模式调用内置 AI，外部接管模式保存需求并等待外部 Agent 回复 |
| `ui_set_workspace_agent` | 选择内置 AI 或绑定当前外部 Agent，显示处理者及连接状态 |
| `ui_reply_workspace_request` | 展示外部 Agent 写回的回复和可选修改方案 |
| `ui_cancel_workspace_request` | 取消待处理的外部需求，保留消息记录 |
| `ui_add_workspace_region` | 打开选区编辑器，绘制矩形遮罩、填写批注并保存回工作台 |
| `ui_review_workspace` | 展示建议后采纳、拒绝或撤销；也可从历史版本继续 |
| `ui_generate_workspace` | 显示执行方式与遮罩，再生成或重绘，结果进入画布与历史 |
| `ui_capture_app` | 返回当前应用窗口的真实截图及当时状态，用于查看实际显示效果 |

前台入口复用界面原有操作逻辑，并等待界面确认完成后返回状态。每次调用返回当前 `DesktopState`；后续操作传入其 `token`，或从 `get_app_state.desktop.token` 获取最新值。界面变化、用户正在编辑、另一前台操作仍在执行时会拒绝覆盖。不要并发调用前台工具，也不要在同一轮操作中混入后台写入工具。

需要慢速演示时，为前台工具传入 `step_delay_ms: 2000`，每个可见步骤会停留约两秒，包括选区编辑器内部的绘制、批注和保存。可选范围为 0～5000 毫秒，省略时维持默认速度。

用户在软件里操作后询问 Agent，Agent 应重新调用 `get_app_state`，需要视觉信息时调用 `ui_capture_app`，而不是沿用之前的观察。截图包含当前可见的应用内弹窗、画布和输入内容，只截 NovelPrompt 窗口内容，不包含其他应用或原生系统文件选择框。隐藏或最小化时会明确返回错误；先按用户意图显示窗口，再截图。密钥输入字段在截图时隐藏，随后恢复。

`ui_capture_app` 返回 MCP 图片和结构化元数据：`capturedAt`、原始/输出像素尺寸、界面 CSS 尺寸、`desktop` 状态、`beforeToken`、`stateChangedDuringCapture`。最长边默认 1600，可用 `max_edge` 调整为 512～2560；不会放大原图。状态变化标记只反映结构化状态，不保证动画、滚动等像素内容完全静止，也不是录像或操作历史。前台 AI 执行期间仍可截图。截图按需返回，不会随每次状态通知自动传输；通知是否触发 Agent 读取仍由客户端决定。截图工具不使用 `step_delay_ms`。

窗口显示「Agent 前台」状态和停止入口。取消讨论会中止 AI 请求；生图会等待当前图片保存后停止，已完成结果保留。短操作通过状态步骤展示，AI 与生成延迟取决于对应服务。状态查询和订阅在执行期间仍可使用。停止或报错后先读取状态，再决定下一步，避免重复创建或生成。

两种模式的生成均受「允许生图」权限约束。内置模式提交讨论受「允许调用 AI」权限约束；外部接管模式只保存需求，不调用内置模型，不要求 DeepSeek Key。填写、查看、绘制批注不调用 AI。前台生成仍需用户授权、`confirm: true` 和免费条件检查。

当前前台覆盖 AI 工作台及其区域重绘。选区支持一个区域内多个矩形，不支持任意笔刷轨迹或所有弹窗自动化；其他页面保留已有导航与共享提示词接口。前台与后台工具可同时安装，由 Agent 按用户要求选择，不需要全局模式开关。

开发验证：`npm run desktop:smoke` 使用真实 stdio 代理及真实渲染界面验证两种模式、前台操作工具、外部 Agent 接管与回复、窗口截图与敏感字段遮盖、冲突保护、权限、取消以及重绘遮罩外像素保留；AI 和图片接口使用模拟数据。`npm run mcp:host-smoke` 验证真实应用冷启动、共享主进程和断线恢复。两者使用临时用户目录，不修改日常数据。


## Agent 如何发现能力并选择执行方式

接入后无需给每个 Agent 手动安装一份操作 Skill。服务端在 MCP 初始化的 `instructions` 中提供简短入口，要求首次读取 `agent_guide`；只展示工具列表的客户端也能从该工具描述找到入口。

- `agent_guide(topic: "overview")`：默认入口，按用户意图选择前台/后台和外部/内置处理者。
- `capabilities`：能力地图、工具组和调用内置 AI 的边界。
- `workflows`：前台外部接管、后台处理、内置 AI 委托、状态及历史读取的操作顺序。
- `recovery`：冲突、断线、过期需求、取消、重试和权限。
- `limits`：暂不支持的行为、视觉验证与交付要求。
- `all`：完整指南，也可通过 MCP 资源 `novelprompt://guide/agent` 读取。

例如“查一下这些标签”默认走后台；“在软件里一步步演示你修改这张图”走前台，并由外部 Agent 自己分析；“演示软件内置 AI”才选择内置处理者。前台流程可以穿插后台只读查询，不能用后台写入后刷新冒充可视化步骤。已有明确授权的步骤不重复询问；只要求建议时不自动采纳或生图。

操作指南与用户提示词 Skill 分开：前者说明软件能做什么、如何调用；`prompt_guide` / `inpaint_guide` 或工作台冻结 Skill 说明如何处理具体提示词。操作指南随应用版本更新；各章节与完整资源共用同一份内容和指纹，避免副本分歧。指南源文件为 [agent-guide.ts](../src/main/adapters/mcp/agent-guide.ts)。

服务端提供入口并不保证所有客户端一定阅读或遵守。升级后需要重连 MCP，并在 `tools/list` 中确认出现 `agent_guide`；旧宿主仍运行旧代码时还需重启应用宿主。指南不会让客户端自动唤醒模型，也不会补出尚未实现的后台接口。

## 外部 Agent 接管工作台

处理者（内置 AI / 外部 Agent）和执行方式（前台 / 后台）是独立选择。第一阶段由当前外部 Agent 主动读取并回复；在应用里点击发送不会自动唤醒 Codex，也没有启动另一个 Codex 会话或 App Server。

前台流程：

1. `ui_open_workspace` / `ui_create_workspace`。
2. `ui_set_workspace_agent(mode: "external")`：绑定当前实际 MCP 连接，右侧显示连接来源。每个会话只有一个接管者；另一个在线 Agent 不能抢占。用户可在界面切回内置 AI 解除接管。
3. `ui_set_workspace_input` → `ui_send_workspace_message`：保存用户需求、选区、引用版本以及启用 Skill 的正文和摘要哈希；不调用内置 AI。
4. `get_workspace_context`：读取待处理请求及本轮 Skill、提示词、参数、图片、引用、区域预览路径。按需 `read_image` 和 `get_workspace` 获取画面与完整历史。`request.stale=true` 表示用户已改变任务上下文，应取消旧需求并重新发送。
5. Agent 自行查询 tag、分析和组织方案；`ui_reply_workspace_request(response)` 把回复放入右侧对话，并显示可选修改建议。`response.requestId` 必须对应待处理用户消息；普通讨论只需 `requestId` 和 `reply`。可选 `understanding` 记录用户明确的目标与保留项；可选 `proposal` 包含 `title`、`warning`、完整 `draft` 及 `execution`（`kind: generate|inpaint`、`regionId`）。
6. `ui_review_workspace` 采纳 / 拒绝 / 撤销；经用户授权后 `ui_generate_workspace`。方案写入不会自动采纳或生图。

后台对应接口为 `set_workspace_agent`、`reply_workspace_request` 和 `cancel_workspace_request`，使用工作区 `revision`；前台取消用 `ui_cancel_workspace_request`。取消保留原消息，重复或迟到的回复会被拒绝。发送后编辑提示词、切换版本或修改选区会使原请求过期；只修改未发送输入不会改变任务上下文，但提交回复仍须重新读取最新状态。

连接断开后保留外部模式和待处理消息，界面显示断开 / 等待状态，不回退 DeepSeek。重新连接必须显式接管后继续。来源名称来自 MCP 初始化信息，是客户端声明的显示名称；连接标识用于区分会话所有者，不代表身份认证。

新记录保留每条方案的完整 before / after / 差异与处理状态；同版本的新建议使旧建议成为历史，旧的待采纳方案不可再次采纳。右侧点击某条方案会打开当时那条方案，建议页也可切换历史记录。旧版本已经删掉的方案正文无法恢复，仍显示旧版摘要。MCP 会话结果省略大遮罩和内部校验字段；完整本轮 Skill 从 `get_workspace_context` 读取。


## 项目维护、状态和增量读取

- 后台 `update_workspace` 修改名称/目标或下一版配置；配置使用 `patch` 和已采用候选的 `version_id`，冻结的图片生成记录保持不变。
- `update_workspace_region` 修改或删除已有区域。`delete_workspace_image` 删除指定候选的图片，`delete_workspace` 归档项目并清理图片，`delete_image` 仅删除未被项目引用的图库图片。删除必须取得用户授权并传 `confirm:true`，项目操作还必须传最新 `revision`。
- 前台有 `ui_rename_workspace`、`ui_delete_workspace_image`、`ui_delete_workspace`，会在真实窗口定位目标、展示操作并执行。同一清理服务保留共享图片，独占图片和对应生成文件移入回收站。
- 外部连接不会自动唤醒模型。处理前调用 `report_workspace_progress` 报告 `processing`，可附简短进度，120 秒内续报；`waiting` 结束处理状态。断线或进度过期自动回到等待，不能用“已连接”推断模型正在执行。
- `get_workspace_context` 默认 `skills_task:overview`：首次只发总则正文和冻结目录；按任务选择 `prompt`（编写提示词）、`preview`（画面分析）、`inpaint`（重绘及提示词规则）或 `all`，也可用 `skills_ids` 补读目录中的指定篇目。具体任务自动包含 `scope=all` 用户规则。`missingRequiredIds` 为空且正文实际保留在 Agent 当前上下文中，才表示已具备本轮必读规则。
- 每篇正文有独立指纹。`sections` 仅返回所选篇目中未读或变化的正文；`manifest` 始终携带名称、说明、范围、优先级、长度和指纹。重排不重复发正文，禁用/删除通过最新目录及 `removedIds` 表达。`bodiesNotModified` 不代表目录没变化，仍需检查 `manifestChanged`。设置修改不改变当前待处理需求已经冻结的内容，只影响新需求。
- `skills_digests` 是客户端实际保留的正文指纹表 `{id:digest}`，提供后取代连接缓存判断。只能从实际读取的 `sections` 建立，不能把整个目录当成已读。`skills_mode:metadata` 只读目录、不记为已读；`full` 强制重读所选篇目（全部正文需配合 `skills_task:all`）。上下文压缩或回复丢失后用此方式恢复。每个连接独立缓存，不能将另一个 Agent 的读取视为自己已读。
- `rules_only:true` 只返回项目、请求标识、模型和规则，省略图片/参数/候选；先读完整任务上下文，再按需补读正文。返回 `requestId` 改变时须重新读取任务上下文。冻结文件保存一份原文及分段索引，不复制多份正文；没有索引的已保存冻结文档保持原文完整读取，不推测分界或拿今天的设置替换。
- `get_workspace` 默认返回最近 10 个候选摘要和最近 5 条消息摘要，每条正文最多 400 字符并标记 `textTruncated`。`detail:full` 返回完整内容（仍分页），`message_ids` / `version_ids` 可精确取得特定消息/候选的全文；精确读取返回 `partial:true`，不夹带无关历史或其他候选。后台修改接口也返回摘要，避免每次写入重发历史。
- 候选通过 `version_limit`（默认 10、最多 100）、`before_version_id` 分页；`get_workspace` 返回 `versionsPage`，`get_workspace_context` 返回 `candidatesPage`。游标是 `nextBeforeVersionId`，翻页带 `history_revision`。当前蓝本 id 和任务当前稿始终单独返回，候选页只描述该页；上下文中的 `groups` 也仅列本页 id，用 `partial/totalCandidates` 标记未读部分。
- 历史页使用 `message_limit`（1～100）、`before_message_id`，翻页必须附上一页的 `history.revision` 作为 `history_revision`；变化时拒绝混合分页。默认摘要省略方案前后稿、历史生成参数和规则正文，原始项目文件保持完整。
- `since_revision` 比较本连接最近缓存的对应 `detail` 快照。未变返回 `notModified`；变化返回 `delta:true`、新增/变更的消息和候选，以及删除 id 列表。旧消息的采纳/撤销、旧候选配置变化也会被发现。按 id 合并，摘要/全文分别缓存；增量需要翻页时保持原 `since_revision`，携带当前 `history_revision`，读完消息与候选两类增量的所有页后再推进本地版本。单独翻页时另一列表不重复返回，分页信息的 `included:false` 表示未读取，不能理解为空集合。重新连接、首次请求某种 detail 或基线超过最近 32 个快照时，返回 `resetRequired:true` 和当前分页快照，须重建缓存。切勿把分页/局部详情中缺失的条目当成删除。
- `list_images` 支持 `storage`、`query`、`limit`、`before_name`，返回 `items/hasMore/nextBeforeName`。

`npm run mcp:context-smoke` 使用独立临时数据验证规则目录与任务选篇、按篇变化、禁用/重排、强制补读、冻结快照、缓存隔离、摘要/详情、历史/候选分页、旧消息与候选更新及增量恢复。加 `-- --measure-dev` 可只读测量开发目录的现有项目返回大小；不迁移、不保存真实项目。字符数按单份业务 JSON 统计，不代表特定客户端实际计入模型的 token 数。
- 工具保留文本内容并返回对象形式的 `structuredContent`。普通文本报告在 `text` 字段，列表在 `items`。参数错误、权限关闭和执行错误提供 `error.code/message/retryable/nextAction`。取消任务的 `cancellation` 明确区分受理、正在停止、已结束与不存在。

这些接口不涉及收藏或配置收藏的设计变更。旧宿主须重新启动、MCP 客户端须重新连接才能读取更新后的工具清单。

## 按任务精简工具列表

`configure_tools()` 返回分组清单、组内工具名和当前选中组。传 `groups` 替换本连接的可见组：

- 查词：`["tags", "skills"]`。
- 后台工作台：`["workspace", "images", "skills"]`。
- 前台工作台：`["frontend", "workspace", "images", "skills"]`。
- 需要委托内置 AI 时增加 `"ai"`。

设置页的「接入范围」会写入代理环境变量 `NOVELPROMPT_MCP_GROUPS`。首次 `tools/list` 直接列出所选范围，适用于不会动态刷新工具的客户端：`all` 为全部功能；`workspace,frontend,images,skills,tags` 为工作台创作；`workspace,images,skills,tags` 为后台创作；`tags,skills` 为标签与提示词。设置页默认选择全部功能，改选后复制新配置并重连。范围越小，初始工具说明越少。

未设置此变量或设为 `core` 时只展示 6 个核心入口，适合支持动态刷新的客户端。Agent 可调用 `configure_tools(groups)`，再刷新 `tools/list`；`groups:[]` 回到核心。分组只影响本连接的工具发现，不改变权限或其他连接。变量中的错误组名会明确报错，不静默降级。初始范围经本地连接握手传递，不依赖哪个代理先启动共享宿主。

## 连接恢复与编辑接续

代理在应用断线后保持 stdio 通道，自动尝试重连，恢复协议初始化、成功选定的工具组和状态订阅。不会重放生图、删除、发送、采纳或其他业务请求。已发送却未收到结果的请求返回 `OUTCOME_UNKNOWN` 和原操作编号；恢复期间的新请求返回 `NOT_SENT`，不会排队执行。每轮连接尝试最多 30 秒，失败后下一个请求触发再次连接，该请求本身仍不执行。

恢复后先调用 `get_app_state`，后台会话可传 `workspace_id`。`connection` 包含新连接身份、工作台接管归属、配置编辑归属和建议步骤。应用操作结果先按原编号查询 `get_operation`；接管使用最新 revision，其他在线 Agent 的工作台不能抢占。

如果只是 Agent 断线、应用窗口仍在，尚未保存的配置草稿会保留。`connection.workspace.editor.canResume:true` 时，核对 `desktop.workspace.config` 后可调用 `ui_edit_workspace_config(config_action:resume)` 接续草稿，再明确保存或取消。接续不会改变内容、保存或生成；用户手动编辑和其他在线 Agent 的编辑不可接续。主进程退出后的未保存表单不保证保留。

`connection.workspace.execution.sourceVersionId` 是接下来生成或重绘的蓝本，`viewedVersionId` 是当前查看对象，两者可能不同。

## 超时后查询结果，避免重复执行

写入、前台操作和内置 AI 调用支持可选的 `operation_id`。每个新意图在第一次调用前生成一个 UUID；超时、断线后先调用 `get_operation(operation_id)`。不传编号时程序会自动生成，并放在 `structuredContent.operation.id`；回复丢失时也可用 `get_operation()` 查看最近 20 条，但预先指定编号更可靠。进度心跳和工具分组切换不写入操作记录。

- `running`：仍在执行，继续查询，不重复提交。
- `succeeded`：工具已返回结果。它不是对图片质量、业务目标或整批生成完成度的保证，需要读取结果和当前状态。
- `failed`：工具报错，可能已有部分成果；先核对状态。
- `interrupted`：连接取消或软件退出使结果不确定。不得推断操作已回滚，先核对工作台、图库和任务。

同编号、同工具和相同参数再次调用只返回原结果/进度，不再次执行。同编号换参数或换工具会返回 `OPERATION_ID_CONFLICT`。失败和中断也不会自动重试；检查后确定需要新的操作时，使用最新 token/revision 和新编号。重复调用返回的是历史证据，不会重新接管工作台、续租或恢复编辑器；断线后继续操作仍须遵守原有接管规则。

记录与当前应用的数据目录绑定，跨 MCP 连接和软件重启可读。保留期为 7 天，最多 10000 条；单份结果超过 64 KiB 或结果缓存累计超过 8 MiB 时只保留执行摘要，不因此允许重放。结果中的 `resultOmitted` 表示需再读取对应业务对象。记录只保存参数指纹，不保存原始参数；结果保存在本地。查不到记录不保证操作从未执行，需确认是否连接错环境或记录已过期。文件无法读取或无法保存操作开始记录时，会在执行前拒绝写入，避免失去重复保护。

`npm run mcp:recovery-smoke` 验证分组隔离、并发去重、失败/取消、断线、记录损坏和大结果；`npm run mcp:host-smoke` 进一步验证真实宿主退出后恢复结果与重复调用不会再次创建项目。测试使用独立临时数据，不访问真实 AI/生图服务。


## 已有区域的前台操作

`ui_update_workspace_region` 和 `ui_delete_workspace_region` 与创建选区一样使用真实编辑器，逐步展示定位、遮罩与批注。操作前读取最新 `desktop.token`，传工作台 `id`、已采用候选 `version_id` 和已有 `region_id`；外部模式只允许当前接管连接写入。

修改时只传需要改变的 `instruction`、`target`、`rectangles`。只改批注或角色不改变遮罩；`rectangles` 会整体替换该区域遮罩，保留区域编号与其他区域。删除需 `confirm:true`，只删除该选区和批注，不删原图。展示过程中取消不会触发自动保存；保存完成后再停止不能推断已回滚，应重新读取状态。

## 工具返回字段

69 个工具均声明各自的 `outputSchema`，包括工作台摘要/完整读取/增量/未变化回执、规则目录与正文、前台状态、图库、任务与操作记录。文本报告仍是 `{text}`，列表仍是 `{items}`，并保留原有文本内容。

服务端在返回前验证字段。若出现 `OUTPUT_CONTRACT_VIOLATION`，`observedResult` 保留原始结果，`retryable:false`；操作可能已经写入，先读实际状态或 `get_operation`，不要自动重试。同一操作编号只回放已记录结果，不重复执行。

## 开发版启动时缺少构建文件

项目刚检出或构建尚未结束时，先运行 `npm run build`，完成后再启动或连接 MCP；开发调试使用 `npm run dev`。MCP 冷启动会检查主程序、预加载与页面文件，构建未齐时在连接期限内等待，不启动缺少入口的 Electron。超时会说明需要构建。重新构建主进程时保留原入口，避免清空目录造成短暂缺失。已运行宿主仍需完整退出后重开才能加载新主进程代码。

`npm run mcp:launch-smoke` 检查文件缺失、构建中、已有宿主和安装版启动路径；前台回归还覆盖区域修改/删除、错误目标与超过自动保存间隔的取消。所有这些回归使用临时数据或模拟环境，不触碰真实项目。

### 工作台多区域讨论与重绘

`ui_set_workspace_input`、`submit_workspace_request` 使用 `region_ids` 数组选择本轮区域，省略时不附加区域；原 `region_id` 仍用于单区。`get_workspace_context` 的 `request.regionIds` 与 `selectedRegions` 给出本轮范围、批注和各区预览，`regions` 是全部可用区域。

方案继续返回一份完整 `draft`；重绘时传 `execution: { kind: "inpaint", regionId: "首个区域 id", regionIds: ["区域 id", "另一区域 id"] }`，必须包含本轮选中的全部区域，不能加入未勾选项。统一强度与草稿作用于遮罩并集。采纳与执行仍是独立动作；`ui_generate_workspace` 和 `generate_workspace` 都支持 `region_ids`。仅绘制或附加批注不会自动触发生图。
