import { AGENT_GUIDE_TOPICS, agentGuide } from '../agent-guide'
import { READ_ONLY, json } from '../tool-input'
import type { McpTool } from '../types'

export const AGENT_GUIDE = `# NovelPrompt 提示词工作指南（给外部 agent）

本指南只指导提示词任务。软件能力、前后台选择与工作台操作顺序先读 agent_guide；通过工作台回复方案时按工具的 JSON schema 写回，不使用下述分节文本替代接口参数。

本工具返回两部分：先是这份使用说明，然后是「Skill 使用总则」和用户在软件里为 AI 优化功能启用的 Skill（按优先级排列）。Skill 也是软件内置 AI 的系统提示词：其中要求输出 JSON、填写 assessment / changes 字段的部分只针对内置 AI，你交付给用户时按本说明的格式；其余规则（语法、编排、角色提示词、负面、依据）同样适用于你，多份 Skill 冲突时按总则的优先级处理。本说明里的语法与格式要求优先于 Skill。

## 工作流
1. 理解范围：区分用户已确定的内容、允许调整的部分和你想新增的建议。检查现有提示词时只修本次的问题。
2. 拆概念后一次性 search_tags（角色、作品、画师用 category 限定；中文搜不到换英文）。近义词拿不准用 tag_wiki；涉及具体角色、画师用 related_tags。
3. 按 Skill 编排：Base、角色提示词、UC 分开；tag 表达不了的关系（数量、左右、谁对谁做什么）写成英文短句，句内不用逗号，以句号结尾。
4. 用 analyze_prompt 传入完整内容和实际参数复查，逐条处理报告：修正，或向用户说明保留理由。改过的部分再查一次即可，不要为了零警告反复循环。
5. 交付前对照原要求：用户写明的内容都还在；被删掉或改写的原有内容要说明原文和理由；新增的画师、饰物、年龄体型、动作只作为可选建议。

## 交付格式
默认用分节文本（用户可以直接粘贴进 NovelPrompt，会自动拆分到各输入框；也可以照着填进 NovelAI）：

\`\`\`
[Prompt]
2girls, artist:xxx, outdoors, cherry blossoms, ...

[Character 1 @ B3]
girl, silver hair, red eyes, white dress, smile

[Character 1 Undesired Content]
black hair, glasses

[Character 2 @ D3]
girl, black hair, short hair, glasses, school uniform

[Undesired Content]
lowres, worst quality, bad quality, ...
\`\`\`

- 分节标题是 NovelPrompt 的导入格式，不是 NAI 语法。没有位置时写 [Character 1]；空的分节直接省略，不要用说明文字占位。
- 另附：模型版本、建议画幅、Add Quality Tags 与 UC 预设是否开启；关键改动及依据；可选建议。

## 工具参数要点
- analyze_prompt / generate_image 的 version 只有 v4.5 / v5（Full 模型）；quality_tags 为布尔值（Standard 档）；uc_preset 为 heavy / light / human / none。Curated、Effort 等官网选项本工具没有提供，不要假称已设置。省略的参数会用软件默认值，说明结论时注明。
- 角色 position 只支持 A1~E5 网格或 "0.3,0.5" 坐标，其他写法会被忽略。
- read_image_prompt 读出的是实际发送的内容（已含质量词和 UC 预设）；角色位置正好在网格中心时返回网格，否则返回原坐标。
- search_tags / validate_tags / related_tags / tag_wiki 单次上限分别为 20 / 80 / 6 / 8 项，超出部分不处理，返回末尾会列出未处理项。
- 画面文字写成 \`Text: 文字\`，放在所在提示词的最末尾；source# / target# / mutual# 只写在角色提示词里；英文短句句内不用逗号。

## Skill 管理
- list_skills 查看全部 Skill（启用状态、优先级、作用范围、适用模型）；get_skill 读取正文。
- 内置 Skill（id 以 builtin: 开头）只读，只能启用 / 关闭 / 调整优先级，或用 duplicate_from 复制成用户 Skill 再改。
- 按用户的要求增删改 Skill、调整启用与优先级；改完告诉用户改了什么。

## 内置 AI 结果的复核
optimize_prompt / preview_prompt 调用内置 DeepSeek，消耗用户额度；用了也要复核结果：
- dropped：optimize 模式下被删掉且没有说明的原有内容；semantic 模式没有原提示词可比，为 null，需要你对照描述逐项核对。
- fidelity：必须逐字保留却被改写的画面文字（Text: 块），不为空时把原文恢复后再交付。
- invalid 为空只代表 tag 都存在，不代表语义要求都保住了。

## 生图（用户明确要求时）
1. 先 nai_subscription 确认免费额度可用（Opus 会员、总像素 ≤ 1024×1024、步数 ≤ 28、V5 还要看免费额度）。
2. generate_image 必须传 confirm: true。这是接口要求，不能代替用户授权。需要对比改词效果时固定 seed。
3. 返回 stopped 不为空时（额度不足、检测到扣费、未开启生图权限）停止并如实告知，不要换参数绕过。
4. 能看图时打开图片对照检查。文本审查完成、拿到图片、画面符合要求是三件事，分别说明。

---

`

export function createAgentGuideTool(): McpTool {
  return {
    name: 'agent_guide',
    title: '外部 Agent 能力与操作指南',
    description:
      '首次接入先读：能力地图、何时用后台/前台、外部 Agent 与内置 AI 的区别、工作台和重绘操作流程、冲突恢复及限制。overview 为默认入口；操作工作台前读 workflows。提示词规则另读 prompt_guide/inpaint_guide 或本轮冻结 Skill。',
    inputSchema: {
      type: 'object',
      properties: {
        topic: {
          type: 'string',
          enum: AGENT_GUIDE_TOPICS,
          description: '默认 overview；按需读取其他章节，all 返回完整指南。',
        },
      },
    },
    annotations: READ_ONLY,
    run: async (argumentsRecord) => json(agentGuide(argumentsRecord.topic)),
  }
}
