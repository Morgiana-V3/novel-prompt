<div align="center">
  <img src="build/icon.png" width="96" alt="NovelPrompt" />
  <h1>NovelPrompt</h1>
  <p>与 AI 一起，把想法变成画面，把画面逐步调整到满意。</p>
  <p>NovelAI 创作桌面工具 · Windows 10 / 11</p>
  <p>
    <a href="https://github.com/Morgiana-V3/novel-prompt/releases/latest">下载最新版</a> ·
    <a href="CHANGELOG.md">更新记录</a> ·
    <a href="docs/usage-guide.md">使用与开发参考</a>
  </p>
</div>

NovelPrompt 把提示词、NovelAI 生图和 AI 协作放在同一个工作区。从一句描述或一张已有图片出发，整理提示词、生成画面，再通过对话不断调整。

开发维护：[重构待办](TODO.md) · [代码写作规范](docs/coding-standards.md)。

- **AI 协作创作**：围绕当前图片讨论，让 AI 提出修改方案，保留每次尝试并比较结果。
- **提示词辅助**：中文描述转提示词、AI 优化、画面推测，结合本地词库核对 tag。
- **NovelAI 生图与重绘**：支持 V4.5 / V5、多人提示词、角色位置、局部重绘和区域批注。
- **本地 Agent 接入**：通过 MCP 使用词库和生图能力，也能接管工作台、写回方案，在软件中逐步展示操作。
- **自定义创作规则**：用 Skill 告诉 AI 你的编排习惯和创作偏好，在不同环节沿用。

## 从一张图，或一个想法开始

**把 NovelAI 原始 PNG 拖进窗口，就能接着创作。** 软件会读取图片中保存的主提示词、角色提示词和负面提示词，自动填入工作区，让已有作品成为下一次尝试的起点。

还没有图片也没关系：用中文描述想画的内容，让 AI 整理成提示词；也可以直接粘贴已有提示词。提示词在比对、优化、推测和生图之间共用，不必反复搬运。

<details>
<summary>查看创作会话的不同起点</summary>

<p align="center">
  <img src="docs/screenshots/workspace-start.png" width="1000" alt="从想法、当前提示词或已有图片开始创作会话" />
</p>

</details>

## 让提示词更接近你想要的画面

**AI 优化**既能整理已有提示词，也能把中文想法转换为完整方案。画风、场景、人物特征、多人位置和台词分别编排，修改内容与理由一起展示，由你决定是否采用。

<p align="center">
  <img src="docs/screenshots/ai.png" width="1000" alt="AI 优化：对照当前提示词，展示优化结果和修改依据" />
</p>

**画面推测**帮助你在生成前检查表达是否清楚：这组提示词可能呈现怎样的构图、人物和光影，哪些内容可能冲突，哪里与期望有差距。它提供的是分析参考，实际效果仍以出图为准。

<details>
<summary>查看画面推测</summary>

<p align="center">
  <img src="docs/screenshots/preview.png" width="1000" alt="画面推测：分析画面描述、风格、构图及可能偏离预期的地方" />
</p>

</details>

这些能力背后有本地收录的 **33 万个 Danbooru tag**、别名、包含关系与中文翻译。提示词比对可以发现拼写、别名和重复问题，Tag 搜索支持中文、英文和拼音；两者均可离线使用。AI 也能查询词库及在线统计，为建议提供依据。

<details>
<summary>查看提示词比对与 Tag 搜索</summary>

<p align="center">
  <img src="docs/screenshots/compare.png" width="1000" alt="提示词比对：识别有效 tag、别名和自然语言内容" />
</p>

<p align="center">
  <img src="docs/screenshots/search.png" width="1000" alt="Tag 搜索：用中文查找候选标签及引用数" />
</p>

</details>

## 用 NovelAI 生成，也能只调整局部

支持 **NovelAI V4.5 / V5** 的提示词生图，包含多角色提示词、角色负面、画幅、种子与采样参数。生成结果保存在本机图库，方便回看、继续修改或带入 AI 工作台。

<p align="center">
  <img src="docs/screenshots/generate.png" width="1000" alt="NovelAI 生图：提示词、生成参数与本机图库" />
</p>

**角色位置可视化**让多人构图更直观。可以对照已有图片调整每个角色的位置：V4.5 使用网格，V5 使用自由坐标，参考底图支持透明度调节。

<details>
<summary>查看角色位置与参考底图</summary>

<p align="center">
  <img src="docs/screenshots/positions.png" width="1000" alt="在透明参考底图上调整多个角色的位置" />
</p>

</details>

**局部重绘**用于保留已有画面、调整指定区域。区域批注把“哪里要改”和“想怎么改”交给 AI，修改方案可以先核对再采纳；多处修改支持逐区域生成，选区外的像素由本地合成保留。

<p align="center">
  <img src="docs/screenshots/inpaint.png" width="1000" alt="局部重绘：选区、修改批注与 AI 提示词建议" />
</p>

## 在工作台里，和 AI 持续打磨一张图

AI 工作台把**当前画面、对话、提示词和历史版本**放在一起。告诉 AI 想保留什么、哪里还不满意，它会结合图片与已有讨论提出下一轮方案，协作过程随会话保存。

<p align="center">
  <img src="docs/screenshots/workspace.png" width="1000" alt="AI 工作台：一边查看当前画面，一边讨论下一轮调整" />
</p>

**建议与执行分开。** AI 给出方案后，可以先看完整的提示词差异，再决定采用、修改或放弃。既可以重新生成整张图，也可以围绕选区进行局部调整。

**每次尝试都有迹可循。** 修改对比把来源图片与结果并排展示，同时记录当时的提示词和参数。可以引用历史画面继续讨论，也可以从更满意的旧版本继续探索。

**一次讨论多处修改。** 在“本轮修改清单”勾选需要处理的区域，分别填写区域批注，在对话框补充共同要求。点击“定位”可在画布查看编号与范围。AI 联合讨论所有勾选项并给出一份完整方案；采纳后可查看合并范围，再执行重绘。选中区域使用统一提示词与重绘强度，每张候选只发起一次合并重绘请求；未勾选区域不纳入本轮遮罩。单独的局部重绘编辑器仍保留逐区域生成流程。

**选择谁来处理讨论。** 工作台支持内置 AI 和外部 Agent 两种处理者。外部接管时，Agent 读取图片、选区、启用的 Skill 与历史，自己分析并写回对话和建议，不转调 DeepSeek。新方案保留完整修改前后记录，可回看每条建议。

<details>
<summary>查看 AI 建议与修改对比</summary>

<p align="center">
  <img src="docs/screenshots/workspace-suggestions.png" width="1000" alt="AI 建议：查看完整修改前后内容与差异" />
</p>

<p align="center">
  <img src="docs/screenshots/workspace-iterations.png" width="1000" alt="修改对比：并排查看来源与结果，追溯提示词变化" />
</p>

</details>

## 让 AI 按你的规则创作

Skill 是可以导入和编辑的 Markdown 创作规则。软件内置提示词编排、画面推测和局部重绘规范，也允许叠加自己的偏好，或用自己的规则替换内置规则。

启用的 Skill 会用于对应的 AI 功能和工作台协作，让不同项目拥有各自的表达方式。

<details>
<summary>查看 Skill 管理</summary>

<p align="center">
  <img src="docs/screenshots/skill-manager.png" width="1000" alt="管理内置规则和自己导入的 Skill" />
</p>

截图中的自定义 Skill 为使用示例，可按需导入自己的规则。

</details>

## 也能交给本地 Agent

通过 **MCP**，Codex、Claude Code、Cursor 等 Agent 可以使用 NovelPrompt 的本地词库、提示词检查、图片提示词读取、Skill 管理，以及 AI 分析、NovelAI 生图和局部重绘能力。Agent 还可以读取当前界面状态、切换页面、同步提示词，并在 AI 工作台提交修改建议、采纳和生成新版本。窗口与多个 Agent 共用任务及生图锁，操作会反映到界面中；状态订阅是否触发模型行动取决于客户端支持。

**两种操作方式。** 后台模式保留原有工具，可无窗口处理数据；前台模式使用 `ui_*` 工具，在实际工作台中逐步填写、提交讨论、展示建议、绘制区域批注并生成。前台有操作状态与停止入口，直接复用软件交互逻辑，无需电脑操作插件。详见[前台与后台接入说明](docs/agent-install.md#前台模式在实际界面中执行工作流)。

Agent 也可以用 `ui_capture_app` 获取当前应用窗口的真实截图，查看弹窗、画布与未提交输入，并在操作后核对实际效果。你在软件里操作后发消息，Agent 可重新读取最新状态与截图；这属于按需观察，不是持续录像或完整操作历史。

软件内启用的 Skill 也能提供给 Agent，让桌面创作与外部协作沿用同一套规则。需要账户额度的工具受独立权限控制。

**Agent 有自己的操作指南。** 连接时提供入口，`agent_guide` 按需说明能力地图、前后台选择、操作流程和异常恢复；具体提示词规则仍使用软件内启用的 Skill。

外部接管目前由 Agent 主动读取处理：在软件里发送需求不会自动唤醒外部模型，断线也不会自动回退内置 AI。后台表示不展示操作步骤，仍共享应用数据，部分结果会同步到界面；前台自动化覆盖工作台与矩形区域重绘，并非任意控件自动化。

顶部任务中心统一显示运行进度与取消入口。任务开始时左上角标识保持稳定，后台任务和 Agent 操作可以在同一处查看。

[让 Agent 帮你安装并接入 →](docs/agent-install.md)

## 下载与开始体验

到 [Releases](https://github.com/Morgiana-V3/novel-prompt/releases/latest) 下载 **Windows x64 安装版**；也提供便携版，MCP 接入需使用安装版。

从 v0.6.0 起，安装版支持后台下载新版，完成后点击「重启并更新」，在任务结束并保存编辑后升级。v0.5.0 及更早版本需先手动安装一次新版；便携版继续手动下载。程序与内置 Skill 随版本更新，用户数据保存在独立目录。[发布更新说明](docs/auto-update.md)

本地比对与搜索开箱即用。AI 功能需要配置自己的 DeepSeek 或兼容接口，含图协作需要模型支持图像输入；生图与重绘需要 NovelAI 账户及 API Token，默认开启免费额度检查，实际额度以服务端为准。

[完整更新记录](CHANGELOG.md) · [使用与开发参考](docs/usage-guide.md) · [MCP 接入说明](docs/agent-install.md)

---

基于 Electron、Vue 与 TypeScript 构建。标签数据来自 [Danbooru](https://danbooru.donmai.us/)，社区中文翻译来自 [a1111-sd-webui-tagcomplete-CN](https://github.com/byzod/a1111-sd-webui-tagcomplete-CN)。生图服务由用户自己的 NovelAI 账户提供。

[MIT License](LICENSE)
