# 内置 · 提示词编排 · 第 10、11 节：示例，仅参考结构，不直接套用

[返回入口与读取条件](../SKILL.md)。本文件章节编号沿用原文；跨章引用按入口目录定位，不自动读取整个包。

## 10. 语义 → tag 转换示例

| 用户描述 | 推荐 tag |
|---|---|
| 双马尾 | `twintails` |
| 呆毛 | `ahoge` |
| 绝对领域 | `zettai ryouiki` |
| 公主切 | `hime cut` |
| 侧马尾 | `side ponytail` |
| 异色瞳 | `heterochromia` |
| 高光眼 / 星星眼 | `sparkling eyes` / `star-shaped pupils` |
| 死鱼眼 | `jitome` / `empty eyes`（按语境区分）|
| 半身照 | `upper body` |
| 七分身（大腿以上）| `cowboy shot` |
| 仰视 / 俯视 | `from below` / `from above` |
| 回眸 | `looking back` |
| 逆光 | `backlighting` |
| 景深虚化 | `depth of field`, `blurry background` |
| 电影感 | `cinematic lighting`, `letterboxed`（宽银幕黑边，按需）|
| 赛璐璐 | `anime coloring` |
| 厚涂 | `impasto`, `thick painting`（以工具检索结果为准）|
| 雨夜霓虹 | `night`, `rain`, `neon lights`, `wet`, `reflection` |
| 便利店 | `convenience store` |
| 宽大卫衣 | `oversized hoodie`（不存在时用 `hoodie`, `oversized clothes`）|
| 双手抱着兔子玩偶 | `holding stuffed toy`, `stuffed bunny`, 再补 `she hugs the stuffed bunny with both hands.` |
| 不要帽子（角色自带）| 正向 `-1::hat::`，或负面 `hat` |
| 画面太灰 / 没细节 | `-1::monochrome::` / `-2.5::flat color::` |

**原则**：先查最直接的英文对应；查不到就拆成更基础的组合 tag；人物之间的动作用 `source#` / `target#` / `mutual#`；仍然无法表达的细节（尤其是数量、左右），用一句英文短句补充。

### 10.1 角色提示词拆分示例

以下 JSON 只演示结构，tag 仍要用工具确认。

**例 1：两人互动**（V5）——"银发女孩从背后抱住黑发短发戴眼镜的女孩，黑发女孩脸红说「放开我啦！」，教室，放学后"
```json
{
  "positive": "2girls, classroom, indoors, afternoon, sunset, window, cowboy shot, text, english text, speech bubble",
  "characters": [
    {"prompt": "girl, long hair, silver hair, red eyes, school uniform, smile, closed eyes, source#hug from behind", "position": "0.4,0.5", "negative": "glasses, black hair"},
    {"prompt": "girl, short hair, black hair, glasses, school uniform, blush, open mouth, target#hug from behind, speech bubble, Text: Let go of me!", "position": "0.6,0.5", "negative": "silver hair, long hair"}
  ]
}
```
要点：互动用 `source#` / `target#` 配对；对白写在说话者自己的角色提示词末尾，而不是主提示词。

**例 2：四格漫画，同一人物多次出现**（V5）——"四格漫画：1 格女孩早上起床；2 格她发现上学迟到慌张；3 格她叼着面包奔跑撞到一个男生；4 格两人牵着手对视，都脸红了"
```json
{
  "positive": "1girl, 1boy, 4koma, comic, multiple views, monochrome, greyscale, screentone, a four panel manga page.",
  "characters": [
    {"prompt": "girl, long hair, pajamas, sleepy, yawning, waking up, bed, bedroom, morning", "position": "0.5,0.12"},
    {"prompt": "girl, long hair, school uniform, panicking, surprised, looking at clock, speech bubble, Text: I'm late!", "position": "0.5,0.37"},
    {"prompt": "girl, long hair, school uniform, running, toast in mouth, falling, street, she bumps into the boy.", "position": "0.35,0.62"},
    {"prompt": "boy, short hair, school uniform, surprised, street", "position": "0.65,0.62"},
    {"prompt": "girl, long hair, school uniform, blush, mutual#holding hands, eye contact", "position": "0.35,0.87"},
    {"prompt": "boy, short hair, school uniform, blush, mutual#holding hands, eye contact", "position": "0.65,0.87"}
  ]
}
```
要点：人数 tag 按不同人物写 `1girl, 1boy`；女孩出现 4 次就写 4 条，外貌服装照抄；第 3、4 格里两人各一条，同一格内左右错开；有对应互动 tag 的用互动前缀配对，没有的才在角色提示词里补一句短句；每格的对白写在该格角色提示词里；主提示词只有版式和整体风格。（V4.5 下位置改用网格，且总数不能超过 6 条。）

---

## 11. 输出风格

- 正向提示词（主提示词与角色提示词合计）一般控制在 **20~45 个 tag**（多人、多格和 V5 可以更长，但信息密度比长度更重要）；负面控制在 **15~35 个 tag**。
- 不确定用户偏好时（例如是否要背景、画师），保持保守，作为 `optional` 建议给出。
- `assessment`：一两句话，说清这套提示词想画什么、整体风格、最主要的问题。
- `changes`：逐条列出修改，每条一件事，按 scope 分组（positive → character → negative → optional），每组不超过 8 条。删除或改写了用户原有的内容时，`text` 里要写出原文。示例：
  ```json
  [
    {"scope":"positive","text":"twin tails → twintails","basis":"rule","evidence":"validate_tags：别名"},
    {"scope":"positive","text":"删除 thighhighs","basis":"data","evidence":"white thighhighs 已包含 thighhighs"},
    {"scope":"positive","text":"「hug rabbit」→ holding stuffed toy, stuffed bunny，并补句 she hugs the stuffed bunny with both hands.","basis":"rule","evidence":"validate_tags：hug rabbit 不存在；原文的「双手」用短句保留"},
    {"scope":"character","text":"角色 1 的 red hair 加权到 1.3，并在角色负面加入 aqua hair","basis":"data","evidence":"hatsune miku 的图中 80% 是 aqua hair，换发色需要压住默认值"},
    {"scope":"character","text":"角色 2 负面加入 glasses","basis":"doc","evidence":"第 5 节【官方】：角色负面用于防止特征串色"},
    {"scope":"negative","text":"删除 screentone、halftone","basis":"doc","evidence":"第 8.3 节【经验】：画面是黑白漫画风，会压制网点效果"},
    {"scope":"optional","text":"想要更强的厚涂感可尝试 artist:xxx","basis":"taste","evidence":"风格偏好，未改动"},
    {"scope":"optional","text":"画面含短对白，建议关闭 Add Quality Tags","basis":"doc","evidence":"第 6 节【官方】：自动追加的 no text 对短文字影响较大"}
  ]
  ```
