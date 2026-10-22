<div align="center">
  <img src="build/icon.png" width="96" alt="NovelPrompt" />
  <h1>NovelPrompt</h1>
  <p>写 NovelAI 提示词时，帮你把每一个 tag 都核对清楚，再直接出图看效果。</p>
  <p>
    <img alt="platform" src="https://img.shields.io/badge/platform-Windows%2010%2F11-0078D6?style=flat-square" />
    <img alt="electron" src="https://img.shields.io/badge/Electron%20%2B%20Vue3-2F3241?style=flat-square" />
    <img alt="mcp" src="https://img.shields.io/badge/MCP-Codex%20%2F%20Claude%20Code-FF6B9A?style=flat-square" />
    <img alt="license" src="https://img.shields.io/badge/license-MIT-3DA639?style=flat-square" />
  </p>
</div>

---

NovelPrompt 是一个 NovelAI 出图用的桌面工具。它把 Danbooru 的 **33 万个 tag**、**别名**、**3 万多条包含关系**和 **5 万多条中文翻译**打包在本地，粘贴一段提示词进去，立刻告诉你哪些 tag 是真的、哪些拼错了、哪些是别名、哪些重复了。在此基础上：

- 用 **DeepSeek** 优化提示词、把中文画面描述拆成整套提示词、推测提示词会画成什么样
- 用 **NovelAI 接口**直接出图验证（默认只用免费额度）
- 通过 **MCP** 让 Codex、Claude Code 等 agent 直接调用上面这些能力

比对和搜索完全离线。AI 优化 / 画面推测（DeepSeek）、Danbooru 共现统计、生图（NovelAI）需要联网。

## 目录

- [功能](#功能)
  - [当前提示词](#当前提示词)
  - [提示词比对](#提示词比对)
  - [AI 优化](#ai-优化)
  - [画面推测](#画面推测)
  - [生图预览](#生图预览)
  - [Tag 搜索](#tag-搜索)
  - [评判依据](#评判依据)
  - [Agent 接入（MCP）](#agent-接入mcp)
  - [V4.5 / V5 双版本](#v45--v5-双版本)
- [快速开始](#快速开始)
- [使用指南](#使用指南)
- [支持的语法](#支持的语法)
- [数据说明](#数据说明)
- [常见问题](#常见问题)
- [开发者](#开发者)
- [致谢](#致谢)
- [许可证](#许可证)

## 功能

### 当前提示词

主提示词、角色提示词（含位置和角色负面）、负面提示词，以及画幅 / Add Quality Tags / UC 预设，在整个软件里只有**一份**，自动保存，重启也在。比对、AI 优化、画面推测、生图四个页面编辑和使用的都是它，不需要在页面之间来回搬运。

每个页面顶部都有「当前提示词」工具条：

- **导入** — 点「粘贴」从剪贴板导入；在主提示词里直接粘贴整套分节文本也会自动拆分；把 NovelAI 原图拖进窗口任意位置，读取图里保存的提示词。支持 `[Prompt]` / `[Character 1 @ B3]` / `[Character 1 Undesired Content]` / `[Undesired Content]` 分节文本、`## 负面`、`UC:` 这类写法，以及 NAI 元数据 JSON
- **历史版本** — 导入、采用 AI 结果、清空、恢复之前都会自动存一份（最多 30 条），可以撤销上一次，或恢复到任意版本
- **复制全部** — 导出为分节文本，和导入格式互通

侧栏按工作流排列：比对 → AI 优化 → 画面推测 → 生图预览，下面是 Tag 搜索和设置两个工具页。

### 提示词比对

左边输入，右边实时拆成四组。上方可以切换检查主提示词、每个角色、角色负面或全局负面：

- **不存在的 tag** — 红色标出，用编辑距离给出候选，点一下就替换，也可以全部移除
- **别名 / 非标准写法** — 例如 `twin tails` 会提示改成 `twintails`，可以一键全部修正
- **有效 tag** — 中英双语、分类、引用数、实际权重，双击中文可以改成你习惯的译名
- **自然语言 / 文字** — V5 允许的英文句子、`Text:` 块会被单独列出，不会误报

点右边任意一条结果，左边会选中对应的原文。整理格式、复制、清空、跳转 AI 优化在输入框下方，替换、移除、整理都可以 `Ctrl+Z` 撤销。

<p align="center">
  <img src="docs/screenshots/compare.png" width="900" alt="提示词比对：左侧输入提示词，右侧按不存在的 tag、别名、有效 tag、自然语言分组列出结果" />
</p>

### AI 优化

两种模式：

- **优化现有提示词** — 修正拼写和别名、删掉冲突和冗余、按规范顺序重排、补上缺失的关键 tag。正向、角色、负面作为一整套评估：检查主提示词和角色的分工、人数 tag 与角色数是否一致、位置写法、防串色，以及正负面有没有互相抵消（比如黑白漫画风却在负面留着 `screentone`）
- **描述转提示词** — 用中文描述画面，AI 拆成概念后到本地库里挑真实存在的 tag。多人画面会自动拆分：共享的画风、构图、背景放主提示词，每个人的外貌、服装、动作拆成角色提示词并排好位置（V4.5 用 A1~E5 网格），互动用 `source#` / `target#`，容易混淆的特征写进对方的角色负面防串色，最后配一套负面提示词

AI 不能凭空编造 tag：它会调用本地 tag 库检索和校验，涉及角色、画师时查 Danbooru 共现统计，近义词拿不准时读 wiki 释义；输出前由程序在本地再复查一遍，发现不存在的 tag 或角色结构问题会打回重改，最多两轮。

结果**不会直接覆盖**你的提示词：

- 每段结果下面标出改了哪些 tag（新增绿色、删除红色、改权重橙色）
- 「修改说明」按正向 / 角色 / 负面 / 可选建议分组，每条都带依据标签（见[评判依据](#评判依据)）
- 点「采用」才写入当前提示词，采用前自动存历史，可以撤销；也可以「采用并比对 / 推测画面 / 生图」一步到下一环节

<p align="center">
  <img src="docs/screenshots/ai.png" width="900" alt="AI 优化：左侧是当前提示词（主提示词、角色、负面）和要求，右侧显示优化结果、改动标注和带依据的修改说明" />
</p>

### 画面推测

让 AI 推测当前提示词实际会画出什么：

- **先查库再推测** — 每个 tag 的分类、引用数、中文、实际权重先由本地 tag 库查好；角色、画师会自动查 Danbooru 统计（角色默认外观、画师倾向）。不存在或样本太少的 tag 会被标成「效果弱」，减少瞎猜
- **考虑隐式参数** — 画幅、Add Quality Tags、UC 预设会自动追加的内容也算进去，与生图页共用同一组参数
- **本地校验** — 不经过 AI 直接查出：不存在、别名、权重过高、正负面重复（含 UC 预设）、包含关系冗余、与角色默认外观冲突
- **结果分项展示** — 画面描述、画风、构图、场景、光影、每个人物，被强调 / 被负面压制的元素，可能和预期不一样的地方；每项标置信度，点结果里的 tag 能在左边定位原文
- **对比期望** — 填上「想要的效果」，会指出差距并给出具体到 tag 的修改建议
- **过期提醒** — 推测之后改了提示词或参数，会提示结果可能已过期

推测规则写在 `skills/nai-preview.md`，可以随时修改。

<p align="center">
  <img src="docs/screenshots/preview.png" width="900" alt="画面推测：左侧是当前提示词、生成参数和想要的效果，右侧显示推测结果" />
</p>

### 生图预览

填上 NovelAI 的 Persistent API Token 后，直接调用 NovelAI 图像接口出图，验证提示词的真实效果：

- **完整参数** — 画幅、步数、Prompt Guidance、Guidance Rescale、种子、采样器、噪声调度、张数。质量词和 UC 预设由本工具显式拼进提示词，发送的就是最终内容
- **角色位置** — 填 `B3` 这类网格或 `0.3,0.5` 坐标会转换成接口的角色中心点
- **只用免费额度（默认开启）** — 生成前检查 Opus 会员、V5 免费额度、尺寸（总像素 ≤ 1024×1024）和步数（≤ 28），不满足就不提交；每张生成后分别核对订阅和购买的 Anlas，发现扣除立即停止
- **推测 vs 实际** — 用推测过的那套提示词生成的图，下方会显示推测结果，方便对照准不准
- **本机图库** — 预览、全屏（`←` `→` 切换）、下载、复制图片、固定种子重画、读回图里的提示词、送去画面推测。只做文生图，不含图生图、局部重绘等编辑功能

<p align="center">
  <img src="docs/screenshots/generate.png" width="900" alt="生图预览：左侧是提示词和生成参数，右侧是本机图库" />
</p>

### Tag 搜索

- 中文、英文、**拼音全拼和首字母** 都能搜（输入 `smw` 就能找到「双马尾」）
- 按分类筛选：通用 / 画师 / 作品 / 角色 / 元数据 / NAI 专用
- 结果按匹配度 × 引用数排序，引用数高的 tag 效果通常更稳定
- **单击加到最近编辑的输入框**（主提示词、某个角色或负面，也可以在右上角手动选），画师自动带 `artist:` 前缀；右键复制，双击中文编辑翻译

<p align="center">
  <img src="docs/screenshots/search.png" width="900" alt="Tag 搜索：中文关键词搜出多个候选 tag，带分类、引用数和中文翻译" />
</p>

### 评判依据

NAI 是用 Danbooru 的图和标签训练的，所以 AI 给建议时优先引用 Danbooru 的统计数据，而不是凭感觉。每条修改和建议都会标上依据：

| 标签 | 依据 | 例子 |
|---|---|---|
| 规则 | tag 不存在、别名、版本、语法、正负面重复、人数与角色数 | `twin tails` → `twintails` |
| 数据 | 引用数、**包含关系**、**共现统计**、wiki 释义 | `white thighhighs` 已包含 `thighhighs`；初音未来的图里 51% 是 `aqua hair`，写 `red hair` 会互相拉扯 |
| 文档 | Skill 文档里的官方 / 社区经验 | 漫画风的负面不该有 `screentone` |
| 审美 | AI 的审美判断 | 只作为可选建议，**不会直接改动你的提示词** |

- **包含关系**内置在安装包里，离线可用，用来发现冗余
- **共现统计**（角色默认外观、画师倾向）和 **wiki 释义**联网查询 Danbooru，结果缓存 30 天。没网时自动降级，并在结果里提示哪些判断只凭经验

### Agent 接入（MCP）

Codex、Claude Code、Cursor 等支持 MCP 的 agent 可以直接调用本软件。agent 会在后台以无窗口模式启动本软件，不需要手动打开。

#### 让 agent 自己装（推荐）

[`agent-skill/novel-prompt/SKILL.md`](agent-skill/novel-prompt/SKILL.md) 是专门写给外部 agent 看的文档，包含两部分：

- **安装** — 检测本机是否已安装 → 征得你同意后从 Releases 下载并静默安装 → 运行软件自带的安装脚本接入 Codex / Claude Code（其他 agent 按输出的启动配置填写）→ 重启验证
- **使用** — 工具清单与参数、核心规则（tag 不能编造、以 Danbooru 数据为依据、不擅自改审美）、三条工作流（描述转提示词 / 检查优化 / 出图验证）、多角色与防串色、交付格式

把下面这段话发给你的 agent 即可：

```text
请阅读 https://raw.githubusercontent.com/Morgiana-V3/novel-prompt/main/agent-skill/novel-prompt/SKILL.md ，
按「第一部分：安装」在我的电脑上安装并接入 NovelPrompt，完成后告诉我需要做什么来生效。
```

安装完成后这份文档也会被装成 agent 的 Skill，之后你提到 NovelAI 提示词时 agent 会自动按里面的规则使用工具。

#### 在软件里装

「设置 / 数据 → Agent 接入」：

- **一键安装** — 写入 Codex（`~/.codex/config.toml`）和 Claude Code（`~/.claude.json`）的 MCP 配置，并把 Agent Skill 装到 `~/.codex/skills/` 和 `~/.claude/skills/`。每项单独显示「未安装 / 已安装 / 需更新」，写入前备份为 `.bak`，只改 novel-prompt 这一项
- **路径跟随安装位置** — 配置里的路径取自本软件当前的安装位置，换了安装目录会显示「需更新」，重新点一次即可
- **手动配置** — 也提供 TOML / JSON 配置可以复制，其他 agent 照着填
- **权限开关与调用记录** — 会花钱的工具默认关闭；返回给 agent 的内容不会包含任何 Token

两种方式用的是同一个安装脚本（安装目录下的 `resources\agent-setup.cjs`），效果完全一样。

#### 工具

| 工具 | 作用 | 默认 |
|---|---|---|
| `prompt_guide` | 返回提示词编排规范（`skills/nai-prompt.md`） | 可用 |
| `analyze_prompt` | 整套提示词的本地检查：逐 tag 存在性 / 别名 / 引用数 / 实际权重，冲突、冗余、角色默认外观冲突，附角色和画师的统计数据 | 可用 |
| `search_tags` / `validate_tags` | 本地 tag 库搜索与校验 | 可用 |
| `related_tags` / `tag_wiki` | Danbooru 共现统计与释义（联网） | 可用 |
| `nai_subscription` / `list_images` / `read_image_prompt` | 余额、图库、读图片里的提示词 | 可用 |
| `optimize_prompt` / `preview_prompt` | 内置的 AI 优化 / 画面推测，消耗 DeepSeek 额度 | 需在设置中开启 |
| `generate_image` | NovelAI 生图，**强制只用免费额度**，每次必须传 `confirm: true` | 需在设置中开启 |

手动配置 Codex 的示例（实际路径以设置页显示的为准，默认安装位置是 `%LOCALAPPDATA%\Programs\NovelPrompt`）：

```toml
[mcp_servers.novel-prompt]
command = 'C:\Users\你\AppData\Local\Programs\NovelPrompt\NovelPrompt.exe'
args = ['C:\Users\你\AppData\Local\Programs\NovelPrompt\resources\mcp-proxy.cjs']
env = { ELECTRON_RUN_AS_NODE = '1' }
```

> 为什么要经过 `mcp-proxy.cjs`：Electron 在 Windows 启动时会往标准输出写一个空行，部分 MCP 客户端读到非 JSON 内容会报错。代理以 Node 模式运行同一个 exe，拉起 `--mcp` 模式后只转发合法的协议消息。
>
> 便携版每次运行都解压到临时目录，路径不固定，**不支持 MCP**，请用安装版。

### V4.5 / V5 双版本

侧栏可以切换目标模型，会同时影响：

- 比对时的警告（例如在 V4.5 下用了 V5 专用 tag、或用了 V4.5 不认的引号文字）
- AI 的编排规则（多角色位置写法、自然语言混写比例、质量词、各版本专属 tag）
- 推测和生图时自动追加的质量词与 UC 预设、生图使用的模型

<p align="center">
  <img src="docs/screenshots/settings.png" width="900" alt="设置页：tag 数据统计、下载更新、DeepSeek 与 NovelAI 配置、Agent 接入" />
</p>

## 快速开始

### 用安装包（推荐）

1. 到 [Releases](https://github.com/Morgiana-V3/novel-prompt/releases) 下载 `NovelPrompt-Setup-x.x.x.exe`
2. 安装后直接打开，**内置数据已经就绪，比对和搜索不需要任何配置**
3. 按需在「设置 / 数据」里填：
   - DeepSeek API Key → AI 优化、画面推测
   - NovelAI Persistent API Token → 生图预览
   - 「Agent 接入 → 全部安装」→ 让 Codex / Claude Code 调用（也可以[让 agent 自己装](#让-agent-自己装推荐)）

> 环境要求：Windows 10 / 11（x64）。首次启动约需 1 秒加载索引。

### 从源码运行

```bash
git clone https://github.com/Morgiana-V3/novel-prompt.git
cd novel-prompt
npm install
npm run dev
```

国内网络如果卡在 Electron 下载，先设置镜像：

```powershell
$env:ELECTRON_MIRROR="https://npmmirror.com/mirrors/electron/"
npm install
```

需要 Node 20 或更新版本（推荐 22）。

### 打包

```bash
npm run dist     # 输出 NSIS 安装包和便携版到 release/
```

## 使用指南

### 第一次打开

打开就是「提示词比对」页，左下角显示 `tag 库已就绪` 和当前收录数量。

去「设置 / 数据」页按需配置：

1. **DeepSeek** — 填 API Key（在 [DeepSeek 开放平台](https://platform.deepseek.com/) 申请）。模型默认 `deepseek-flash`，也可以填其他 OpenAI 兼容接口；思考强度默认「低」，调高更准但更慢
2. **NovelAI** — 在 NovelAI 网页「设置 → Account → Get Persistent API Token」获取，填好后点「保存并测试连接」。「只用免费额度」默认开启
3. **Agent 接入** — 见 [Agent 接入（MCP）](#agent-接入mcp)

### 一次完整的流程

1. **写或导入** — 在任意页面的「当前提示词」里粘贴，或把 NovelAI 原图拖进窗口
2. **比对** — 先处理不存在的 tag（点候选替换或全部移除），再「全部修正」别名，最后看看有效 tag 的权重和警告
3. **AI 优化** — 选「优化现有提示词」，或切到「描述转提示词」用中文写画面；「额外要求」里可以补充「换成夜景」这类想法。看改动标注和修改说明，满意就「采用」
4. **画面推测** — 可选填「想要的效果」，看推测结果和风险
5. **生图预览** — 确认免费条件满足后生成，对照「推测 vs 实际」；不满意回到第 3 步继续改，改坏了从历史版本恢复

### 查一个 tag

切到「Tag 搜索」，输入中文、英文或拼音首字母。比如想找「双马尾」，`双马尾`、`twin tails`、`smw` 都能命中。单击结果会加到你最近编辑过的那个输入框。

### 改 AI 的规则

- `skills/nai-prompt.md` — AI 优化的系统提示词：顺序、权重、负面模板、评判依据、输出格式（AI 优化页的书本按钮打开）
- `skills/nai-preview.md` — 画面推测的规则（画面推测页的书本按钮打开）

改完保存，下一次调用立即生效。安装版第一次运行会把这两份复制到用户目录，之后改的是用户目录里的那份。

### 数据更新

Danbooru 每天都在变。想用最新数据：

1. 「设置 / 数据」→ 调「最小引用数」（默认 10，约 33 万条；填 1 会到 50 万条，下载更慢）
2. 点「下载 / 更新 tag 数据」，会拉取 Danbooru 的 tag、别名、包含关系和社区中文翻译；只想更新包含关系可以点「更新包含关系」
3. 社区词库没覆盖的翻译，可以点「开始 AI 翻译」用 DeepSeek 补

更新后的数据存在本机用户目录，不会影响安装包里的内置数据。

## 支持的语法

| 写法 | 说明 |
|---|---|
| `tag1, tag2` | 逗号或换行分隔 |
| `{tag}` / `{{tag}}` | 加权 ×1.05（可叠加） |
| `[tag]` | 减权 ÷1.05 |
| `1.3::tag, tag2::` | 数值权重，可包住多个 tag |
| `0.6::tag::` | 0~1 之间为降权 |
| `-1::tag::` | 负权重，主动从画面里去掉某概念（V4.5 起） |
| `artist:名字` | 画师 tag，会校验是否真的是画师分类 |
| `year 2024` | 年份 tag |
| `\|` | 分段，常用于多角色提示词 |
| `source#hug` / `target#hug` / `mutual#...` | 角色间的互动动作 |
| `Text: ...` | 画面文字块（放在主提示词末尾） |
| `"文字"` | V5 引号文字，会自动识别 |
| `long hair` / `long_hair` | 下划线和空格等价 |
| `hatsune miku \(append\)` | 括号是名字的一部分，会正确还原 |

## 数据说明

| 层 | 位置 | 内容 | 读写 |
|---|---|---|---|
| **内置数据** | 安装包 `resources/default-data/`（gzip） | tag、别名、包含关系、社区翻译、AI 翻译、拼音索引 | 只读 |
| **用户数据** | `%APPDATA%\novel-prompt\data\` | 你自己下载的 tag / 别名 / 包含关系、新增的 AI 翻译、手动改的翻译、Danbooru 统计缓存（`knowledge-cache.json`）、MCP 调用记录、设置（含 API Key 和 Token） | 可写 |
| **图库** | `%APPDATA%\novel-prompt\images\` | 生图预览生成的 PNG（文件名含时间和种子） | 可写 |
| **当前提示词** | 应用本地存储 | 当前提示词、共用参数、历史版本 | 可写 |

- tag / 别名 / 社区翻译：两层里**抓取时间更新的**那份生效；包含关系用户层有就用用户层
- 翻译：按条目合并，优先级 **手动编辑 > AI 翻译 > 社区翻译**，用户层优先
- 升级或重装不会覆盖你的用户数据

**隐私**：DeepSeek API Key 和 NovelAI Token 只存在本机 `settings.json` 里，分别只发送给 DeepSeek 和 NovelAI 官方接口；错误信息和返回给 agent 的内容会屏蔽 Token。导出脚本有白名单，`settings.json` 永远不会被打进安装包。

## 常见问题

**断网能用吗？**
比对和搜索完全离线。AI 优化、画面推测、Danbooru 统计、生图需要联网；统计查不到时自动降级，会在结果里说明。

**要花钱吗？**
比对、搜索、MCP 的检查类工具不花钱。AI 优化、画面推测用你自己的 DeepSeek API Key，按 token 计费。生图默认只用 NovelAI Opus 会员的免费额度，不满足免费条件就不提交；关掉「只用免费额度」后才可能消耗 Anlas。

**「只用免费额度」能保证不扣费吗？**
不能绝对保证。是否扣费由 NovelAI 服务端决定，本工具做的是生成前检查条件、生成后核对两类 Anlas 余额，发现扣除立即停止。

**内置数据会过期吗？**
会。Danbooru 一直在新增 tag，内置数据是发版时的快照。想要最新的就点「下载 / 更新」，之后每次启动都用你更新过的数据。

**AI 挑出来的 tag 还是不对怎么办？**
看修改说明里每条的依据标签，「审美」类的只是建议。规则不合你的习惯就改 `skills/nai-prompt.md`，保存后下一次调用立即生效。

**agent 里看不到 novel-prompt 的工具？**
确认「Agent 接入」里对应的项都是「已安装」，然后完全重启 agent。换过安装目录的话会显示「需更新」，重新点一次安装。便携版不支持 MCP。

**能用在 SD / WebUI 上吗？**
tag 部分可以，数据来自 Danbooru，和 SD 通用的那套一致，只是权重语法是 NovelAI 的。

**打包报 EPERM？**
如果输出目录在桌面这类受保护位置，electron-builder 解压 Electron 后改名会被系统拒绝。换个输出目录即可：

```bash
npm run dist -- "--config.directories.output=D:\build\novel-prompt"
```

## 开发者

### 技术栈

Electron 44 · Vue 3 · TypeScript · Vite（electron-vite）· 内存索引搜索 · DeepSeek Function Calling · MCP（stdio，无第三方依赖）

没有用数据库：33 万条 tag 读进内存后用线性扫描 + 打分排序，几十毫秒出结果，省掉原生模块编译的麻烦。

### 结构

```
src/main/tagdb      数据抓取（fetcher）、两层数据读取（layers）、内存索引与包含关系（store）、Danbooru 共现与 wiki（knowledge）
src/main/prompt     提示词解析器
src/main/ai         DeepSeek 客户端、优化器（工具调用 + 校验循环）、画面推测、统计数据收集（evidence）、批量翻译
src/main/nai        NovelAI 图像接口、免费额度检查、图库、ZIP 解析
src/main/mcp        MCP 服务端（server）、工具定义（tools）、安装到 Codex / Claude Code（install）
src/shared          主进程与界面共用的类型、NAI 预设、提示词导入解析（分节文本 / JSON / PNG 元数据）
src/renderer        Vue3 界面（store.ts 当前提示词与历史，components/ 共用组件，Mascot.vue 猫娘）
skills/             AI 优化与画面推测的 Skill 文档（DeepSeek 的系统提示词）
agent-skill/        给外部 agent 的 Skill：安装 + 使用（Codex / Claude Code 格式）
default-data/       随安装包分发的内置数据
scripts/            数据导出、MCP 代理与冒烟测试、吉祥物生成
```

### 常用脚本

```bash
npm run dev          # 开发模式（主进程改动自动重启）
npm run build        # 只构建
npm run typecheck    # 类型检查
npm run mcp:smoke    # 构建并以 MCP 模式跑一遍初始化、工具列表和几个只读工具
npm run screenshots  # 重新生成 README 截图（docs/screenshots/）
npm run dist         # 打包安装包 + 便携版
npm run data:export  # 把本机数据导出为内置数据 default-data/
```

### 更新内置数据（发版前）

```bash
npm run data:export   # 从 %APPDATA%\novel-prompt\data 导出到 default-data/
npm run dist
```

导出脚本只认白名单文件（tags / aliases / implications / zh-community / zh-ai / zh-user / pinyin-cache），`settings.json` 不会被导出。

### 截图

`npm run screenshots` 会用一份示例提示词自动打开各页面截图，输出到 `docs/screenshots/`。运行时使用临时用户目录：不读取你的 Token，不改动你的当前提示词和历史。

`npm run screenshots:ai` 会额外读取你设置里的 DeepSeek Key，真实跑一次 AI 优化和画面推测再截图（消耗少量额度），这样这两页截到的是带结果的画面。

### 吉祥物

立绘是用 NovelAI 生成的，同一个 seed 保证七个表情是同一个角色。需要重新生成时：

```bash
$env:NAI_KEY="pst-..."       # 你自己的 NovelAI Token，不要提交
$env:NAI_SEED="777"
python scripts/gen-mascot.py         # 生成到 assets-src/mascot/
python scripts/process-mascot.py     # 抠底、裁边、输出到 src/renderer/src/assets/mascot/
```

依赖 Python 3 和 Pillow。`process-mascot.py` 会顺带生成 `build/icon.ico`（应用图标）。

## 致谢

- tag 数据、包含关系、共现统计与 wiki 来自 [Danbooru](https://danbooru.donmai.us/)，版权归 Danbooru 及各位贡献者
- 社区中文翻译来自 [byzod/a1111-sd-webui-tagcomplete-CN](https://github.com/byzod/a1111-sd-webui-tagcomplete-CN)
- 界面风格参考 OpenAI Codex 的浅色布局

生图功能调用的是用户自己的 NovelAI 账户，本项目不提供、不托管任何图像生成服务。

## 许可证

[MIT](LICENSE)
