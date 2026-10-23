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
