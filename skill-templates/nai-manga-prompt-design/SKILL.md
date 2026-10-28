---
name: 黑白日式漫画
description: 用于黑白日式漫画的分镜、镜头、动作连续、黑白画法与对白编排，包含专项技法和完整提示词例句。
scope: all
model: all
---

# 黑白日式漫画

## 何时使用

仅在当前任务涉及黑白日式漫画、漫画风单幅、多格分镜或相关提示词评估时应用。全文随本 Skill 提供；其他画风和无关任务不执行漫画规则，也不强加黑白、漫画格或画师。V5 与 V4.5 的差异按本页对应主题处理，不把示例说成稳定配方。

**示例转换边界**：代码块里的 [Prompt]、[Character …]、[Undesired Content] 等是字段分节标记，不是生成文本。复制时逐字段拆开，Text 到本字段结束即止；下一字段标题和说明绝不能接入上一段 Text。标签之间及标签与完整英文句子之间用逗号分隔，句内不用逗号；Text 原文标点不改。技法、画师、材料和参数示例只用于当前任务明确选用的部分，不能整段无条件套用。

## 始终遵守

- 保留用户的人物、事件、左右关系、道具、台词与已有有效参数。“同一物件”“同一时刻”等连续性限定应保留并补充可见证据，不能当成无效描述删除。示例中的物件、画师和故事可以替换，不能直接当作用户设定。
- 只将本次所需的可见画面关系写进提示词，不把整份 Skill 或技法清单塞进 Base。
- 遵守软件当前功能的字段与输出协议。只需修改一处时给出替换片段；仅要求评估时不要重写整套输入，更不自行生图。
- 未看到返图时只做推测；参考例句不保证正确分格、手别、准确文字或跨页连续性。
- 明确的画面左右关系必须保留在最终描述中；发型、衣服或名字可辅助辨认，不能替代左右。没有要求换机位时不自行换镜头以解释左右变化；“右侧人物”不等于“用右手”。
- 同一物件的身份与数量是两项独立约束：`single` 只说明数量，跨格还需 `the same ... from the previous panel` 等指代来保留身份。替换片段里必须写出这层关系，不能只在中文说明中声称保留。
- 用于本软件的英文关系句以句号结束，句内不用逗号；tag 与完整句子之间才用逗号分隔。示例用于理解技法，移入实际字段前仍按当前解析规则整理。

## 任务范围与交付复核

评估已有片段或只替换一句时，只应用问题对应的规则，直接给出判断与最小替换；不顺带创建 Base、角色块、坐标、UC，也不为已确定的自然语言关系查词。完整分镜编排才组合布局、镜头、动作、对白等必要规则；不因画面包含某元素就展开所有技法。

交付前对照实际提示词逐格核对：取景范围内是否能看到所写的身体部位；剪影是否又写了眼睛与面部细节；坐标与左右描述是否一致；同一时刻的主格和插格是否指向同一动作接触点；台词是否真的写在说明中的说话者末尾。发现矛盾时改实际字段，不能只在说明中声称已修正。说明必须依据最终字段整理：没有写入的对白、动作或技法不要宣称已经实现。

## 执行流程

核心规则、技法和全部示例已在本页，无需读取参考文件。以下编号表示执行先后；后面的技法索引是并列选项，不是必须叠加的清单。

1. **确定范围与保留项**：区分完整创作、整体优化、仅评估、局部替换或返图修正；记录人物身份、服装、道具数量及身份、左右、动作结果、台词原文、格数与明确禁止项。
2. **组织画面单元**：完整页面先确定主格和插格数量、读序、每次出场、取景和字区；局部修改沿用原结构，不增设格子或角色。
3. **建立可见关系**：只选择服务目标的镜头、格框、动作、黑白与文字手段。明确接触与分离、持有与释放、同一物件、前后时刻；同刻插格复用主格的事实。
4. **写入实际字段**：按当前功能契约分配 Base 与区域单元，按空间顺序排列数组；标签以已有查询为据，关系句使用完整英文；Text 原文只放所属字段末尾。
5. **核对交付**：逐项对照保留项与实际字段，检查画面左右、身份服装、身体可见范围、物件唯一性、格数与插格、对白归属及逐字符原文；用户只要一个片段就只给一个。
6. **区分推测与实图**：无图只报告有依据的目标与风险；有图逐项检查技法、事件、读路和文字，失败仍按失败记录。只有明确要求生成时才执行已授权的生图操作。

## 本页主题索引

| 当前需求 | 对应主题 |
|---|---|
| 完整输入与整体评估 | [输入组织与评估](#输入组织与评估) |
| 持物、手别、接触及跨格连续性 | [动作与连续性](#动作互动与连续性) |
| 格框、出格、插格与读序 | [格框与页面](#格框与页面) |
| 景别、裁切、遮挡与镜面 | [镜头与取景](#镜头与取景) |
| 黑白层次、网点与线效 | [黑白画法与线效](#黑白画法主次与线效) |
| Text、载体、竖排与拟声字 | [文字与对白](#文字输入与对白载体) |
| 完整字段组合 | [完整组合示例](#完整组合示例) |

本模板补充漫画设计方法，不覆盖当前功能的字段、解析和输出契约。已启用的三套内置规则仍按任务适用：编排处理修改与校验，预览处理证据边界，局部重绘处理选区和最小修改。完整加载不代表自动执行其他功能。

完整方案先按出场单元确定格位、身份、动作与接触点、持物状态、可见范围和台词归属，再写对应字段。主格与同刻插格共用同一接触事实；最终说明从这些字段整理，不能另写一套格号或说话者。只修改片段时沿用用户现有关系，不要求输出整张单元表。

格数先说明是否包含插格，不能宣称“五格”却描述五个主格再加一个插格。用户允许“大概”时可说明实际总数及取舍。角色数组按画布从上到下、同排从左到右排列，日式从右向左的读序写入布局而不改变数组排序。多次出场重复一致的身份和可见服装锚点，不只依赖角色名；取景之外的细节不堆入局部特写。水、烟、速度线等效果不能替代人物身体或服装的描述。

用户只要一个替换片段时，只给一个核对完成的版本，不再附缩短版或替代机位。片段明确保留用户要求的状态：空手不只写张开或松手，远离物件不只写结束动作；身份、数量、颜色、左右分别核对，不能在说明中补偿片段遗漏。

工作台完整方案按当前程序契约提交：`proposal.draft` 只含提示词字段；`proposal.execution` 与 `draft` 同级，不放入 `draft` 内。执行描述是供之后审核使用的方案元数据，填写它不代表已执行生图。“只给方案”仍可输出完整方案对象；纯讨论或局部替换则可用回复文本且 `proposal:null`。

## 输入组织与评估

## 功能

本Skill供NovelPrompt的提示词助手使用：把用户的故事、画面要求或漫画技法，转换成可直接使用的NovelAI提示词。默认目标是精致、完成稿程度的黑白日式漫画，兼顾人物造型、互动、姿态、对白、分镜与页面设计。

## 适用场景

当用户的需求涉及以下内容时使用，并按当前问题选择相关章节：

- **从描述生成提示词**：将故事片段、单幅画面或多格页面要求，整理成可使用的NovelAI输入。
- **实现具体漫画技巧**：把空镜、出格、插格、斜格、镜头切换、时间衔接、黑白主次或对白排法，转换为具体画面关系。
- **编排人物与互动**：区分人物身份和多次出场，描述姿势、接触、持物、动作结果，并安排相容的画布位置。
- **优化已有提示词**：保留原人物、事件与台词，调整Base、人物条件、UC、坐标和文字的组织，解决相互冲突或含糊的表达。
- **生图前推测与风险分析**：根据完整输入描述预期画面，定位可能影响分格、人物、动作、黑白主次或文字的冲突与歧义，并给出保留原意的修改建议。
- **根据返图修正表达**：针对已观察到的错格、串人、动作不清、框线关系错误、视觉主次或文字归属问题，提出有针对性的替换词句。

输入可以是自然语言意图、已有提示词、人物设定、分镜描述或参考／返图；用户不必先知道技法名称。只有画面描述时，交付构词建议；提供了返图时，再结合实际可见问题修正，不把文字推测写成已经看见的结果。

主要适用于NovelAI V5与V4.5的漫画提示词编写。文字和位置等能力按正文中的版本说明处理；技法示例以V5为主。单幅漫画风画面与多格漫画页都可使用，按实际需求选择相应内容。

## 使用方式与交付

根据本页主题索引定位规则；专项选用索引与正文相邻，可按画面目的定位技法。各项是按需选用的设计手段，没有必须依次执行的顺序；也不应把所有技法叠进一张图。技巧需要服务用户的表达，例如等待可以用连续空镜或消耗物变化，突然发现可以用眼部反应格或集中线，未必同时使用。

本页完整包含概念、组织方法、例句和使用边界。按本次任务选用相关规则，不再依赖工具补读。不要把Skill全文当作生图Base；应将选中的画面关系改写进本次输入。

保留用户指定的人物、服装、道具、左右、台词与已有有效参数。例子里的茶杯、信、衣服和场所是可替换的示例，不是用户作品设定。未指定的发饰、刘海、衣领和背景物，不应因照抄示例变成既定设计。

交付以实际提示词为主。完整需求给出Base、必要的人物正负面与位置、全局负面；只改一个画面关系时给出可替换片段即可。解释简述本次选用的技法及其作用。NovelPrompt内置助手遵守当前功能要求的输出格式；外部文本可用本文示例的分节表示字段，分节标题本身不属于生成词。

用户要求预览、推测或评估已有输入时，采用[生图前的画面推测与风险建议](#生图前的画面推测与风险建议)：交付忠实的画面概述、主要风险及对应修改片段，按当前功能的输出格式表达。用户只要评估时，不强行重写整套提示词。

文中“有成图支持”“曾出现”等描述是原稿对有限历史样本的记录，不是本轮重新验证的结论；没有对应图片与实验条件时，不把它们写成当前已实测证据。画框、构图或文字载体出现，不代表人物动作、准确文字和整页故事同时正确。具体限制写在各技法后；候选写法不应被介绍成稳定配方。若用户要求生成验证，可对同一候选查看2–3张，分别判断技法、事件、读路和成稿质量，不能只挑一张说明稳定。

### Base、人物条件与负面提示各自承担什么

| 输入部分 | 适合承担的内容 | 组合原则 |
|---|---|---|
| Base／全局正向 | 不同人物身份数量、共同画法、场所、格组、阅读方向、共享空间，以及当前功能允许的简短事件骨架 | 页面结构与局部条件相容，不能只写版式而丢掉画面发生的事 |
| 人物正向 | 本次出场可见的外貌、服装、表情、姿态、动作对象、格位、景别和对应台词 | 描述这一次出现，不把同人的所有时刻挤进一条 |
| 人物负面 | 容易串入的另一人物特征，或本次出场不该出现的对象 | 只排除实际冲突，避免误排自身或同格必要内容 |
| 位置／position | 对应人物或物件在整幅画布上的中心建议 | 位置服务已描述的格区，不充当格框或骨架 |
| 全局负面／UC | 不要的媒介、画面缺陷和全页不应出现的内容 | 不排除当前需要的文字、网点、留白或漫画分格 |

单人单幅可以把完整内容写在Base中。需要区分外貌、动作、持物或台词时，再拆人物条件。同格双人通常各一条；同一人物在另一格再出现，可以另设一次出场条件。Base里的人数描述按不同身份理解，人物条目则可能按出场次数增加。三个出场条件不一定代表三个不同人物。

人物类型中的girl／boy不等于年龄设定；成年须明确写进对应语义。没有准确且已确认的年龄tag时，用完整句子如 She is an adult woman. 或 He is an adult man.，不把 adult woman／adult man 片段冒称为已验证tag。other可承载物件或非人物条件，但不是专用的漫画格控制接口。手部特写只描述手、袖口或裸前臂及对象，不为了强调身份把脸又补入裁切；背景也不必把每件物品都拆成独立条目。

常用组织是Base写“布局＋简短事件骨架”，人物条件补本次出场细节。若当前功能明确要求逐格细节只放人物区，则把完整的格位、景别与状态放进对应条目，Base保留共同布局；不能因此漏写事件。全Base与按出场拆分都有适用情形，不以字段越多、Base越短或固定模板判断效果好坏。Panel编号、条目数量和other类型都不能硬切出对应格区。

同一事件在Base与人物区出现时，前者写共同关系，后者写所属人物的行为，不能各写一套互相冲突的状态。例如Base写两人在同一桌边交换一张纸，局部再明确谁递出、谁接住，而不是给每人各写“一张自己的纸”。

### 用可见关系描述画面，而不是只给技法名

tag适合表达人物、物件、姿态和常见画法；自然语言适合表达所属、时间、遮挡、接触、相对大小、框线和读路。技法名不能代替这些关系。写“出格”还需要明确谁从哪条边伸出、遮住哪段线、其他部位留在哪里。

可按当前需要表达以下关系，它们是构词维度，不是必做清单：

| 要控制的内容 | 应说清的关系 |
|---|---|
| 格框 | 哪个格、哪条边、格与格如何相接、沟槽是否连续、外框是否保留 |
| 取景 | 谁在镜头前、谁只露背面或局部、什么必须可见、什么在裁切外 |
| 动作 | 谁用哪个部位对哪个对象做什么、接触在哪里、当前完成到什么状态 |
| 时间 | 同一时刻放大，还是前后事件；变化与不变的地标分别是什么 |
| 平面主次 | 主体与背景的面积、明度、线条密度、留白和避让 |
| 文字 | 哪一格、谁的原话、什么载体、放哪里、怎样排列、泡尾指向谁 |

页面几何放Base；某格的低角度、剪影或情绪线限定到该格。想要眼部窄格时，不把全局写成“全页只有眼睛”；想要下格出框，也不让所有人物都越框。自然语言用短句，明确主语，避免一句同时塞入多个时刻。

### 位置服务格区，不负责制造格框

V5自由坐标采用整幅画布归一化位置：左上为(0,0)，右下为(1,1)。它是中心建议，不是格内坐标、手掌端点、眼睛位置、格框端点、区域遮罩或姿势骨架。

根据文字描述的格区，把本次出场中心放在相容区域。若已知格左上为(x₀,y₀)，宽高为(w,h)，格内相对位置为(u,v)，画布中心可按(x₀+u×w, y₀+v×h)估算。这个换算只帮助安排中心，不把格区变成硬边界。

例如“上右双人小格→上左手部小格→下通栏双人”，上右两人可先放(0.82,0.20)与(0.62,0.20)，上左手部约(0.25,0.20)，下格两人约(0.72,0.70)与(0.28,0.70)。这是该版式的例子，不是所有页面的默认点位。

同刻互动的两个人要处于同一格区；后续时刻的出场放到后续格区。两个角色中心重合不保证融合，也不提供分组标识；跨时刻全部挤在一点容易混状态。对角摆放中心只会暗示主体分布，不会自动产生斜格。需要斜框就描述框线，需要倾斜机位就描述相机。

在本工具使用的位置机制中，全部位置留空会关闭坐标；任一合法位置启用整组，其他空项会补到横向中带。选择显式定位时要检查整组，不能假设未填条目仍完全不受坐标影响。V4.5使用A1–E5网格：列A至E从左到右，行1至5从上到下，中心约为0.1、0.3、0.5、0.7、0.9；例如A1约(0.1,0.1)，C3约(0.5,0.5)。不要把V5任意自由点位原样当作V4.5接口能力。

### 参数与使用边界

一种研究用起点是Full、832×1216、23步、Guidance 5、Euler Ancestral、Rescale 0，自动质量关闭、UC None。V5多用native噪声计划；V4.5在上述组合的有限比较中，karras比native得到更清楚的成像，可作新任务尝试起点，不能推成所有输入的最佳配置。已有有效参数优先。

画幅要给镜头与字区足够容量：横向大场面可使用宽画幅，窄条反应格则描述局部裁切，不把整幅分辨率直接当作某格尺寸。给出的参数与关系句不能保证硬格区、精确手别、跨页同物件或任意长句。

如果使用查词或分析功能，把结果用于核对词义、语法和输入完整性；词频、分析通过和没有告警都不是视觉成功。本文的自然语言关系可以直接使用，不需要为每个设计术语发明新tag。不要为消除身份数／出场数告警删掉必要出场。优化后的输入应保留用户原来的事件、台词和可见证据。

## 技法片段的使用方式

下列英文块是可嵌入当前输入的示例片段，不是完整生图请求。它们继承[输入组织](#base人物条件与负面提示各自承担什么)、[黑白材料](#成稿黑白画法与主次)和当前故事的人物设定；A／B、物件、方向、格位及时间都应替换成实际要求。几何类片段需配上各格事件，文字类需接所属原文。示例中的“不要”是正向关系句的一部分，不应整句照搬到UC。

### 生图前的画面推测与风险建议

适用于用户询问“这套词大概会画成什么”“哪里容易出问题”“当前提示能否表达这个分镜”，以及NovelPrompt的画面推测功能。判断依据是当前完整输入与用户意图；没有实际返图时，只能描述预期、歧义和风险，不能宣称已经生成、看见或验证某个结果。

**画面概述须忠实于输入**。结合Base、人物正负面、位置、Text和已知自动追加项，说明主要版式、各次出场、当前动作与物件状态、黑白主次和文字安排。准确保留衣色、人数、左右、持有人、动作部位及台词归属；区分不同身份与重复出场。输入没有写明的内容标为未指定，不用想象的情节补成确定画面。只知道部分参数或提示时，应把判断限定在这些已知内容。

**风险应有具体依据**。指出是哪段表达、哪两个条件或哪个画面容量问题，可能造成什么偏差。以下是按需检查的维度，不要求每次全部列出：

| 判断维度 | 需要关注的具体关系 |
|---|---|
| 格区与边界 | 格数、读序与事件是否相容；出格、裁切、无框与出血是否混用；效果是否限定到所属格 |
| 人物与造型 | 身份和出场是否混数；造型是否串入；优化建议是否擅自增加衣饰、改变年龄外观或删除必要出场 |
| 动作与连续 | 谁主动、谁接触、谁持物是否清楚；进行态与完成态是否冲突；取景能否容纳所需接触、支撑或结果证据 |
| 位置与共享空间 | 同刻互动是否落在同格区；后续状态是否挤到同一处；未填位置是否可能受到整组补点影响 |
| 黑白与视觉主次 | 目标是否有足够面积和明度分离；背景、网点或线效是否会压住表情、接触点及读路 |
| 文字与版本 | 原文、载体、说话者、字区和读序是否对应；UC或自动项是否与文字冲突；所用模型能力是否匹配 |

区分“输入已经自相矛盾”“表达存在多种解释”和“关系虽清楚但模型执行仍不稳定”。前两类可以直接定位语句；后一类结合本文具体使用边界提示可能失真，不能编造成功率，也不能把某个场景的失败推成所有场景必败。关系句只出现在自然语言中，不表示模型必然忽略；Base与局部重复事实，不表示必然增人。girl／boy类型本身也不与正文已写的成年设定冲突。

**修改建议须保留原目标**。每条建议对应所指出的问题，优先提供可替换的关系句；可以明确对象、补足可见状态、解除冲突或调整相容位置。不通过删除“只有指定部位”等边界、改变用户指定左右、缩改台词或接受错误动作来宣称满足。不要为所谓稳定性添加未经用户确定的造型，也不要只靠加权、堆同义词或删comic承诺控制格数。

需要精确tag替换时，依据实际可用的查词结果；没有查词依据时给出自然语言关系或语义方向，不把未核实的词标成标准tag。参数建议使用当前已知模型与设置，不虚构接口能力。保留原要求的后排字、排框或局部制作可以作为可选成稿方案，但应与提示词修改分开说明。

**交付方式**：用简短的预期画面概述，以及确实存在的主要风险和相应修改建议回应。每条风险交代依据与可能影响；有必要改词时附实际替换片段。没有发现明确冲突时可以如实说明，并保留具体执行边界，不为凑满栏目制造问题。只输出当前问题需要的内容，不重复整个技法库；有实图时，另外说明哪些是实际观察，哪些仍属推测。

例如，用户目标是末格“接收者独自持杯”，当前输入却是：

```text
Panel 2 shows the completed transfer. Both women still hold the same cup.
```

可以指出：完成交接的抽象说法与双方仍持杯的具体状态不一致，这段输入更可能表达共同持杯，尚不能清楚传达接收者独持。保留原目标的替换片段为：

```text
In Panel 2 the receiving woman alone holds the same cup. The giving woman's hands are empty and separated from the cup. Keep the hands and cup visible so the completed transfer can be read directly.
```

这项修改消除了持有人状态的冲突，但仍不能保证生成时杯子数量、手别或指形正确；没有返图时不能把这些细节判为已经通过。

## 动作、互动与连续性

### 时间与连续：选用索引

| 技法与章节 | 适合的画面意图 |
|---|---|
| [同机位重复](#同机位重复) | 比较姿势、物态或距离的变化。 |
| [正反打](#正反打) | 轮换对话注意，同时维持空间。 |
| [预备→接触→结果](#预备接触结果) | 让动作有因果、看得出完成。 |
| [瞬间延长](#瞬间延长) | 迟疑、将触未触、微小反馈。 |
| [时间省略](#时间省略) | 跳过不必逐步展示的过程。 |
| [用消耗物暗示经过](#用消耗物暗示经过) | 沉默等待、时间流逝。 |
| [两地平行剪接](#两地平行剪接) | 并行动作、赶赴与等待。 |
| [同刻不同侧面](#同刻不同侧面) | 场所氛围、观察而非推进。 |
| [形状匹配切换](#形状匹配切换) | 跨空间建立视觉呼应。 |
| [回忆与返回现实](#回忆与返回现实) | 把过去与当前区分。 |
| [动作接力](#动作接力) | 让手势和物件接续读路。 |
| [页末隐藏信息](#页末隐藏信息) | 让答案暂时不在可见范围。 |
| [下一页揭示](#下一页揭示) | 兑现前一页隐藏的事实。 |

### 人物互动、手别与动作结果

互动需要可见的角色职责和身体路径。描述发起者、使用部位、目标、接触方式以及此刻的状态；空闲手、支撑面和持物数量在有歧义时补明。两个角色都写holding不一定能分清谁抓谁、谁托谁。

有效动作tag可在人物正向中配source#／target#；对等参与可用mutual#。使用时双方采用同名动作，不编造动作名；未使用前缀时仍保留准确关系描述。是否必须使用前缀，按用户要求、当前接口协议与启用Skill的优先级决定。这些前缀表达动作角色，不是可以编号配对的身份ID；也不能代替具体接触句。

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

只有用户要求或接受换机位时才据此重新安排画面方向。用户已指定某格的左右关系时，替换片段仍明确写 image-left / image-right，发型或姓名只作辅助定位。交接结果同时检查“同一唯一物件、当前独持者、原持有者已松开且空手”；不能为了缩句遗漏其中任一用户限定。区分画面方位与身体手别，不从“右边女子”推断她必须用右手。

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

[返回场景入口](#黑白日式漫画)

## 格框与页面

### 格框与页面：选用索引

| 技法与章节 | 适合的画面意图 |
|---|---|
| [连续空镜](#连续空镜) | 等待、停顿、场所痕迹，让物件承接情绪。 |
| [指定部位出格](#指定部位出格) | 强调手势、冲出或情绪越界。 |
| [共享斜边的斜格](#共享斜边的斜格) | 冲突、斜向运动、不安。 |
| [同刻物件插格](#同刻物件插格) | 主画面保留空间和表演，同时放大证据。 |
| [规则四格](#规则四格) | 清楚的比较、节奏和顺序。 |
| [非对称面积层级](#非对称面积层级) | 小格铺垫、大格揭示。 |
| [纵向跨行格](#纵向跨行格) | 高度、攀爬、长动作轮廓。 |
| [中部横向通栏](#中部横向通栏) | 格组之间放一个主要事件或景观。 |
| [错列格区](#错列格区) | 减少十字岔路、形成明确格组。 |
| [邻近分组与宽沟槽](#邻近分组与宽沟槽) | 相关事件成组、组间停顿。 |
| [无框情绪格](#无框情绪格) | 弱化边界、留住表情或余韵。 |
| [出血主格](#出血主格) | 空间冲击、重要揭示。 |
| [不规则碎裂框](#不规则碎裂框) | 突发冲击、画框本身失衡。 |
| [景物贯穿多格](#景物贯穿多格) | 连续空间里分配时间/注意。 |
| [连续叠格](#连续叠格) | 阶段连续，同时有前后图层。 |
| [双页大场面](#双页大场面) | 跨页尺度与横向空间。 |

### 连续空镜

**何时使用**：等待、停顿、场所痕迹，让物件承接情绪。

**提示词构建**：杯与窗是一个连续视域；该格无人，避免分别写成两个镜头。 写入位置：Base写指定格的连续视域；需要定位时用other物件条目。

**示例片段**：

```text
Panel 2 is one continuous shallow view of a single teacup on the table against one rainy window. The cup and window share one undivided panel. No people or body parts appear in this panel.
```

需要物件条件时可写other, teacup, table, window, rain，再附该格的连续视域句。整页组合见[三格示例](#三格对话与连续空镜)。

**使用边界**：连续无人视域有成图支持；位置与物件句的组合有效，不能把作用单独归给other。

### 指定部位出格

**何时使用**：强调手势、冲出或情绪越界。

**提示词构建**：明确所属格、穿过哪条边、遮住哪段框线及允许到达的范围。 写入位置：Base写框线关系；outside border和动作归所属出场。

**示例片段**：

```text
Only the raised right hand from the lower panel extends above that panel's top border into the white gutter. Hide the short border segment directly behind the hand and keep the border visible on both sides. The hand stops inside the gutter. Her face and shoulders remain below that border.
```

**使用边界**：局部越框出现过，精确遮线与只让目标部位越框仍不稳定；out of frame常表示被画面裁掉。

### 共享斜边的斜格

**何时使用**：冲突、斜向运动、不安。

**提示词构建**：同时定义分隔线方向、两侧共享斜率与外框形状。 写入位置：Base。人物位置与两块格区相容。

**示例片段**：

```text
Divide the page into two panels with one diagonal white gutter descending from the upper-left toward the lower-right. Both facing panel edges follow the same slant. Keep the page's outer border rectangular.
```

**使用边界**：共享斜边能出现；精确端点、角度和三角区域不能当作已锁定。

### 同刻物件插格

**何时使用**：主画面保留空间和表演，同时放大证据。

**提示词构建**：写插格覆盖位置、不透明底、同物件与同一时刻。 写入位置：Base写压叠与时间；物件近景可用other。

**示例片段**：

```text
A small rectangular inset overlaps the upper-right corner of the large panel. It shows the same teacup on the same table at the same moment. Give the inset a thin black border and opaque white backing that hides the underlying background. Leave the woman's face and hands unobstructed.
```

**使用边界**：插格结构能出现；同一物件的形状、数量与时间对应仍须独立核对。

### 规则四格

**何时使用**：清楚的比较、节奏和顺序。

**提示词构建**：写两行两列、等沟槽、对齐与读序，再配各格事件。 写入位置：Base几何＋四个事件。

**示例片段**：

```text
Arrange exactly four rectangular panels as two rows of two. Keep the gutters even and the outer edges aligned. Read the upper-right then upper-left before moving to the lower row.
```

**使用边界**：规则骨架有支持；准确格数与事件仍可能被增格或合并破坏。

### 非对称面积层级

**何时使用**：小格铺垫、大格揭示。

**提示词构建**：写小格组与主格的面积关系，最重要证据给主格。 写入位置：Base指定哪组小、哪个大及内容。

**示例片段**：

```text
Place three small preparation panels across the upper part of the page. A single much larger panel fills the lower part and carries the main reveal. Give the reveal enough space for the full expression and essential object.
```

**使用边界**：面积层级能出现；主次成立不代表各动作及顺序正确。

### 纵向跨行格

**何时使用**：高度、攀爬、长动作轮廓。

**提示词构建**：说明长格所在侧、跨行范围与另侧小格堆叠。 写入位置：Base；人物中心放实际长格区。

**示例片段**：

```text
One tall narrow panel occupies the full height of the left side. Two smaller panels are stacked on the right. The vertical panel spans both tiers and shows the complete climbing figure.
```

**使用边界**：长格跨行有支持；上下动作端点和身体支撑仍要核对。

### 中部横向通栏

**何时使用**：格组之间放一个主要事件或景观。

**提示词构建**：明确中格横跨两列及上下格组，总格数与内容相容。 写入位置：Base明确五格的层级。

**示例片段**：

```text
Use five panels arranged as two small panels at the top followed by one full-width horizontal panel in the middle and two small panels at the bottom. The middle panel spans both columns.
```

**使用边界**：横向通栏结构有支持；不能保证每张都保持总格数与事件归属。

### 错列格区

**何时使用**：减少十字岔路、形成明确格组。

**提示词构建**：上下层格宽互换，竖沟槽错位而横向分层清楚。 写入位置：Base格宽关系。

**示例片段**：

```text
Use two tiers with a narrow right panel and a wide left panel on the upper tier. Reverse those widths on the lower tier. Keep the horizontal gutter continuous and offset the two vertical gutters.
```

**使用边界**：错列结构有支持；仍应明确读序，不用错位暗示所有阅读关系。

### 邻近分组与宽沟槽

**何时使用**：相关事件成组、组间停顿。

**提示词构建**：区分组内窄沟槽与组间大白带，白带不围框。 写入位置：Base描述组内与组间空间。

**示例片段**：

```text
Keep the three related panels in each group close together with narrow gutters. Separate the two groups with a broad band of unframed white page space. Do not enclose that white band in a new rectangular panel.
```

**使用边界**：分组能出现，但大白带曾被围成额外空框；不能把错误空框算作成功停顿。

### 无框情绪格

**何时使用**：弱化边界、留住表情或余韵。

**提示词构建**：只解除目标格边框，保留纸白过渡与邻格分离。 写入位置：只限定目标画格。

**示例片段**：

```text
Remove the enclosing rectangular border from the lower portrait. Let its outer edges dissolve into the page's paper white. Preserve clear white separation from the framed panel above.
```

**使用边界**：无框肖像融入纸白有支持；仍可能多出细条框。

### 出血主格

**何时使用**：空间冲击、重要揭示。

**提示词构建**：指定触达的页边与无白边范围，脸字留裁切安全距离。 写入位置：Base指定触达哪些页边和安全区。

**示例片段**：

```text
Let the large bridge scene extend directly to the top and both side edges of the page without an outer white margin or enclosing border. Keep faces and dialogue safely away from the trim edges.
```

**使用边界**：触边与无框能实现，也有重新加外框的样本；精确裁切安全区不保证。

### 不规则碎裂框

**何时使用**：突发冲击、画框本身失衡。

**提示词构建**：不规则的是格框外轮廓和随形沟槽，不只是画中碎片。 写入位置：Base强调不规则的是外边。

**示例片段**：

```text
Give this panel an irregular jagged outer silhouette with broken angular edges. The surrounding white gutter follows those edges. Keep the impact drawing inside that shape rather than drawing a normal rectangle around it.
```

**使用边界**：属于候选写法；易变成矩形框内的破裂图案而非不规则外边。

### 景物贯穿多格

**何时使用**：连续空间里分配时间/注意。

**提示词构建**：一个连续全景由框线切分，建筑线跨沟槽对齐。 写入位置：共同透视和框线切割关系。

**示例片段**：

```text
Draw one continuous panoramic street view and divide it with three vertical panel frames. Align the horizon and architectural lines across all gutters. Each building appears only once rather than repeating a new street view in every panel.
```

**使用边界**：属于候选写法；易重复多个完整街景，跨沟槽建筑不一定连续。

### 连续叠格

**何时使用**：阶段连续，同时有前后图层。

**提示词构建**：指定后来格覆盖先前格的位置，白底遮住底层线条。 写入位置：Base遮挡顺序＋逐格状态。

**示例片段**：

```text
Place each later panel partly over one corner of the previous panel. Its opaque white backing hides the earlier border and drawing underneath. Show the folded umbrella then the opening umbrella and finally the fully open umbrella in that order.
```

**使用边界**：属于候选写法；前后遮挡与逐阶段状态均可能混合。

### 双页大场面

**何时使用**：跨页尺度与横向空间。

**提示词构建**：宽画幅与连续场景配合，中央装订带避开关键证据。 写入位置：宽画幅、中央装订带和关键对象分布。

**示例片段**：

```text
Compose one continuous wide scene across a double-page spread. Reserve the central binding strip for simple secondary background. Place faces and important evidence on the outer page areas rather than directly over the fold.
```

**使用边界**：宽景有支持；中央装订带避让和跨页锁形未稳定。

[返回场景入口](#黑白日式漫画)

## 镜头与取景

### 镜头与取景：选用索引

| 技法与章节 | 适合的画面意图 |
|---|---|
| [环境建立格→近景](#环境建立格近景) | 进入新场所、交代尺度和人物距离。 |
| [眼部窄条反应格](#眼部窄条反应格) | 惊觉、迟疑、识别变化。 |
| [同框前后景人物](#同框前后景人物) | 距离、紧张、关系不对等。 |
| [第一人称主观镜头](#第一人称主观镜头) | 跟随角色观察、拿取、判断。 |
| [越肩镜头](#越肩镜头) | 对话、展示照片/线索、保留双方位置。 |
| [低机位仰角与尺度](#低机位仰角与尺度) | 高大建筑、压迫、人物仰望。 |
| [正上俯视](#正上俯视) | 交代平面位置和人物分布。 |
| [倾斜机位](#倾斜机位) | 不安、失衡、突然的心理变化。 |
| [逆光剪影](#逆光剪影) | 到场、陌生感、轮廓识别。 |
| [门缝遮挡](#门缝遮挡) | 局部窥视、有限信息。 |
| [镜面中的同人正反面](#镜面中的同人正反面) | 同刻展示实人背面和镜中表演。 |

### 环境建立格→近景

**何时使用**：进入新场所、交代尺度和人物距离。

**提示词构建**：远景交代支撑面与地标，近景保留同一地标。 写入位置：对应格的Base事件句或出场条件。

**示例片段**：

```text
The first panel is a wide view of the bridge and both riverbanks. Show the woman standing on the bridge deck with her feet supported by it. The next panel moves closer to her face while retaining the same railing behind her.
```

**使用边界**：远景与近景能形成；人物是否真正站在桥上等支撑关系不自动正确。

### 眼部窄条反应格

**何时使用**：惊觉、迟疑、识别变化。

**提示词构建**：分别写窄浅格形、双眼眉部裁切及鼻口在框外。 写入位置：格形写Base；裁切写对应出场。

**示例片段**：

```text
Use one very shallow horizontal reaction panel. Crop tightly around both eyes and eyebrows. Keep the nose and mouth outside this strip. Let the eyes dominate the entire narrow panel.
```

**使用边界**：眼部窄格能出现；仍可能露鼻或多生成细条格。

### 同框前后景人物

**何时使用**：距离、紧张、关系不对等。

**提示词构建**：近远人物的尺寸、左右和明度对照，同时处于连续空间。 写入位置：Base共同空间＋两条人物条件。

**示例片段**：

```text
The near woman occupies a large dark silhouette on the image right. The other woman appears much smaller in the distant left background. Leave a visible gap between them while keeping both in one continuous space.
```

**使用边界**：同一空间的前后景大小关系有成图支持；比例不等于精确距离。

### 第一人称主观镜头

**何时使用**：跟随角色观察、拿取、判断。

**提示词构建**：写观察者眼位、从底缘进入的双手及前方环境。 写入位置：该格事件；手或对象定位可用other。

**示例片段**：

```text
Show the scene through the observer's eyes. Their two hands enter from the lower corners holding one unfolded map. The path remains visible beyond the map in the same view. Do not show the observer's face.
```

**使用边界**：主观视域与入画双手有支持；地图或路径细节不保证正确。

### 越肩镜头

**何时使用**：对话、展示照片/线索、保留双方位置。

**提示词构建**：区分近处只见肩背的人与对面露脸的人，证据避开遮挡。 写入位置：前肩与远人的两次出场条件及共同关系句。

**示例片段**：

```text
A dark shoulder and the back of a head fill the near right edge. Across the table the other woman's face and the photograph she holds remain clearly visible. The foreground shoulder does not cover either her expression or the photograph.
```

**使用边界**：肩背与远处脸的层次有支持；照片等证据的具体内容另行判断。

### 低机位仰角与尺度

**何时使用**：高大建筑、压迫、人物仰望。

**提示词构建**：写低处向上、竖线收束、脚底支撑与建筑尺度。 写入位置：对应画格的相机句。

**示例片段**：

```text
Place the camera close to street level looking upward. The building's vertical edges converge above the woman. Include her feet on the pavement and enough of the building to make their difference in scale clear.
```

**使用边界**：仰角与尺度感有支持；全身裁切、脚底和道具形状仍可能失真。

### 正上俯视

**何时使用**：交代平面位置和人物分布。

**提示词构建**：写从头顶垂直向下及地面平面图式，不展示正面五官。 写入位置：对应画格相机句。

**示例片段**：

```text
Look vertically down at the crown of her head and her shoulders. The paving forms a flat plan beneath her. Her face is not visible from this overhead viewpoint.
```

**使用边界**：头顶俯视有支持；严格90度与精确投影不作保证。

### 倾斜机位

**何时使用**：不安、失衡、突然的心理变化。

**提示词构建**：房间线随相机旋转，格框仍直立；坐标斜排不能替代。 写入位置：相机句；外框另说明。

**示例片段**：

```text
Tilt the camera clockwise so the room's vertical edges lean across the image. Keep the enclosing panel a normal upright rectangle. Her feet still rest naturally on the floor.
```

**使用边界**：机位倾斜而外框直立有支持；旋转方向和落脚仍可能不准。

### 逆光剪影

**何时使用**：到场、陌生感、轮廓识别。

**提示词构建**：主体内部实黑、轮廓可辨、背景亮；去掉该格的五官冲突句。 写入位置：指定出场与背景对比。

**示例片段**：

```text
Render the figure as one solid black silhouette against the bright paper-white greenhouse. Preserve a readable outer contour and narrow light gaps between the limbs. Do not draw interior facial features.
```

**使用边界**：实黑主体与亮场有支持；肢间亮缝和全身裁切可能不全符合。

### 门缝遮挡

**何时使用**：局部窥视、有限信息。

**提示词构建**：不透明门板遮人，缝隙只露指定部位，不另开完整脸特写。 写入位置：Base遮挡关系＋对应出场可见范围。

**示例片段**：

```text
An opaque foreground door hides almost the entire observer. Through the narrow bright gap between the door and frame show only one eye and a slim slice of cheek. Do not add a separate face inset.
```

**使用边界**：局部窥视关系有支持；门缝宽度与眼部裁切不提供硬边界。

### 镜面中的同人正反面

**何时使用**：同刻展示实人背面和镜中表演。

**提示词构建**：实人背部与镜框内同人正面对应，服装发型与时刻一致。 写入位置：共同镜面/相机句＋两次视图。

**示例片段**：

```text
The camera sees the woman's back in front of one rectangular mirror. Inside the mirror show the front of that same woman at the same moment. Keep the reflection entirely inside the mirror frame and match her hair and clothing.
```

**使用边界**：同人实像与镜像结构能出现；逐手逐指未稳定，不机械要求两视图交换屏幕左右。

[返回场景入口](#黑白日式漫画)

## 黑白画法、主次与线效

### 平面设计与黑白主次：选用索引

| 技法与章节 | 适合的画面意图 |
|---|---|
| [负空间](#负空间) | 孤立、停顿、突出一个落点。 |
| [透视引导线](#透视引导线) | 让空间线指向人物/证据。 |
| [黑→灰→白的格间节奏](#黑灰白的格间节奏) | 压迫、过渡、释放。 |
| [对称构图](#对称构图) | 仪式、秩序、正面到场。 |
| [非对称平衡](#非对称平衡) | 不等大小但有视觉平衡。 |
| [视线链](#视线链) | 脸→目标→回应的注意连接。 |
| [图底反转](#图底反转) | 对立、辨识、黑白切换。 |
| [重复与一次变化](#重复与一次变化) | 建立秩序后突出异常。 |
| [主辅线与密度](#主辅线与密度) | 清晰主体、完整但不抢眼的背景。 |

### 线效与情绪：选用索引

| 技法与章节 | 适合的画面意图 |
|---|---|
| [平行速度线](#平行速度线) | 强调一个明确的位移方向。 |
| [放射集中线](#放射集中线) | 把注意聚向发现物/接触点。 |
| [顺体排线与交叉排线](#顺体排线与交叉排线) | 体积、衣褶、深投影。 |
| [局部网点层级](#局部网点层级) | 区分人物、衣影与背景。 |
| [冲击反白](#冲击反白) | 接触瞬间、强黑白强调。 |
| [阴沉情绪线](#阴沉情绪线) | 心理压迫、失落。 |
| [象征花卉背景](#象征花卉背景) | 温和、心动、柔和余韵。 |

### 成稿黑白画法与主次

以下是这份模板提供的一种可替换画风示例，不代表用户已确认的偏好。示例搭配V5 Full、关闭Add Quality Tags、UC预设None和下方自定义UC；这些是创作建议，不自动修改软件参数。只有用户选择该方案时才采用。用户明确指定其他画风或已有设置时，以当前要求为准。将本次人数放在画师之前，补充场所、事件和人物条件；此片段本身不包含具体故事。单幅漫画风插画可去掉comic，并将首句的manga page改为manga illustration，避免强加分格。

```text
0.7::artist:wool bl::, 0.8::artist:saeki shun::, greyscale, comic, screentones, high contrast,

A black-and-white manga page with clean finished ink linework and crisp tapered contours. The drawing uses solid black shapes with distinct mid-gray screentones and clean paper white. Expressive anime-style faces with economical facial lines.

Use fine regular screentones selectively for flat tones and selected shadows. Use structural hatching only where useful. Keep the deepest shadows solid black. Render reflected light on dark hair and dark materials as restrained gray highlights formed by fine screentones or closely spaced ink strokes following the surface. Keep these gray highlights darker than the white paper. Reserve pure white highlights on dark surfaces for a few small glints.

Vary detail and background density to support each panel's focus. Keep important expressions and actions unobstructed.

very aesthetic, masterpiece
```

精致感来自线、黑白与信息主次，不来自全页铺满细节。用户采用本示例画风时，保留实黑、中间灰和纸白三层关系：灰质反光主要限定在深色头发与材质上，反光仍暗于纸白，不要求所有高光变灰或整页铺灰。high contrast不等于只有纯黑与纯白。材料片段应随画面调整：逆光剪影可以没有五官，冲击格可以使用黑底；不能同时硬套“所有脸都纸白且五官完整”。本示例是一种可选创作偏好，不代表所有人物与场景都已通过稳定性验证。

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

[返回场景入口](#黑白日式漫画)

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

[返回场景入口](#黑白日式漫画)

## 文字输入与对白载体

### 对白与文字载体：选用索引

| 技法与章节 | 适合的画面意图 |
|---|---|
| [双人气泡读路](#双人气泡读路) | 明确先后与说话人。 |
| [旁白框](#旁白框) | 时间、地点或不属于嘴部发声的叙述。 |
| [画外声](#画外声) | 来源在画外而当前人物仍可见。 |
| [思考泡](#思考泡) | 内心疑问、未说出口。 |
| [喊叫泡](#喊叫泡) | 明确的一次强发声。 |
| [耳语虚线泡](#耳语虚线泡) | 轻声、保密、低音量。 |
| [同人连接双泡](#同人连接双泡) | 同一人的话分成两个可读单元。 |
| [中文单列竖排](#中文单列竖排) | 窄高字区、日式页漫。 |
| [中文双列与列序](#中文双列与列序) | 单列过长、需要两列清楚排列。 |
| [较长对白的宽泡与横排](#较长对白的宽泡与横排) | 保留原句和可读字号，不挤成细长列。 |
| [跨框气泡](#跨框气泡) | 将一处对白有意跨沟槽。 |
| [大拟声字](#大拟声字) | 声音的方向、力度和主次。 |
| [环境拟声](#环境拟声) | 雨滴、小响动等场景声音。 |

### 文字内容、载体与排法

Text放在其所属提示的最末，后面不再接tag或说明。台词中的逗号、标点和用户换行属于原文，不能按tag分隔符处理。不同文字块用空行分开；块内真实换行可表达预期排法。排法仍需要文字描述说明，换行本身不保证分泡或字序。

V5可处理中文、日文与英文。Base集中Text与人物条件末尾Text都有可用情形，沿用当前有效组织，不无故在两处重复原文。具体归属按用户要求、当前接口协议与启用Skill的优先级决定；采用任一组织时，Text均须在所属字段末尾，并明确文字与人物或画格的对应关系。每段内容要明确格位、说话人、载体与字区，尤其是同格多人、多泡和跨格对白。

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

本例可接[综合文字说明中的长句载荷](#文字内容载体与排法)。四行是该例排法，按原句和字区调整，不能擅自删改原文。

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

[返回场景入口](#黑白日式漫画)

## 完整组合示例

### 完整输入参考

| 示例 | 查阅目的 |
|---|---|
| [三格对话与连续空镜](#三格对话与连续空镜) | 查看页面骨架、同格双人、重复出场、物件中心、局部UC与短对白怎样一起组织 |
| [单幅墨线成稿](#单幅墨线成稿) | 查看无需分格的画面怎样用全Base描述黑白材料、人物姿态与背景主次 |

这些完整输入用于说明字段怎样拼合，均为V5示例。示例中的场所、人物与台词供替换，不是固定模板。以下保留历史输入中的画风与UC以对应当时的成图支持，并非当前默认；编写新任务时，仅在用户选用该画风后参考“成稿黑白画法与主次”；它是可选方案，不是用户已采纳的默认。具体格子的特殊光影要求优先。替换后的组合需要重新判断效果，不能沿用历史样本宣称已经验证。保留过往可用组合不等于每个动作、字形或跨场景变体都已经稳定。

### 三格对话与连续空镜

这一组合把两位不同身份、四次人物／物件出场条件、上中下格区与对应文字放在一起。Base描述布局和简短事件，局部补所属出场；中格是一幅无人连续视域，末格重复短发人物。人物条目数量不能当作身份人数。

本例使用832×1216、23步、Guidance 5、Euler Ancestral、native、Rescale 0，自动质量关闭、UC None。三格、无人中格与短中文有成图支持；不据此保证任意人物和故事的同样输入都成功。

```text
[Prompt]
2girls, comic, greyscale, screentones, speech bubble, text, chinese text, very aesthetic, masterpiece, Finished black-and-white Japanese manga artwork. Use tapered ink contours and solid black shapes. Keep paper-white faces and use fine bounded screentones only in selected shadows. Render the brown hair as a neutral light gray tone with no colored ink. A three-panel manga page read from top to bottom. All three panels span the full page width. Panel 1 occupies the top third. Two adult women sit across a cafe table. The long-haired woman with glasses is on the right and invites the bob-haired woman on the left to sit. Panel 2 is one continuous shallow horizontal view of a single untouched teacup resting on the table against one rainy window. This is a silent object cutaway without any people or body parts. The cup and window share one undivided panel. Panel 3 occupies the bottom third. A close-up of the bob-haired woman's relaxed smile answers the invitation. Keep clear white gutters and rectangular black panel borders. Each text balloon stays inside its panel and avoids faces.

[Character 1 @ 0.28,0.18]
girl, bob cut, brown hair, black shirt, short sleeves, sitting, serious, looking at another, Panel 1 at the top. She listens to the woman on her right.

[Character 1 Undesired Content]
glasses, long hair

[Character 2 @ 0.72,0.18]
girl, long hair, black hair, glasses, white shirt, long sleeves, sitting, smile, looking at another, Panel 1 at the top. She invites the woman on her left to sit. One speech balloon belongs to her. Text: 坐这里。

[Character 2 Undesired Content]
bob cut

[Character 3 @ 0.5,0.5]
other, teacup, table, window, rain, Panel 2 at the middle. One untouched cup and its rainy window backdrop are in the same uninterrupted frame. This area contains no people.

[Character 4 @ 0.45,0.82]
girl, bob cut, brown hair, black shirt, short sleeves, close-up, smile, Panel 3 at the bottom. She answers the invitation with one speech balloon. Text: 好。

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
1girl, long hair, black hair, glasses, collared shirt, white shirt, long sleeves, laughing, closed eyes, holding chopsticks, bento, no text, greyscale, screentones, high contrast, Finished black-and-white Japanese manga artwork. Use controlled tapered ink contours and solid black shapes. Keep skin paper white while retaining clear facial features. Apply fine bounded screentones only to selected shadows. Use sparse structural hatching and simplify the background around faces and hand contact. A single upper-body manga view of one adult woman enjoying lunch beneath a cherry tree. Her loose black hair forms a clean solid silhouette and her plain white collared shirt has long sleeves without a neck bow. She laughs naturally with closed eyes and an open mouth. Her right hand holds one pair of chopsticks beside her mouth and her left hand supports one open bento at chest height. Keep the five fingers of each visible hand readable. Use a few thin pale blossom branches behind her head. Leave her hair free of extra ornaments., very aesthetic, masterpiece

[Undesired Content]
lowres, blurry, jpeg artifacts, unfinished, sketch, watermark, signature, logo, 3d, photorealistic, painterly, watercolor (medium), spot color, shiny skin, bad anatomy, bad hands
```

这个示例使用no text，因为它明确要求无字画面。需要台词时删除该词，并安排字区、归属和原文。单幅构成可以借用负空间、线重和局部网点等设计，但没有必要同时增加时间链或页面格框。

[返回场景入口](#黑白日式漫画)
