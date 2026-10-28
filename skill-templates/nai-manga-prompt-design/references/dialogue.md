# 文字输入与对白载体

### 对白与文字载体：选用索引

| 技法与章节 | 适合的画面意图 |
|---|---|
| [双人气泡读路](dialogue.md#双人气泡读路) | 明确先后与说话人。 |
| [旁白框](dialogue.md#旁白框) | 时间、地点或不属于嘴部发声的叙述。 |
| [画外声](dialogue.md#画外声) | 来源在画外而当前人物仍可见。 |
| [思考泡](dialogue.md#思考泡) | 内心疑问、未说出口。 |
| [喊叫泡](dialogue.md#喊叫泡) | 明确的一次强发声。 |
| [耳语虚线泡](dialogue.md#耳语虚线泡) | 轻声、保密、低音量。 |
| [同人连接双泡](dialogue.md#同人连接双泡) | 同一人的话分成两个可读单元。 |
| [中文单列竖排](dialogue.md#中文单列竖排) | 窄高字区、日式页漫。 |
| [中文双列与列序](dialogue.md#中文双列与列序) | 单列过长、需要两列清楚排列。 |
| [较长对白的宽泡与横排](dialogue.md#较长对白的宽泡与横排) | 保留原句和可读字号，不挤成细长列。 |
| [跨框气泡](dialogue.md#跨框气泡) | 将一处对白有意跨沟槽。 |
| [大拟声字](dialogue.md#大拟声字) | 声音的方向、力度和主次。 |
| [环境拟声](dialogue.md#环境拟声) | 雨滴、小响动等场景声音。 |

### 文字内容、载体与排法

Text放在其所属提示的最末，后面不再接tag或说明。台词中的逗号、标点和用户换行属于原文，不能按tag分隔符处理。不同文字块用空行分开；块内真实换行可表达预期排法。排法仍需要文字描述说明，换行本身不保证分泡或字序。

V5可处理中文、日文与英文。Base集中Text与人物条件末尾Text都有可用情形，沿用当前有效组织，不无故在两处重复原文。每段内容要明确格位、说话人、载体与字区，尤其是同格多人、多泡和跨格对白。

```text
[Character 1 @ 0.72,0.82]
girl, smile, speech bubble, chinese text,
The lower-panel woman speaks. Put her white speech bubble in the upper-right of this panel with the tail toward her mouth.
Text: 轮到你了。
```

正文先描述载体和排列，再在末尾附原文。竖排需要区分“整句旋转”与“字形直立逐字下排”；双列要说明列序。示例：

```text
Print exactly two upright Chinese columns in this one speech bubble. Read the right column first. The first supplied line forms the right column and the second line forms the left column.
Text: 别急着把没有说完的话藏起来，
等这场雨停了我们再慢慢地说。
```

长句优先考虑宽泡、内边距和可读字号，再按允许的排版调整断行，保留原词与标点。例如同人两泡可把两个段落放在末尾：

```text
Text: 我不是要你立刻给出答案，
只希望你把真正担心的
事情说出来，哪怕今天
还说不完整。

我们可以先从最小的
一件事开始，等你准备
好了，再一起决定
接下来该怎么走。
```

这只是四行横排的例子，不是所有句子的固定断行法。中文字符数也不能套用英文词数的硬限。V5 Full文字载荷上限为750字符，V4／V4.5为118字符，包含空格与换行；上限不代表气泡容量或准确率。V4.5文字支持以英文为范围，中文原稿应保留给后排字或改用V5，不能擅自翻译或缩写用户台词。

不要把画图软件的字体点数、文字框和印刷LPI写成NovelAI可精确执行的参数。准确文字、尾归属和列序仍需逐项看图；必要的后排字是成稿手段，不能拿模型错字反改原文。具体载体与排法见[文字技法索引](#对白与文字载体选用索引)。

### 双人气泡读路

**何时使用**：明确先后与说话人。

**提示词构建**：写各泡读序、位置与各自尾，原句归属各说话者。 写入位置：字区关系＋各自Text末尾。

**示例片段**：

```text
Place A's first speech bubble in the upper-right and B's reply lower on the left. Point each tail toward its actual speaker's mouth. Leave the faces and important hand action clear.
```

分别放入两位人物各自的提示末尾，不把两段Text连续塞进同一人的条目：

```text
[人物A提示末尾]
Text: 等等。

[人物B提示末尾]
Text: 我听着。
```

**使用边界**：短句与大致泡位有支持；原文准确、标点及说话人归属仍须分别核对。

### 旁白框

**何时使用**：时间、地点或不属于嘴部发声的叙述。

**提示词构建**：矩形白底、格内位置与无尾表明旁白，末尾附原文。 写入位置：指定格的独立文字块。

**示例片段**：

```text
Reserve one small rectangular caption box at the upper-left inside the panel. Give it an opaque white backing and no tail. It is a narration caption rather than a door plaque or a speech bubble.
```

本例在同一提示末尾接：

```text
Text: 三小时后。
```

**使用边界**：矩形载体有局部支持；可能变成门牌或空框，原文和载体一起判断。

### 画外声

**何时使用**：来源在画外而当前人物仍可见。

**提示词构建**：指定画外声来源及朝外的尾，不增加发声者的头。 写入位置：泡尾/来源关系＋Text。

**示例片段**：

```text
The voice comes from beyond the closed door outside the view. Place its speech bubble near that edge and direct the tail toward the off-panel doorway. Do not show the speaker or add a new head.
```

声音属于画外来源，本例在承载该段说明的提示末尾接：

```text
Text: 有人在吗？
```

**使用边界**：画外声有成图支持；泡尾仍可能误指可见人物。

### 思考泡

**何时使用**：内心疑问、未说出口。

**提示词构建**：嘴闭合，云泡用小圆点连接头部，区别尖尾发声泡。 写入位置：人物表演＋云泡/圆点。

**示例片段**：

```text
Keep the woman's mouth closed. Put the thought inside a cloud-shaped white bubble connected to her head by a short trail of small circles. Do not draw a speech tail or make her visibly speak.
```

本例在该人物提示末尾接：

```text
Text: 是我记错了吗？
```

**使用边界**：云泡形态有支持；思考泡出现不意味着原文或人物闭口均正确。

### 喊叫泡

**何时使用**：明确的一次强发声。

**提示词构建**：开口表演、粗锯齿泡与较大原文共同表达音量。 写入位置：人物嘴部/姿态与泡轮廓。

**示例片段**：

```text
Use one irregular spiky speech bubble with a heavier outline and a single tail toward the open mouth. Keep the shouted sentence large and clear while preserving the hand gesture beside it.
```

本例在该人物提示末尾接：

```text
Text: 快躲开！
```

**使用边界**：锯齿泡与短句有支持；字形与动作避让不保证。

### 耳语虚线泡

**何时使用**：轻声、保密、低音量。

**提示词构建**：小椭圆细虚线与细尾限定说话者，听者保持闭口。 写入位置：对应说话者局部。

**示例片段**：

```text
Put the whispered line in a small oval speech bubble with a fine dashed outline. Give it one thin tail toward the whispering woman's mouth. The listener keeps their mouth closed.
```

本例在耳语者提示末尾接：

```text
Text: 小声一点。
```

**使用边界**：虚线耳语泡有支持；较小字号仍必须保持可读。

### 同人连接双泡

**何时使用**：同一人的话分成两个可读单元。

**提示词构建**：两泡次序、连接颈、同一说话者与末泡尾同时写明。 写入位置：两泡次序、连接、末泡归属。

**示例片段**：

```text
Place the first oval speech bubble at the upper-right and the second lower on the left. Join them with a narrow white connector. Give only the second bubble a tail pointing toward the same speaker.
```

本例在同一人物提示末尾用空行分开两段：

```text
Text: 先别急。

我还有一句话。
```

**使用边界**：双泡连接有结构支持；尾归属与两段原文不能只看连接颈判断。

### 中文单列竖排

**何时使用**：窄高字区、日式页漫。

**提示词构建**：窄高字区、单列下读、字形直立，再附短原句。 写入位置：字区句＋原文Text。

**示例片段**：

```text
Reserve a tall narrow white speech bubble. Print the short sentence as one upright Chinese column read from top to bottom. Keep each glyph upright rather than rotating the whole sentence sideways.
```

本例在同一提示末尾接：

```text
Text: 等雨停。
```

**使用边界**：短句直立单列在有限场景可用；不可外推任意长篇。

### 中文双列与列序

**何时使用**：单列过长、需要两列清楚排列。

**提示词构建**：一个泡的两列右先左后，Text真实换行对应两列。 写入位置：一个泡＋两列说明＋段内单换行。

**示例片段**：

```text
Inside this one tall white speech bubble render exactly two upright Chinese columns. Read the right column first and the left column second. The first supplied line is the right column and the second supplied line is the left column. Leave a clear gap and generous white inner margin.
```

本例两行对应右、左两列，使用真实换行：

```text
Text: 别急着把没有说完的话藏起来，
等这场雨停了我们再慢慢地说。
```

**使用边界**：两列载荷有可用图，也出现重复字；换行与右先左后需要同时声明。

### 较长对白的宽泡与横排

**何时使用**：保留原句和可读字号，不挤成细长列。

**提示词构建**：宽字区与水平逐行排列，原句保留并按版面断行。 写入位置：宽泡几何＋Text内实际断行；段间空行区分两个泡。

**示例片段**：

```text
Both speech bubbles are much wider than they are tall with softly rounded ends. Use the supplied line breaks to typeset each paragraph as four horizontal lines. Each Chinese line runs left to right with the next line below it. Keep equal readable character size and generous inner margins.
```

本例可接[综合文字说明中的长句载荷](dialogue.md#文字内容载体与排法)。四行是该例排法，按原句和字区调整，不能擅自删改原文。

**使用边界**：宽泡加真实断行有可用图，仍有变回竖排的样本；四行只是本例。

### 跨框气泡

**何时使用**：将一处对白有意跨沟槽。

**提示词构建**：写所属格、越哪条边、白底遮线与尾留在所属格。 写入位置：泡的所属格、越边、白底与尾。

**示例片段**：

```text
The lower panel's white speech bubble overlaps only a short segment of its top border and extends into the gutter. Its opaque backing hides the line behind it. Keep its tail inside the lower panel pointing to the speaker while leaving the upper scene unobstructed.
```

本例在下格说话者提示末尾接：

```text
Text: 我看见你了。
```

**使用边界**：泡越边有支持，尾归属仍不稳；统一speech bubble可减少实体气球歧义。

### 大拟声字

**何时使用**：声音的方向、力度和主次。

**提示词构建**：独立Text写拟声原文，描述面积倾角、白边与避让。 写入位置：独立Text＋大小/倾角/避让。

**示例片段**：

```text
Place the supplied sound effect as large slanted lettering beside the impact. Give the black letters a narrow white outline so they separate from the drawing. Keep the contact point and faces visible. Do not put the lettering in a speech bubble.
```

本例末尾接原拟声：

```text
Text: 砰！
```

**使用边界**：大字形态能出现，但指定字形未达稳定准确；不能用近似音字替换用户原文。

### 环境拟声

**何时使用**：雨滴、小响动等场景声音。

**提示词构建**：按声源定位小字与方向，明确无泡且不加其他声音词。 写入位置：声音位置与Text。

**示例片段**：

```text
Set the supplied small sound effect beside the falling rain lines with no enclosing bubble. Align its placement with the direction of the drops and leave the splash itself visible. Print no additional sound words.
```

本例末尾接原拟声：

```text
Text: 滴答
```

**使用边界**：只有局部支持；声源位置、原文和无新增声音词都可能失真。

[返回场景入口](../SKILL.md)
