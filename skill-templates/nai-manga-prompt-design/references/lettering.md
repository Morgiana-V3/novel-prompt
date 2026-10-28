# 文字输入与排法

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

不要把画图软件的字体点数、文字框和印刷LPI写成NovelAI可精确执行的参数。准确文字、尾归属和列序仍需逐项看图；必要的后排字是成稿手段，不能拿模型错字反改原文。具体载体与排法见[文字技法索引](index.md#对白与文字载体选用索引)。
