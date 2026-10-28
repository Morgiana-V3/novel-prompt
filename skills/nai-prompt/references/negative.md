# 负面、质量预设与模型兼容

[返回入口与读取条件](../SKILL.md)。各主题按需查阅，不代表执行顺序；相关资料见入口目录。

## 负面提示词（Undesired Content，简称 UC）

### 输出要求
负面提示词要给出**完整版本**：
- 用户提供了负面 → 在其基础上修正（校验 tag、去冲突、按需补充），保留用户刻意排除的具体元素。
- 用户没提供 → 根据画面风格，从下方对应模型的预设出发裁剪后输出。

### NAI 官方 UC 预设【官方】
NAI 会在用户的负面之外**再追加一个 UC 预设**（Heavy / Light / Human Focus / Furry Focus / None）。本软件生图时由程序显式拼接预设。保留预设时，与预设重复的 tag 会叠加，等于加重排除力度。

**Heavy（V5 Full/Curated、V4.5 Full 相同）**——通用彩色插画的默认起点：
```
lowres, artistic error, film grain, scan artifacts, worst quality, bad quality, jpeg artifacts, very displeasing, chromatic aberration, dithering, halftone, screentone, multiple views, logo, too many watermarks, negative space, blank page
```
**Human Focus（V5 / V4.5 Full）**= Heavy + 人物专项：
```
..., @_@, mismatched pupils, glowing eyes, bad anatomy
```
**Light**——想保留更多画风自由度（复古、草图、实验风格）时用：
- V5：`lowres, bad hands, bad anatomy, artistic error, sepia, white haze, worst quality, very displeasing, jpeg artifacts, 0::ai-generated::`
- V4.5 Full：`lowres, artistic error, scan artifacts, worst quality, bad quality, jpeg artifacts, multiple views, very displeasing, too many watermarks, negative space, blank page`

**V4.5 Curated 的预设**均以 `blurry, lowres, upscaled` 开头（Human Focus 还有 `bad hands`）。

**Furry Focus**（V5 / V4.5 Full）：
```
{worst quality}, distracting watermark, unfinished, bad quality, {widescreen}, upscale, {sequence}, {{grandfathered content}}, blurred foreground, chromatic aberration, sketch, everyone, [sketch background], simple, [flat colors], ych (character), outline, multiple scenes, [[horror (theme)]], comic
```

> 以上预设里有些 tag 不在 Danbooru 高频库中（`screentone`、`white haze`、`widescreen`、`sequence`、`grandfathered content`、`blurred foreground` 等），但 NAI 认识，本工具已把它们列入白名单，校验不会报错。

### 正负面冲突（重点检查）
负面里的 tag 与正向想要的效果相悖时，会**压制用户想要的风格**。按画面风格从负面（包括预设）中删除对应 tag，或建议换一个预设【经验】：

| 正向画面 / tag | 负面中要删除或降权的 tag |
|---|---|
| 漫画、多格、四格（`comic`、`4koma`、`multiple views`、`manga`）| `multiple views`、`halftone`、`screentone`、`comic` |
| 黑白 / 单色（`monochrome`、`greyscale`）| `monochrome`、`greyscale`、`halftone`、`screentone`、`dithering` |
| 草图 / 线稿（`sketch`、`lineart`、`traditional media`）| `sketch`、`lineart`、`unfinished`、`scan artifacts` |
| 复古 / 胶片 / 旧番（`film grain`、`retro artstyle`、`1990s (style)`、`sepia`）| `film grain`、`chromatic aberration`、`sepia`、`scan artifacts` |
| 像素画（`pixel art`）| `lowres`、`dithering`、`jpeg artifacts` |
| 景深虚化（`depth of field`、`blurry background`、`bokeh`）| `blurry`、`blurred foreground` |
| 发光眼、异色瞳、漩涡眼（`glowing eyes`、`heterochromia`、`@_@`）| `glowing eyes`、`mismatched pupils`、`@_@`（Human Focus 预设自带）|
| 留白构图、极简（`negative space`、`minimalism`、`simple background`）| `negative space`、`simple` |
| 多人（`2girls`、`multiple boys`、`crowd`）| `multiple girls`、`multiple boys`、`extra people` |
| 画面需要文字（`speech bubble`、`Text:`）| `text`、`speech bubble`、`english text`、`logo`；短文字时提醒关闭 Add Quality Tags |
| 色差 / 故障艺术（`chromatic aberration`、`glitch`）| `chromatic aberration` |

通用规则：
- **同一概念同时出现在正向和全局负面**（含别名，如正向 `twintails` 与负面 `twin tails`）会互相抵消、画面不稳定【经验】。默认以正向为准，从负面删除；角色负面只和该角色自己的正向比较。
- 正向是 `solo` 时，负面加 `multiple girls, extra people` 是合理的；人数变化后要同步修改。
- **负面里不按包含关系删词**：`bad hands` 和 `bad anatomy` 排除的范围不同，宽泛的词不是冗余。

### 补充与写法
- **按问题补充**【经验】：手部问题 `bad hands, extra digits, fewer digits`；解剖问题 `bad anatomy, bad proportions`（Q版 `chibi` 时不要加 `bad proportions`）；脸部问题 `bad face`、`mismatched pupils`。没有具体问题时，不要为了凑数往负面里加词。
- **间接排除**【官方】：瑕疵往往来自模型把目标特征与**相似概念**混淆，排除相似概念比直接排除目标更有效。官方例：`freckles` 出现奇怪斑点时，在负面加 `{{tattoo, facial mark}}`，雀斑保留、瑕疵消失。
- **负面里的权重**：`{tag}` = 更强烈地避免，`[tag]` = 轻度避免【官方】；`0::tag::` 让该 tag 不起作用（官方 V5 Light 预设里就有 `0::ai-generated::`）。不要在负面中使用负数权重：相当于双重否定，结果难以预测【经验】。
- **长度**：负面一般 15~35 个 tag；堆得越长，画面越容易发平、风格变淡【经验】。
- 不需要的具体元素（帽子、眼镜）优先放负面；角色设定自带、负面压不住时，再在正向用 `-1::tag::`【官方】。

---

## NovelAI 专用 tag（Danbooru 中没有，但 NAI 认识）

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
