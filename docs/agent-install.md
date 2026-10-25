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
| `env` | `{ "ELECTRON_RUN_AS_NODE": "1" }` |

- 路径用第 1 / 2 步得到的实际路径，不要猜默认位置。
- 写入前先把原配置文件备份为 `.bak`，只新增或覆盖 `novel-prompt` 这一项，其他内容不要动。
- 旧版本曾在 `~/.codex/skills/novel-prompt`、`~/.claude/skills/novel-prompt` 安装过 Skill，存在的话征得用户同意后删除，以免读到过期规则。

Codex（`~/.codex/config.toml`）示例：

```toml
[mcp_servers.novel-prompt]
command = 'C:\Users\你\AppData\Local\Programs\NovelPrompt\NovelPrompt.exe'
args = ['C:\Users\你\AppData\Local\Programs\NovelPrompt\resources\mcp-proxy.cjs']
env = { ELECTRON_RUN_AS_NODE = '1' }
```

Claude Code（`~/.claude.json` 的 `mcpServers`）、Cursor 等 JSON 格式：

```json
{
  "mcpServers": {
    "novel-prompt": {
      "command": "C:\\Users\\你\\AppData\\Local\\Programs\\NovelPrompt\\NovelPrompt.exe",
      "args": ["C:\\Users\\你\\AppData\\Local\\Programs\\NovelPrompt\\resources\\mcp-proxy.cjs"],
      "env": { "ELECTRON_RUN_AS_NODE": "1" }
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

原有工具与调用方式保持兼容。适合查词、检查提示词、生成图片，或由外部 Agent 自己整理建议，再同步到工作台。界面可以显示最终结果，但不代表走过前台每一步操作。

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

操作指南与用户提示词 Skill 分开：前者说明软件能做什么、如何调用；`prompt_guide` / `inpaint_guide` 或工作台冻结 Skill 说明如何处理具体提示词。操作指南随应用版本更新；各章节与完整资源共用同一份内容和指纹，避免副本分歧。指南源文件为 [agent-guide.ts](../src/main/mcp/agent-guide.ts)。

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
