# 黑白画风示例

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
