# 动作、互动与连续性

### 时间与连续：选用索引

| 技法与章节 | 适合的画面意图 |
|---|---|
| [同机位重复](actions.md#同机位重复) | 比较姿势、物态或距离的变化。 |
| [正反打](actions.md#正反打) | 轮换对话注意，同时维持空间。 |
| [预备→接触→结果](actions.md#预备接触结果) | 让动作有因果、看得出完成。 |
| [瞬间延长](actions.md#瞬间延长) | 迟疑、将触未触、微小反馈。 |
| [时间省略](actions.md#时间省略) | 跳过不必逐步展示的过程。 |
| [用消耗物暗示经过](actions.md#用消耗物暗示经过) | 沉默等待、时间流逝。 |
| [两地平行剪接](actions.md#两地平行剪接) | 并行动作、赶赴与等待。 |
| [同刻不同侧面](actions.md#同刻不同侧面) | 场所氛围、观察而非推进。 |
| [形状匹配切换](actions.md#形状匹配切换) | 跨空间建立视觉呼应。 |
| [回忆与返回现实](actions.md#回忆与返回现实) | 把过去与当前区分。 |
| [动作接力](actions.md#动作接力) | 让手势和物件接续读路。 |
| [页末隐藏信息](actions.md#页末隐藏信息) | 让答案暂时不在可见范围。 |
| [下一页揭示](actions.md#下一页揭示) | 兑现前一页隐藏的事实。 |

### 人物互动、手别与动作结果

互动需要可见的角色职责和身体路径。描述发起者、使用部位、目标、接触方式以及此刻的状态；空闲手、支撑面和持物数量在有歧义时补明。两个角色都写holding不一定能分清谁抓谁、谁托谁。

有效动作tag可在人物正向中配source#／target#；对等参与可用mutual#。这些前缀表达动作角色，不是可以编号配对的身份ID；也不能代替具体接触句。

下面是握腕示例，服装和人物类型应替换成当前设定：

```text
[Character 1]
girl, white shirt, long sleeves, source#holding another's wrist,
She is an adult woman. Her right hand closes around his left wrist. Show the gripping fingers and both relevant forearms. Her other hand stays separate and empty.

[Character 2]
boy, black shirt, short sleeves, target#holding another's wrist,
He is an adult man. His left wrist is held by her right hand. His right hand remains free below the grip.
```

人物自身的左／右、画面左／右和身体朝向是不同概念。严格正面并肩时，画左者的右臂与画右者的左臂都位于外侧；若要求这对手在中间接触，需要跨身路径，而非直接把画面近侧手叫成指定手。可以补：

```text
Her right forearm crosses in front of her white shirt from the far image-left upper arm toward the central grip. His left forearm crosses in front of his black shirt from the far image-right upper arm toward that same grip.
```

这能表达路径，但不能保证正确抓握或主被动。若用户允许换机位，背向或侧向可让目标臂更自然接近；不能擅改已经指定的正面画面。核对身体关系时沿肩、肘、袖口到手追踪，不能只看手掌在画面哪边。

需要双手的姿势直接写Both hands rest visibly on her knees. 递物完成写The receiver alone holds the sheet while the giver's hands have fully released it. 到达写脚实际落在目标地面，接住写谁承担重量及原支撑是否解除。台词里的“接住了”“到了”不是画面结果的替代。

跨格连续还要保留物件的数量、形状、当前持有人和支撑面。手部特写、插格或更大的主格可以给证据更多面积；动作被放大不代表结构自动正确。镜头改变时重新检查这些关系，而不是只复制上一格的左右。

### 同机位重复

**何时使用**：比较姿势、物态或距离的变化。

**提示词构建**：固定机位、地标和构图，逐格改变姿态与持物状态。 写入位置：Base共同地标＋逐次出场状态。

**示例片段**：

```text
Repeat the same camera position and shelter frame across all three panels. In the first she studies her phone. In the second the phone is lowered and her eyes turn toward the road. In the third she sits on the bench with empty hands.
```

**使用边界**：近似重复机位可出现；中间状态易重复，甚至增出同人分身。

### 正反打

**何时使用**：轮换对话注意，同时维持空间。

**提示词构建**：两格互换露脸者与肩背者，同时保持桌边和座位关系。 写入位置：两格分别限定谁露脸、谁仅肩背。

**示例片段**：

```text
In the first panel show only A's shoulder and the back of A's head while B's face is fully visible across the table. In the second reverse the view so B is only a foreground shoulder and A's face is visible. Retain the same table and seating positions.
```

**使用边界**：互换露脸在部分输入可实现，但重复露脸和增人仍常见；拆更多条目不必更准。

### 预备→接触→结果

**何时使用**：让动作有因果、看得出完成。

**提示词构建**：各格给出可辨物理状态，结果格展示新状态而非抽象完成词。 写入位置：逐格事件与相应动作/物件条件。

**示例片段**：

```text
Panel 1 shows the raised hammer above the nail. Panel 2 isolates the moment the hammer face meets the nail head. Panel 3 is a low close-up of the wood with the shaft buried and only the small flat nail head visible at the surface.
```

**使用边界**：末态可因明确物理状态而改善；接触方向与完成结果仍可能错误。

### 瞬间延长

**何时使用**：迟疑、将触未触、微小反馈。

**提示词构建**：固定对象近景，只改变可辨的气隙、接触或形变。 写入位置：连续近景，固定对象和机位。

**示例片段**：

```text
Keep the same tight view of the fingertip and switch in three panels. First leave a visible air gap. Next show the first contact without depression. Last show the switch visibly pressed inward. Change only this small physical state.
```

**使用边界**：属于候选写法，细微差异曾被合并或增格；不能称稳定复现微动作。

### 时间省略

**何时使用**：跳过不必逐步展示的过程。

**提示词构建**：保留空间地标，用光照与物态差异表达时间跳跃。 写入位置：两端事件及时间线索。

**示例片段**：

```text
The first panel shows daylight through the window and raw dough on the tray. The next panel shows the same kitchen at night with finished baked loaves on that tray. Keep the person and kitchen landmarks consistent without adding intermediate steps.
```

**使用边界**：时间跳接能出现；原料与成品的具体外观仍可能不符。

### 用消耗物暗示经过

**何时使用**：沉默等待、时间流逝。

**提示词构建**：固定容器和桌面参照，写起始量、减少量与终点残留。 写入位置：逐格物件视图，无人时不加人物。

**示例片段**：

```text
Keep the same plate and table seam in all three views. Show the whole cake first then a clearly reduced portion and finally the empty plate with a few crumbs. No eater or hands enter these panels.
```

**使用边界**：起终状态有支持；中间减少比例和碎屑并不稳定。

### 两地平行剪接

**何时使用**：并行动作、赶赴与等待。

**提示词构建**：两地各有专属人物和地标，交替返回而不混合背景。 写入位置：交替事件，给各地独立地标。

**示例片段**：

```text
Alternate between the station clock with the waiting woman and the residential lane with the running man. Return to the same landmark each time that location appears. Keep the station clock out of the street views.
```

**使用边界**：人物交替能出现；地点地标容易串入另一处，不能仅凭轮流出场认定平行叙事成功。

### 同刻不同侧面

**何时使用**：场所氛围、观察而非推进。

**提示词构建**：声明同一时刻，各格限定全景或细节范围。 写入位置：每格明确不同景别与可见范围。

**示例片段**：

```text
All three panels belong to the same moment. Show the whole empty platform first then only the rain on the bench and finally only the lamp reflected in a puddle. Do not repeat the whole platform in the detail panels.
```

**使用边界**：属于候选写法；细节格容易重复整景或被理解为后续时刻。

### 形状匹配切换

**何时使用**：跨空间建立视觉呼应。

**提示词构建**：匹配相邻格物体的轮廓、大小与位置，仍是独立场景。 写入位置：相邻物件格的轮廓、中心与大小。

**示例片段**：

```text
End the first scene on a round clock face. Begin the next scene with a full moon of comparable apparent size at the same place in its panel. The objects echo each other's circular outline while remaining in separate scenes.
```

**使用边界**：圆形呼应有支持；跨格位置大小是近似关系，非精确套准。

### 回忆与返回现实

**何时使用**：把过去与当前区分。

**提示词构建**：限定回忆边界，返回格恢复现实地标与当前状态。 写入位置：指定回忆格、边界和返回地标。

**示例片段**：

```text
The middle panel is a memory surrounded by a soft wavy boundary. Show the childhood toy only inside that memory. The last panel returns to the same present-day window and adult woman without the toy.
```

**使用边界**：边界与现实返回部分可见；回忆物仍可能泄漏到现实格。

### 动作接力

**何时使用**：让手势和物件接续读路。

**提示词构建**：写物件沿读路移动及持有人变化，终点明确原持有者松开。 写入位置：逐格入画边、持有人与状态。

**示例片段**：

```text
The upper-right panel shows A extending one letter toward the left. The next panel follows it into a close-up where both hands touch the same letter. The lower panel shows B alone holding it while A's hands have fully released it.
```

**使用边界**：运动方向链有支持；同一纸张、交接与彻底松手仍可能失真。

### 页末隐藏信息

**何时使用**：让答案暂时不在可见范围。

**提示词构建**：当前页只写可见信息，用闭合或遮挡保证答案不可见。 写入位置：当前页只输入此刻可见状态。

**示例片段**：

```text
The last panel shows the closed box and the woman's hand resting on its lid. Keep the lid opaque and shut so the contents are not visible. End the page before the box opens.
```

**使用边界**：闭合物件与隐藏答案有支持；当前页不要附上未来答案供模型提前画出。

### 下一页揭示

**何时使用**：兑现前一页隐藏的事实。

**提示词构建**：下一页才输入答案，写打开后可见证据并重申跨页特征。 写入位置：下一页才输入答案与可见范围。

**示例片段**：

```text
Open the next page with the same box now open and a cat visibly inside. Make the cat's face readable above the near rim. Keep the box and the woman's identifying clothing consistent with the preceding page.
```

**使用边界**：答案可揭示；前后页器型、人物和遮挡连续性未稳定锁定。

[返回场景入口](../SKILL.md)
