import type { McpTool } from './server'

export const TOOL_GROUPS = {
  core: '指南、状态、任务与恢复（始终保留）',
  tags: '标签检索与提示词检查',
  workspace: '后台工作台、需求、版本与区域管理',
  frontend: '窗口操作与前台工作台',
  images: '图库、生图与局部重绘',
  ai: '委托软件内置 AI',
  skills: '读取和管理提示词规则'
} as const
export type ToolGroup = keyof typeof TOOL_GROUPS
const CORE = new Set(['agent_guide', 'get_app_state', 'list_tasks', 'cancel_task', 'configure_tools', 'get_operation'])
const TAGS = new Set(['search_tags', 'validate_tags', 'related_tags', 'tag_wiki', 'analyze_prompt'])
const AI = new Set(['optimize_prompt', 'preview_prompt', 'plan_inpaint'])
export function toolGroup(name: string): ToolGroup {
  if (CORE.has(name)) return 'core'
  if (name.startsWith('ui_') || ['navigate_app', 'apply_app_prompt'].includes(name)) return 'frontend'
  if (name.includes('workspace')) return 'workspace'
  if (TAGS.has(name)) return 'tags'
  if (AI.has(name)) return 'ai'
  if (name.includes('skill') || name === 'prompt_guide') return 'skills'
  return 'images'
}
export function groupCatalog(tools: McpTool[]) {
  return Object.entries(TOOL_GROUPS).map(([id, description]) => ({ id, description, tools: tools.filter(t => toolGroup(t.name) === id).map(t => t.name) }))
}
