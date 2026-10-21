# NovelPrompt

NovelAI（V4.5 / V5）提示词桌面工具：Danbooru tag 比对、中英双语搜索、DeepSeek AI 优化。

## 运行

```bash
npm install          # Electron 下载慢时先设置：$env:ELECTRON_MIRROR="https://npmmirror.com/mirrors/electron/"
npm run dev          # 开发模式
npm run dist         # 打包 Windows 安装包和便携版，输出到 release/
```

首次启动即可使用：安装包内置了一份 tag 和中文翻译。只需在「设置 / 数据」页填写 DeepSeek API Key。

## 功能

| 页面 | 说明 |
|---|---|
| 提示词比对 | 左侧输入，右侧实时拆分为：不存在（附编辑距离候选，点一下替换）/ 别名（一键修正）/ 有效（中英双语、分类、引用数、权重）/ 自然语言与文字。点击结果会在左侧选中原文 |
| Tag 搜索 | 支持中文、英文、拼音全拼和首字母（如 `smw` 搜「双马尾」），可按分类筛选；单击加入提示词，右键复制，双击中文可编辑翻译 |
| AI 优化 | 两种模式：优化现有提示词 / 把描述转换成提示词。AI 调用本地 tag 库检索和校验，最后由本地二次校验并自动修正无效 tag |
| 侧栏 V4.5 / V5 | 切换目标模型，会同时影响比对时的警告提示和 AI 的编排规则 |

## 支持的语法

`{}` / `[]` / `1.3::tag::` / `-1::tag::` / `artist:` / `year 2024` / `|` 分段 / `source#` `target#` `mutual#` / `Text:` / V5 引号文字 / 自然语言句子

## 数据

数据分两层：

| 层 | 位置 | 内容 | 读写 |
|---|---|---|---|
| 默认数据 | 项目 `default-data/`，打包后在 `resources/default-data/` | tag、别名、社区翻译、AI 翻译、拼音索引（gzip 压缩，约 5.7MB） | 只读 |
| 用户数据 | `%APPDATA%/novel-prompt/data/` | 用户下载的新 tag、新增的 AI 翻译、手动编辑的翻译、设置（含 API Key） | 可写 |

读取规则：
- **tag / 别名 / 社区翻译**：用户点「下载 / 更新」后存到用户目录。之后两层中抓取时间更新的那份生效。
- **翻译**：两层按条目合并，优先级为 手动编辑 > AI 翻译 > 社区翻译，用户层优先于默认层。
- 升级安装包不会覆盖用户目录；卸载后用户目录也会保留。

### 更新内置数据（发版前）

```bash
npm run data:export   # 把本机 %APPDATA%/novel-prompt/data/ 的数据导出到 default-data/
npm run dist          # 打包，default-data/ 会一起打进安装包
```

导出脚本只认白名单里的文件（tags / aliases / zh-community / zh-ai / zh-user / pinyin-cache）。**`settings.json` 永远不会被导出**，你的 API Key 不会进入安装包。

## Skill 文档

`skills/nai-prompt.md` 是 AI 优化使用的系统提示词，包含编排顺序、权重规范、多角色写法、V4.5 / V5 差异、负面提示词模板、语义转 tag 示例等。修改后立即生效。打包后会复制到 `%APPDATA%/novel-prompt/skills/`，可在设置页点「编辑 Skill 文档」打开。

## AI 模型

默认使用 `deepseek-flash`（DeepSeek-V4.1-Flash）。设置页可以调思考强度：关闭 / 低 / 高 / 最高。AI 优化是带工具调用的多轮对话，开启思考时每轮的 `reasoning_content` 都会原样回传。批量翻译固定关闭思考。旧设置里的 `deepseek-chat` / `deepseek-reasoner` 会自动迁移成新模型名。

## 吉祥物（猫娘）

立绘用 NovelAI V4.5 Full 生成。画风是普通头身、彩色描边、扁平上色、几乎无阴影。所有表情用同一个 seed，保证是同一个角色：

```bash
$env:NAI_KEY="pst-..."                 # 你的 NovelAI Persistent API Token，不要提交到仓库
$env:NAI_SEED="777"                    # 当前使用的 seed
python scripts/gen-mascot.py           # 生成全部表情 → assets-src/mascot/*.png（遇到 429 自动重试）
python scripts/gen-mascot.py happy     # 只重画某一张
python scripts/process-mascot.py       # 抠白底、半身图底部渐隐、裁边 → src/renderer/src/assets/mascot/，并生成 build/icon.ico / icon.png
```

表情和使用场景：`idle` 待机 / `happy` 全部通过 / `busy` AI 处理中 / `confused` 搜不到或有错误 / `chill` 空闲提示 / `wink` 优化完成 / `avatar` 侧栏 logo 和应用图标。

## 结构

```
src/main/tagdb     数据抓取（fetcher）、两层数据读取（layers）、内存索引与搜索（store）、NAI 专用 tag
src/main/prompt    提示词解析器与比对
src/main/ai        DeepSeek 客户端、优化器（工具调用 + 校验循环）、批量翻译
src/renderer       Vue3 界面（components/icons.ts 是自绘图标，components/Mascot.vue 是猫娘）
skills/            AI Skill 文档
default-data/      随安装包分发的默认数据（gzip，约 5.7MB）
scripts/           吉祥物生成、数据处理脚本
```

### 打包注意

`release/` 如果放在桌面这类受保护目录，electron-builder 解压 Electron 后改名会被系统拒绝（EPERM）。可以把输出目录指到别的盘或临时目录：

```bash
npm run dist -- "--config.directories.output=D:\build\novel-prompt"
```
