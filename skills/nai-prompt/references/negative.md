# 内置 · 提示词编排 · 第 8 节：完整负面、预设及风格误伤

[返回入口与读取条件](../SKILL.md)。本文件章节编号沿用原文；跨章引用按入口目录定位，不自动读取整个包。

## 8. 负面提示词（Undesired Content，简称 UC）

### 8.1 输出要求
负面提示词要给出**完整版本**：
- 用户提供了负面 → 在其基础上修正（校验 tag、去冲突、按需补充），保留用户刻意排除的具体元素。
- 用户没提供 → 根据画面风格，从下方对应模型的预设出发裁剪后输出。

### 8.2 NAI 官方 UC 预设【官方】
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

### 8.3 正负面冲突（重点检查）
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

### 8.4 补充与写法
- **按问题补充**【经验】：手部问题 `bad hands, extra digits, fewer digits`；解剖问题 `bad anatomy, bad proportions`（Q版 `chibi` 时不要加 `bad proportions`）；脸部问题 `bad face`、`mismatched pupils`。没有具体问题时，不要为了凑数往负面里加词。
- **间接排除**【官方】：瑕疵往往来自模型把目标特征与**相似概念**混淆，排除相似概念比直接排除目标更有效。官方例：`freckles` 出现奇怪斑点时，在负面加 `{{tattoo, facial mark}}`，雀斑保留、瑕疵消失。
- **负面里的权重**：`{tag}` = 更强烈地避免，`[tag]` = 轻度避免【官方】；`0::tag::` 让该 tag 不起作用（官方 V5 Light 预设里就有 `0::ai-generated::`）。不要在负面中使用负数权重：相当于双重否定，结果难以预测【经验】。
- **长度**：负面一般 15~35 个 tag；堆得越长，画面越容易发平、风格变淡【经验】。
- 不需要的具体元素（帽子、眼镜）优先放负面；角色设定自带、负面压不住时，再在正向用 `-1::tag::`【官方】。

---
