# 黑白画法、主次与线效

### 平面设计与黑白主次：选用索引

| 技法与章节 | 适合的画面意图 |
|---|---|
| [负空间](visual.md#负空间) | 孤立、停顿、突出一个落点。 |
| [透视引导线](visual.md#透视引导线) | 让空间线指向人物/证据。 |
| [黑→灰→白的格间节奏](visual.md#黑灰白的格间节奏) | 压迫、过渡、释放。 |
| [对称构图](visual.md#对称构图) | 仪式、秩序、正面到场。 |
| [非对称平衡](visual.md#非对称平衡) | 不等大小但有视觉平衡。 |
| [视线链](visual.md#视线链) | 脸→目标→回应的注意连接。 |
| [图底反转](visual.md#图底反转) | 对立、辨识、黑白切换。 |
| [重复与一次变化](visual.md#重复与一次变化) | 建立秩序后突出异常。 |
| [主辅线与密度](visual.md#主辅线与密度) | 清晰主体、完整但不抢眼的背景。 |

### 线效与情绪：选用索引

| 技法与章节 | 适合的画面意图 |
|---|---|
| [平行速度线](visual.md#平行速度线) | 强调一个明确的位移方向。 |
| [放射集中线](visual.md#放射集中线) | 把注意聚向发现物/接触点。 |
| [顺体排线与交叉排线](visual.md#顺体排线与交叉排线) | 体积、衣褶、深投影。 |
| [局部网点层级](visual.md#局部网点层级) | 区分人物、衣影与背景。 |
| [冲击反白](visual.md#冲击反白) | 接触瞬间、强黑白强调。 |
| [阴沉情绪线](visual.md#阴沉情绪线) | 心理压迫、失落。 |
| [象征花卉背景](visual.md#象征花卉背景) | 温和、心动、柔和余韵。 |

### 成稿黑白画法与主次

以下是这份模板提供的一种可替换画风示例，不代表用户已确认的偏好。示例搭配V5 Full、关闭Add Quality Tags、UC预设None和下方自定义UC；这些是创作建议，不自动修改软件参数。只有用户选择该方案时才采用。用户明确指定其他画风或已有设置时，以当前要求为准。将本次人数放在画师之前，补充场所、事件和人物条件；此片段本身不包含具体故事。单幅漫画风插画可去掉comic，并将首句的manga page改为manga illustration，避免强加分格。

```text
0.7::artist:wool bl::, 0.8::artist:saeki shun::, greyscale, comic, screentones, high contrast,

A black-and-white manga page with clean finished ink linework and crisp tapered contours. The drawing uses solid black shapes with distinct mid-gray screentones and clean paper white. Expressive anime-style faces with economical facial lines.

Use fine regular screentones selectively for flat tones and selected shadows. Use structural hatching only where useful. Keep the deepest shadows solid black. Render reflected light on dark hair and dark materials as restrained gray highlights formed by fine screentones or closely spaced ink strokes following the surface. Keep these gray highlights darker than the white paper. Reserve pure white highlights on dark surfaces for a few small glints.

Vary detail and background density to support each panel's focus. Keep important expressions and actions unobstructed.

very aesthetic, masterpiece
```

精致感来自线、黑白与信息主次，不来自全页铺满细节。默认保留实黑、中间灰和纸白三层关系：灰质反光主要限定在深色头发与材质上，反光仍暗于纸白，不要求所有高光变灰或整页铺灰。high contrast不等于只有纯黑与纯白。材料片段应随画面调整：逆光剪影可以没有五官，冲击格可以使用黑底；不能同时硬套“所有脸都纸白且五官完整”。本示例是一种可选创作偏好，不代表所有人物与场景都已通过稳定性验证。

| 画面问题 | 可补入的关系句 |
|---|---|
| 主体与背景一样重 | Use stronger contours around the main figure and finer lighter lines in the background. |
| 脸手铺灰、表情不清 | Keep the face and hands paper white with clear features. Restrict dense tone to the background and clothing shadows. |
| 黑发黏到暗背景 | Leave a narrow white separation between the black hair and dark foliage. |
| 线稿像草稿 | Use clean finished ink contours and closed solid-black shapes rather than loose construction strokes. |
| 背景抢走关键动作 | Reduce secondary marks around the expression and contact point while retaining the table edge or ground needed to understand the action. |

保留人物身份中的颜色信息，再指定黑白转译。例如棕发人物可补：Render the brown hair as a neutral light-gray tone with no colored ink. 不为黑白稿擅改人物发色。上述wool bl／saeki shun组合也是可替换示例；包括它们在内的画师标签，只在用户已选或明确采纳时使用。画师可能连带改变比例、服装和表情，不能视作只改变笔触的开关。

全局UC可从下面起步，并按当前内容删改：

```text
lowres, blurry, worst quality, very displeasing, jpeg artifacts, unfinished, sketch, watermark, signature, logo, 3d, photorealistic, painterly, watercolor (medium), shiny skin, spot color, bad anatomy, bad hands
```

有对白时不要同时加入no text；需要网点、留白、分格时不要在UC排除相应目标。用户要局部彩色时移除spot color。bad hands只是在表达排除意图，不会绑定手指或左右手。无人空镜用正向描述该格无人；不要把no humans写进负面区而反向排除“无人”。

自动质量词和UC预设也是输入的一部分，应核对是否与目标冲突。本示例建议关闭Add Quality Tags、选择UC None并使用自写UC，避免预设重新追加排除网点、多格或留白的内容；用户当前明确要求的其他有效设置优先。人物、场景、分镜、对白与文字编排按本次任务另加，不固定混入画风片段。

### 负空间

**何时使用**：孤立、停顿、突出一个落点。

**提示词构建**：用主体位置、相对面积与未填纸白构成留白。 写入位置：Base或目标格的面积关系。

**示例片段**：

```text
Keep the seated figure small in the lower-left portion. Leave most of the upper and right areas as unfilled paper white. Use the dark coat as the single strongest black shape.
```

**使用边界**：小人物与大纸白关系有支持；精确面积比例不提供硬约束。

### 透视引导线

**何时使用**：让空间线指向人物/证据。

**提示词构建**：空间线朝实际焦点汇聚，局部明度分离主体。 写入位置：背景几何与焦点。

**示例片段**：

```text
Let the pavement seams and the bases of both walls converge toward the important figure at the end of the alley. Separate the figure from the dark doorway with a clear light contour.
```

**使用边界**：引导线与焦点关系有支持；精确消失点落位不作保证。

### 黑→灰→白的格间节奏

**何时使用**：压迫、过渡、释放。

**提示词构建**：按格分配黑白占比，跨明度保留人物身份。 写入位置：按格分配，不全局同密度。

**示例片段**：

```text
Give the first panel a large solid-black background. Use limited middle-gray screentone in the second. Let the third open into broad paper white. Keep the same character recognizable through the value changes.
```

**使用边界**：黑灰白节奏有支持；身份、姿势与场所连续须分开核对。

### 对称构图

**何时使用**：仪式、秩序、正面到场。

**提示词构建**：指定轴线、主体位置与成对参照，轮廓不被中轴吞没。 写入位置：Base轴线与成对物。

**示例片段**：

```text
Center the woman on the main vertical axis between two matching stair rails. Balance the architecture on both sides while keeping her silhouette distinct from the center background.
```

**使用边界**：轴线结构有支持；严格镜面对称与人物居中精度不保证。

### 非对称平衡

**何时使用**：不等大小但有视觉平衡。

**提示词构建**：用小而黑与大而浅的重量配平，保留两者间隔。 写入位置：两侧黑白/大小及间隔。

**示例片段**：

```text
Place a compact solid-black figure on the right and a much larger pale clock face on the left. Keep a broad white interval between them so the small dark shape balances the large light shape.
```

**使用边界**：大小与明度的配平有支持；不等于可精确计算的视觉重量。

### 视线链

**何时使用**：脸→目标→回应的注意连接。

**提示词构建**：写具体视向与被看对象，再切对象和回应。 写入位置：逐格实际视向与对象。

**示例片段**：

```text
Lead from A's face looking toward the letter to a clear close-up of that letter and then to B's reaction. Keep the intended target visible in the direction of each gaze rather than asking both people to look at the viewer.
```

**使用边界**：大致注意连接有支持；眼睛是否确实看向目标不能只凭出现脸与物件判断。

### 图底反转

**何时使用**：对立、辨识、黑白切换。

**提示词构建**：明确哪边黑形白底、哪边白形黑底及轮廓间隔。 写入位置：目标轮廓与其背后明度。

**示例片段**：

```text
Set the black profile against a white field on the left and the white profile against a black field on the right. Preserve a narrow visible gap between their outlines so the faces remain separate.
```

**使用边界**：反差关系有支持；轮廓间隙与各自姿态仍可能变化。

### 重复与一次变化

**何时使用**：建立秩序后突出异常。

**提示词构建**：指定重复的尺寸间距，以及唯一改变的要素。 写入位置：同形属性、透视间距及唯一变化。

**示例片段**：

```text
Repeat the same cup shape along the table with spacing narrowing into the distance. Only the nearest cup is tipped over with a visible spill. Keep the other cups upright and unchanged.
```

**使用边界**：重复与差异有局部支持；物件数量和仅一处变化仍可能失控。

### 主辅线与密度

**何时使用**：清晰主体、完整但不抢眼的背景。

**提示词构建**：主体线重、背景细线、关键处降密与白缝形成层级。 写入位置：共同画法＋目标周围简化。

**示例片段**：

```text
Use stronger contours around the main figure and finer lighter lines for the distant shelves and masonry. Reduce background marks around the face and contact point. Keep a narrow white separation where black hair meets dark foliage.
```

**使用边界**：主辅线层次有支持；留白避让不应删掉理解动作必需的地面或桌沿。

[返回场景入口](../SKILL.md)

### 平行速度线

**何时使用**：强调一个明确的位移方向。

**提示词构建**：线方向跟随位移，动作姿态另写并保留脸肢间隔。 写入位置：目标格背景；姿态另写。

**示例片段**：

```text
Place long nearly parallel horizontal speed lines behind the leftward-running figure. Keep the face and limbs readable with white separation. The lines follow the direction of motion without replacing the running pose.
```

**使用边界**：方向线有支持；线效不能代替正确跑姿和位移结果。

### 放射集中线

**何时使用**：把注意聚向发现物/接触点。

**提示词构建**：先固定连续空间，再让放射线汇聚到对象且中心留白。 写入位置：先写共同连续空间，再写汇聚。

**示例片段**：

```text
Keep the person and open box on one continuous table in one perspective. Radiating ink lines converge toward the watch inside the box and stop at a clear white area around it. Keep the lines off the face.
```

**使用边界**：单幅连续空间与集中线有支持；盒内证据、物件形状及数量另核。

### 顺体排线与交叉排线

**何时使用**：体积、衣褶、深投影。

**提示词构建**：排线附着曲面和衣褶，交叉方向只用于最深投影。 写入位置：限定表面和第二方向。

**示例片段**：

```text
Curve the hatching around the bowl's rounded surface and along the sleeve folds. Add the second crossing direction only inside the deepest cast shadows. Keep the face and hands mostly paper white.
```

**使用边界**：顺体与交叉排线仅部分实现；容易铺满皮肤或变成无结构杂线。

### 局部网点层级

**何时使用**：区分人物、衣影与背景。

**提示词构建**：按区域分配纸白、疏点、密点与实黑。 写入位置：材料按区域分配。

**示例片段**：

```text
Keep face and hands white. Use fine sparse dots in the coat shadows and coarser denser dots on the wall behind. Render the black hair as solid ink with a few white highlights.
```

**使用边界**：区域层级有支持；细点易受分辨率影响，不能承诺具体LPI或印刷效果。

### 冲击反白

**何时使用**：接触瞬间、强黑白强调。

**提示词构建**：黑底白爆发绑定接触点，保留支撑面并限制碎片。 写入位置：目标格背景与爆发中心。

**示例片段**：

```text
Use a solid-black field with a sharp white burst centered on the contact point. Keep the support surface readable and show only a few separated fragments. Draw a single instant rather than several states of the object.
```

**使用边界**：黑白爆发有支持；接触点与物理结果并未因此稳定。

### 阴沉情绪线

**何时使用**：心理压迫、失落。

**提示词构建**：垂直阴沉线只在背景，头部留白且持物不挡脸。 写入位置：背景效果与主体白色避让。

**示例片段**：

```text
Hang dark vertical gloom bands only in the background. Leave a complete white halo around the head so all facial features remain readable. Show both hands holding the wallet low at chest level rather than floating it in front of the face.
```

**使用边界**：背景阴沉线与头部白边有局部支持；面部表演与持物仍须可见。

### 象征花卉背景

**何时使用**：温和、心动、柔和余韵。

**提示词构建**：花卉是轮廓后方的象征层，不是发饰或手持物。 写入位置：象征层在人物轮廓后。

**示例片段**：

```text
Place sparse delicate flower outlines behind the woman's silhouette and let them fade into paper white. The flowers are an emotional backdrop rather than hair ornaments or objects in her hands. Keep her face and letter unobstructed.
```

**使用边界**：花卉情绪层有支持；避免它变成新增饰物或压住证据。

[返回场景入口](../SKILL.md)
