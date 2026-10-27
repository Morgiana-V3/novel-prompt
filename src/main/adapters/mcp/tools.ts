import { AGENT_ENTRY } from './agent-guide'
import { inpaintTools } from './inpaint-tools'
import { createAgentGuideTool } from './tools/guides'
import {
  createGenerateImageTool,
  createListImagesTool,
  createNaiSubscriptionTool,
  createReadImagePromptTool,
} from './tools/images'
import {
  createAnalyzePromptTool,
  createOptimizePromptTool,
  createPreviewPromptTool,
  createPromptGuideTool,
} from './tools/prompts'
import { skillTools } from './tools/skills'
import { createTagTools } from './tools/tags'
import type { McpTool } from './types'

/* ---------- 工具 ---------- */

/**
 * 给外部 agent 的入口说明。本软件不再往 agent 目录安装 Skill：
 * 提示词规范由用户在软件里启用的 Skill 组合而成（按优先级），agent 通过 prompt_guide 读取。
 */
export const MCP_INSTRUCTIONS = `${AGENT_ENTRY}

写、查、改 NovelAI 提示词先读取 prompt_guide；局部重绘读取 inpaint_guide；接管工作台读取 get_workspace_context 中本轮冻结的 Skill。实际处理前阅读相关完整规则，按用户启用的优先级执行。
tag 使用 search_tags / validate_tags 的依据；保留用户明确的语义，完成后 analyze_prompt 复查。生成须有用户明确授权并传 confirm:true，返回 stopped 则停止。optimize_prompt / preview_prompt / plan_inpaint 调用内置 AI 并消耗额度；外部 Agent 通常自行推理。
工具参数以 tools/list 为准，能力选择、操作顺序与恢复方式以 agent_guide 为准。`

export function buildTools(): McpTool[] {
  return [
    createAgentGuideTool(),
    ...inpaintTools(),
    createPromptGuideTool(),
    ...skillTools(),
    createAnalyzePromptTool(),
    ...createTagTools(),
    createOptimizePromptTool(),
    createPreviewPromptTool(),
    createNaiSubscriptionTool(),
    createGenerateImageTool(),
    createListImagesTool(),
    createReadImagePromptTool(),
  ]
}
