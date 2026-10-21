# NovelPrompt

NovelAI（V4.5 / V5）提示词桌面工具：Danbooru tag 比对、中英双语搜索、DeepSeek AI 优化。

## 运行

```bash
npm install          # Electron 下载慢时先设置：$env:ELECTRON_MIRROR="https://npmmirror.com/mirrors/electron/"
npm run dev          # 开发模式
npm run dist         # 打包 Windows 安装包和便携版，输出到 release/
```

首次启动后：在「设置 / 数据」页点「下载 / 更新 tag 数据」（大约 3~5 分钟），然后填写 DeepSeek API Key。

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

所有数据保存在 `%APPDATA%/novel-prompt/data/`：

- `tags.json`、`aliases.json`：Danbooru 数据
- `zh-community.json`：社区中文翻译（byzod/a1111-sd-webui-tagcomplete-CN）
- `zh-ai.json`：AI 补全的翻译
- `zh-user.json`：手动编辑的翻译，优先级最高
- `settings.json`：设置

翻译优先级：手动编辑 > AI 翻译 > 社区翻译。

## Skill 文档

`skills/nai-prompt.md` 是 AI 优化使用的系统提示词，包含编排顺序、权重规范、多角色写法、V4.5 / V5 差异、负面提示词模板、语义转 tag 示例等。修改后立即生效。打包后会复制到 `%APPDATA%/novel-prompt/skills/`，可在设置页点「编辑 Skill 文档」打开。

## AI 模型

默认使用 `deepseek-flash`（DeepSeek-V4.1-Flash）。设置页可以调思考强度：关闭 / 低 / 高 / 最高。AI 优化是带工具调用的多轮对话，开启思考时每轮的 `reasoning_content` 都会原样回传。批量翻译固定关闭思考。旧设置里的 `deepseek-chat` / `deepseek-reasoner` 会自动迁移成新模型名。

## 吉祥物（猫娘）

立绘用 NovelAI 生成，固定 seed 保证不同表情是同一个角色：

```bash
$env:NAI_KEY="pst-..."                 # 你的 NovelAI Persistent API Token，不要提交到仓库
python scripts/gen-mascot.py           # 生成全部表情 → assets-src/mascot/*.png
python scripts/gen-mascot.py happy     # 只重画某一张
python scripts/process-mascot.py       # 抠白底、裁边、压缩 → src/renderer/src/assets/mascot/，并生成 build/icon.ico
```

表情和使用场景：`idle` 待机 / `happy` 全部通过 / `busy` AI 处理中 / `confused` 搜不到或有错误 / `chill` 空闲提示 / `wink` 优化完成 / `avatar` 侧栏 logo 和应用图标。

## 结构

```
src/main/tagdb     数据抓取（fetcher）、内存索引与搜索（store）、NAI 专用 tag
src/main/prompt    提示词解析器与比对
src/main/ai        DeepSeek 客户端、优化器（工具调用 + 校验循环）、批量翻译
src/renderer       Vue3 界面（components/icons.ts 是自绘图标，components/Mascot.vue 是猫娘）
skills/            AI Skill 文档
scripts/           吉祥物生成与处理脚本
```
