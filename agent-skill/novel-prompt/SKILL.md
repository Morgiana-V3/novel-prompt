---
name: novel-prompt
description: 编写、检查、优化 NovelAI（V4.5 / V5）提示词并出图验证。当用户要写 NovelAI / NAI 提示词、把中文画面描述转成 Danbooru tag、检查 tag 是否存在或写法是否标准、拆分多角色提示词、推测提示词效果、用 NovelAI 生成图片，或要求安装 / 配置 NovelPrompt 时使用。依赖 novel-prompt MCP 服务（NovelPrompt 桌面软件提供），本文档包含安装步骤。
---

# NovelPrompt：NovelAI 提示词工作流

本文档写给 agent 阅读，分两部分：

- **安装** — 当前环境里还没有 `novel-prompt` 的 MCP 工具（如 `analyze_prompt`）时，按这一节把软件装好并接入
- **使用** — 工具可用后，按这一节的规则和工作流帮用户写提示词、出图

`novel-prompt` MCP 服务由 NovelPrompt 桌面软件提供：本地 Danbooru tag 库（约 33 万 tag，含别名、包含关系、中文翻译）、Danbooru 共现统计与 wiki 释义、NovelAI 提示词规范，以及 NovelAI 文生图。

---

# 第一部分：安装

先确认是否真的需要安装：工具列表里已经有 `prompt_guide`、`analyze_prompt` 等工具，就直接跳到[第二部分](#第二部分使用)。

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

用软件自带的安装脚本写入配置。它以 Node 模式运行 NovelPrompt.exe 本身，不需要另装 Node；路径全部取自实际安装位置；写入前把原配置备份为 `.bak`，只改 `novel-prompt` 这一项。

```powershell
$env:ELECTRON_RUN_AS_NODE = '1'
& $exe (Join-Path (Split-Path $exe) 'resources\agent-setup.cjs') install codex | Out-String
Remove-Item Env:ELECTRON_RUN_AS_NODE
```

把 `codex` 换成当前 agent 对应的目标：

| 目标 | 写入内容 |
|---|---|
| `codex` | `~/.codex/config.toml` 的 `[mcp_servers.novel-prompt]`，以及 `~/.codex/skills/novel-prompt/SKILL.md` |
| `claude` | `~/.claude.json` 的 `mcpServers.novel-prompt`（用户级），以及 `~/.claude/skills/novel-prompt/SKILL.md` |
| `all` | 以上全部 |

- `| Out-String` 不能省：NovelPrompt.exe 是窗口程序，不接管道 PowerShell 不会等它结束，也拿不到输出。
- 输出是一行 JSON：`ok` 为 `true` 即成功；`results` 是每一项的结果；`items` 是各项当前状态（`ok` / `none` / `stale`）。
- 把 `install codex` 换成 `status` 只查看状态，不写任何文件。

**其他 agent**（Cursor、Cline、Windsurf 等）：运行 `status`，把输出里 `launch` 的 `command` / `args` / `env` 按该 agent 的格式写进它的 MCP 配置，服务名用 `novel-prompt`，传输方式为 stdio。Skill 文件就是输出里 `skillSource` 指向的这份文档，按该 agent 的方式引用即可。

## 4. 生效与验证

1. 告诉用户**完全重启 agent**（MCP 配置和 Skill 只在启动时加载）。
2. 重启后调用 `prompt_guide`，能返回规范文档即接入成功。
3. 失败时依次检查：`status` 里各项是否为 `ok`；是否用了便携版；用户是否移动过安装目录（移动后重新执行第 3 步）。

## 5. 可选：告诉用户还可以配置什么

以下设置都在 NovelPrompt 窗口的「设置 / 数据」页，**请用户自己在界面里填写，不要直接编辑 `settings.json`，也不要让用户把 Token 发给你**：

| 设置 | 用途 |
|---|---|
| NovelAI Persistent API Token | `nai_subscription`、`generate_image` 需要 |
| Agent 接入 →「允许生图」 | 开启后才能调用 `generate_image`（默认关闭） |
| DeepSeek API Key + 「允许调用 DeepSeek」 | `optimize_prompt` / `preview_prompt` 需要；你本身就是大模型，一般不需要 |

不填这些也能使用除生图以外的全部检查和查询工具。

## 从源码运行（开发者）

用户明确要用源码时才走这条路：

```powershell
git clone https://github.com/Morgiana-V3/novel-prompt.git; cd novel-prompt
npm install; npm run build
$env:ELECTRON_RUN_AS_NODE = '1'
& .\node_modules\electron\dist\electron.exe scripts\agent-setup.cjs install codex | Out-String
Remove-Item Env:ELECTRON_RUN_AS_NODE
```

此时 MCP 指向项目目录，改代码后要重新 `npm run build`。

---

# 第二部分：使用

如果工具列表里没有 `novel-prompt` 的工具，回到[第一部分](#第一部分安装)。

## 核心规则

1. **tag 不能编造**。除 NAI 专用质量词（`masterpiece`、`very aesthetic`、`no text` 等）和英文自然语言句子外，每个 tag 都必须来自 `search_tags` / `validate_tags` 的结果。写完一定用 `analyze_prompt` 复查。
2. **以数据为依据**。NovelAI 用 Danbooru 训练，Danbooru 的统计就是模型学到的东西：
   - 引用数高的 tag 效果稳定，低于 50 张图的 tag 效果很弱。
   - 包含关系：`white thighhighs` 已经包含 `thighhighs`，后者冗余。
   - 角色默认外观：用 `related_tags` 查角色，和默认一致的特征不用重复写；要改默认特征（如换发色）时给新特征加权，并在负面排除默认特征。
   - 画师倾向：用 `related_tags` 查画师常见元素，判断会把画面带向哪里。
   - 近义词拿不准：用 `tag_wiki` 读释义再选。
3. **审美偏好不擅自改**。用户指定的角色、画师、服装、负面里刻意排除的元素必须保留；加画师、换风格这类建议只作为可选项告诉用户。
4. **第一次使用先调用 `prompt_guide`** 读一遍完整规范（语法、顺序、多角色、UC 预设冲突表），之后不必重复读。

## 工具

| 工具 | 用途 | 关键参数 |
|---|---|---|
| `prompt_guide` | 提示词编排规范全文 | 无 |
| `search_tags` | 按中文 / 英文概念找候选 tag，按热度排序 | `queries: string[]`，`category`: any / general / artist / copyright / character / meta |
| `validate_tags` | 校验 tag：存在 / 别名（给标准写法）/ 不存在（给候选） | `tags: string[]` |
| `related_tags` | Danbooru 共现统计：角色默认外观、画师倾向（联网，≤6 个） | `tags: string[]`，画师不带 `artist:` 前缀 |
| `tag_wiki` | Danbooru 释义（联网，≤8 个） | `tags: string[]` |
| `analyze_prompt` | **整套检查**：逐 tag 存在性 / 别名 / 分类 / 引用数 / 实际权重；正负面冲突（含 UC 预设）、包含关系冗余、权重过高、与角色默认外观冲突，并附带角色和画师的统计数据 | `base`、`characters`、`negative`、`version`、`width`、`height`、`quality_tags`、`uc_preset` |
| `nai_subscription` | NovelAI 会员、Anlas、V5 免费额度 | `version` |
| `generate_image` | NovelAI 文生图，只用免费额度，返回本地 PNG 路径 | 同 `analyze_prompt`，另有 `steps`、`seed`、`count`(1~4)、**`confirm: true`（必填）** |
| `list_images` | 本机图库最近的图片 | `limit` |
| `read_image_prompt` | 读取 NovelAI PNG 里保存的提示词 | `name`（图库文件名）或 `path`（绝对路径） |
| `optimize_prompt` / `preview_prompt` | 软件内置的 DeepSeek 优化 / 画面推测 | 默认关闭；一般由你自己根据数据推理即可 |

`characters` 的格式：`[{ "prompt": "girl, ...", "negative": "...", "position": "B3" }]`。

## 工作流

### A. 中文描述 → 整套提示词

1. 数清画面里**需要区分外貌**的人物数量：
   - 1 人：全部写进 `base`，`characters` 留空。
   - ≥2 人：`base` 只写人数（`2girls` / `1girl, 1boy`）、画师画风、构图镜头、背景、光影、质量词；每个人的外貌服装写进各自的 `characters[i].prompt`，避免串色。
2. 把描述拆成概念，一次性 `search_tags`（中文搜不到就换英文同义词）。角色、作品、画师用 `category` 限定。
3. 出现具体角色或画师时，`related_tags` 查默认外观 / 倾向。
4. 按顺序编排：
   - 主提示词：人数 → 角色/作品 → 画师 → 画风 → 构图镜头 → 场景 → 光影 → 质量词
   - 角色提示词：`girl` / `boy` / `other`（不加数字）→ 角色名 → 外貌 → 服装 → 表情 → 动作
   - 互动：在发起方写 `source#hug`，承受方写 `target#hug`，双方都做写 `mutual#holding hands`
5. 位置：V4.5 用 5×5 网格 `A1`~`E5`（列 A→E 左到右，行 1→5 上到下，`C3` 为中心）；也可以写 `0.3,0.5` 归一化坐标。没有交代时按出场顺序从左到右。
6. 防串色：两个角色有容易混的特征（发色、瞳色、眼镜、兽耳、服装颜色），在**对方**的角色负面里排除。
7. 负面：基础质量词 + 按画面风格增删。不要排除画面需要的东西（漫画风不要排除 `screentone`、`halftone`、`monochrome`）。
8. `analyze_prompt` 复查，修到没有「不存在 / 别名 / 冲突」为止。

### B. 检查 / 优化现有提示词

1. `analyze_prompt` 传入完整内容（主提示词、角色、负面、版本、参数）。
2. 按报告修正：不存在 → 用候选替换；别名 → 标准写法；冗余 → 删除被包含的；冲突 → 删掉一侧；与角色默认外观冲突 → 加权 + 负面排除默认特征，或提醒用户。
3. 再次 `analyze_prompt` 确认。
4. 向用户逐条说明改动，每条注明依据：规则 / 数据（引用具体数据）/ 文档 / 审美（仅建议）。

### C. 出图验证

1. 先 `nai_subscription` 确认免费额度可用。免费条件：Opus 会员、总像素 ≤ 1024×1024、步数 ≤ 28、每次请求 1 张。
2. `generate_image`，**必须传 `confirm: true`**。默认 832×1216、23 步。需要对比改词效果时固定 `seed`。
3. 把返回的图片路径告诉用户；能看图的话打开图片对照描述检查。
4. 返回 `stopped` 不为空时（额度不足、检测到扣费、未开启生图权限），停止并如实告诉用户，不要换参数绕过。

## 语法速查

| 写法 | 含义 |
|---|---|
| `{tag}` / `[tag]` | ×1.05 / ÷1.05，可叠加 |
| `1.3::tag, tag2::` | 数值权重，可包住多个 tag；常用 0.5~1.5，超过 2 容易画崩 |
| `-1::tag::` | 负权重，从画面里主动去掉某概念 |
| `artist:name` | 画师 tag |
| `Text: ...` | 画面文字，放在主提示词最末尾；Add Quality Tags 开启时会追加 `no text`，需要文字时提醒用户关掉 |
| `source#` / `target#` / `mutual#` | 角色互动 |
| `long hair` = `long_hair` | 下划线和空格等价 |

## 交给用户的格式

最后用分节文本输出，用户可以直接粘贴进 NovelPrompt（会自动拆分到各个输入框）或照着填进 NovelAI：

```
[Prompt]
2girls, artist:xxx, outdoors, cherry blossoms, ...

[Character 1 @ B3]
girl, silver hair, red eyes, white dress, smile

[Character 1 Undesired Content]
black hair, glasses

[Character 2 @ D3]
girl, black hair, short hair, glasses, school uniform

[Undesired Content]
lowres, worst quality, bad quality, ...
```

另附：模型版本、建议画幅、Add Quality Tags 和 UC 预设是否开启。
