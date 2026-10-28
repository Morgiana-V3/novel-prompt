## 完整组合示例

这些完整输入用于说明字段怎样拼合，均为V5示例。示例中的场所、人物与台词供替换，不是固定模板。以下保留历史输入中的画风与UC以对应当时的成图支持，并非当前默认；编写新任务时，按“成稿黑白画法与主次”采用当前默认，具体格子的特殊光影要求优先。替换后的组合需要重新判断效果，不能沿用历史样本宣称已经验证。保留过往可用组合不等于每个动作、字形或跨场景变体都已经稳定。

### 三格对话与连续空镜

这一组合把两位不同身份、四次人物／物件出场条件、上中下格区与对应文字放在一起。Base描述布局和简短事件，局部补所属出场；中格是一幅无人连续视域，末格重复短发人物。人物条目数量不能当作身份人数。

本例使用832×1216、23步、Guidance 5、Euler Ancestral、native、Rescale 0，自动质量关闭、UC None。三格、无人中格与短中文有成图支持；不据此保证任意人物和故事的同样输入都成功。

```text
[Prompt]
2girls, comic, greyscale, screentones, speech bubble, text, chinese text, very aesthetic, masterpiece. Finished black-and-white Japanese manga artwork. Use tapered ink contours and solid black shapes. Keep paper-white faces and use fine bounded screentones only in selected shadows. Render the brown hair as a neutral light gray tone with no colored ink. A three-panel manga page read from top to bottom. All three panels span the full page width. Panel 1 occupies the top third. Two adult women sit across a cafe table. The long-haired woman with glasses is on the right and invites the bob-haired woman on the left to sit. Panel 2 is one continuous shallow horizontal view of a single untouched teacup resting on the table against one rainy window. This is a silent object cutaway without any people or body parts. The cup and window share one undivided panel. Panel 3 occupies the bottom third. A close-up of the bob-haired woman's relaxed smile answers the invitation. Keep clear white gutters and rectangular black panel borders. Each text balloon stays inside its panel and avoids faces.

[Character 1 @ 0.72,0.18]
girl, long hair, black hair, glasses, white shirt, long sleeves, sitting, smile, looking at another. Panel 1 at the top. She invites the woman on her left to sit. One speech balloon belongs to her. Text: 坐这里。

[Character 1 Undesired Content]
bob cut

[Character 2 @ 0.28,0.18]
girl, bob cut, brown hair, black shirt, short sleeves, sitting, serious, looking at another. Panel 1 at the top. She listens to the woman on her right.

[Character 2 Undesired Content]
glasses, long hair

[Character 3 @ 0.5,0.5]
other, teacup, table, window, rain. Panel 2 at the middle. One untouched cup and its rainy window backdrop are in the same uninterrupted frame. This area contains no people.

[Character 4 @ 0.45,0.82]
girl, bob cut, brown hair, black shirt, short sleeves, close-up, smile. Panel 3 at the bottom. She answers the invitation with one speech balloon. Text: 好。

[Character 4 Undesired Content]
glasses, long hair

[Undesired Content]
lowres, blurry, jpeg artifacts, unfinished, sketch, watermark, signature, logo, 3d, photorealistic, painterly, watercolor (medium), spot color, shiny skin, bad anatomy, bad hands
```

若当前功能要求逐格事件只放人物区，将Base里的逐格内容移到相应条件，并保留完整事件和格位，不要直接删掉。改变版式时同时改格区句与整组位置。若改成没有对白的版本，才移除相应文字描述与Text；不要在保留对白时添加no text。

### 单幅墨线成稿

这一组合用全Base表达一个人物的单幅黑白画面，不强加comic分格，也不为统一模板增设人物条件。原始完整输入保留了道具、手部姿势与背景关系；修改时优先替换用户设定，保持本次实际需要的材料层次。

```text
[Prompt]
1girl, long hair, black hair, glasses, collared shirt, white shirt, long sleeves, laughing, closed eyes, holding chopsticks, bento, no text, greyscale, screentones, high contrast, Finished black-and-white Japanese manga artwork. Use controlled tapered ink contours and solid black shapes. Keep skin paper white while retaining clear facial features. Apply fine bounded screentones only to selected shadows. Use sparse structural hatching and simplify the background around faces and hand contact. A single upper-body manga view of one adult woman enjoying lunch beneath a cherry tree. Her loose black hair forms a clean solid silhouette and her plain white collared shirt has long sleeves without a neck bow. She laughs naturally with closed eyes and an open mouth. Her right hand holds one pair of chopsticks beside her mouth and her left hand supports one open bento at chest height. Keep the five fingers of each visible hand readable. Use a few thin pale blossom branches behind her head. Leave her hair free of extra ornaments. very aesthetic, masterpiece

[Undesired Content]
lowres, blurry, jpeg artifacts, unfinished, sketch, watermark, signature, logo, 3d, photorealistic, painterly, watercolor (medium), spot color, shiny skin, bad anatomy, bad hands
```

这个示例使用no text，因为它明确要求无字画面。需要台词时删除该词，并安排字区、归属和原文。单幅构成可以借用负空间、线重和局部网点等设计，但没有必要同时增加时间链或页面格框。

[返回快速引用](index.md#快速引用根据画面目的选择技法)
