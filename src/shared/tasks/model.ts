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
  'page-generate': '生成会话候选',
  'reverse-analyze': '本地图片识别',
  'reverse-score': '比较画面风格',
  'reverse-install': '准备识别模型',
  'reverse-remove': '删除识别模型',
  'update-check': '检查应用更新',
  'update-download': '下载应用更新',
  'page-cleanup': '清理项目图片',
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
  cancelMode: 'abort' | 'after-current' | 'none'
  targetId?: string
  origin?: 'agent'
  label?: string
}
export interface TaskSnapshot {
  revision: number
  tasks: AppTask[]
}
export interface AiStep {
  id: string
  kind: 'optimize' | 'preview'
  step: string
}
export interface NaiStep {
  id: string
  kind: 'generate' | 'inpaint' | 'page-generate'
  step: string
}
export const taskIsActive = (task: AppTask) =>
  task.status === 'running' || task.status === 'cancelling'
