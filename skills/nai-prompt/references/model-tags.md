# 内置 · 提示词编排 · 第 6 节：模型专用词和质量设置

[返回入口与读取条件](../SKILL.md)。本文件章节编号沿用原文；跨章引用按入口目录定位，不自动读取整个包。

## 6. NovelAI 专用 tag（Danbooru 中没有，但 NAI 认识）

**质量 / 美学（V4.5、V5 通用）**
- 正向：`masterpiece`、`best quality`、`amazing quality`、`very aesthetic`、`aesthetic`、`no text`
- 负向用：`worst quality`、`bad quality`、`low quality`、`displeasing`、`very displeasing`、`artistic error`、`too many watermarks`、`blank page`
- 场景标记：`location`（无人物的纯场景图）、`background dataset`、`fur dataset`（兽人/兽耳画风数据集，放在最开头）

**Add Quality Tags**【官方】：默认开启，会在主提示词末尾自动追加下列内容（界面上看不到，但占提示词长度）。本软件生图时由程序显式拼接，使用 Standard 档；有 `Text:` 块时插在它前面。

| 模型 | 自动追加内容 |
|---|---|
| V5 Full / Curated（Standard）| `very aesthetic, masterpiece, no text` |
| V5 Full / Curated（Light）| `very aesthetic, amazing quality, no text` |
| V4.5 Full | `location, very aesthetic, masterpiece, no text` |
| V4.5 Curated | `location, masterpiece, no text, -0.8::feet::, rating:general` |

- 开启时**默认不要重复添加**这些词；用户原提示词里已有质量词时，保留即可。
- 自动追加里有 `no text`。官方说明它对**短文字**影响较大、对长文字影响通常不大【官方】。画面需要短文字（拟声词、短对白、招牌）时，提醒用户可以关闭 Add Quality Tags，且不要再手写 `no text`。

**【V5】新增**
| tag | 作用 |
|---|---|
| `low complexity` / `medium complexity` / `high complexity` / `ultra complexity` | 控制画面复杂度，对风格影响很大。一般用 `high complexity`；`low` 和 `ultra` 适合风格化作品【经验】 |
| `depthness` | 阴影更有层次和纵深 |
| `attractive male` | 好看的男性 |
| `meta:novel era` / `meta:golden era` | 画风轻微偏新 / 偏旧 |
| `visual novel art` / `visual novel bg` / `visual novel cg` / `visual novel chibi` / `visual novel sprite` | 视觉小说（Galgame）风格：画风、背景、CG、Q版、立绘 |
| `transparent background` | 背景透明（真 alpha 通道），效果弱时加权 `2.1::transparent background::` |
| `alpha transparency` | 物体半透明（魔法特效、火焰、雨伞等）|
| `has alpha` | 以某种方式使用 alpha 通道 |

以上 V5 专用 tag **在 V4.5 中不要使用**。

---
