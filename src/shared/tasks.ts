export const TASK_LABELS = {
  agent: 'Agent 操作',
  'db-update': '更新标签库',
  'db-translate': 'AI 翻译标签',
  'db-implications': '下载包含关系',
  optimize: 'AI 优化',
  preview: '画面推测',
  'inpaint-plan': '分析重绘区域',
  'page-chat': '工作台讨论',
  generate: '生成图片',
  inpaint: '局部重绘',
  'page-generate': '生成会话新版本'
} as const

export type TaskKind = keyof typeof TASK_LABELS
export type TaskStatus = 'running' | 'cancelling' | 'completed' | 'cancelled' | 'failed'
export interface AppTask {
  id: string
  kind: TaskKind
  status: TaskStatus
  message: string
  startedAt: number
  endedAt?: number
  current?: number
  total?: number
  cancelMode: 'abort' | 'after-current'
  targetId?: string
  origin?: 'agent'
  label?: string
}
export interface TaskSnapshot { revision: number; tasks: AppTask[] }
export interface AiStep { id: string; kind: 'optimize' | 'preview'; step: string }
export interface NaiStep { id: string; kind: 'generate' | 'inpaint' | 'page-generate'; step: string }
export const taskIsActive = (task: AppTask) => task.status === 'running' || task.status === 'cancelling'
