import {
  TASK_LABELS,
  type AppTask,
  type TaskKind,
  type TaskSnapshot,
} from '../../shared/tasks/model'

/**
 * 任务完成提醒：窗口不在前台时，需要等待的任务结束后发系统通知并闪烁任务栏。
 * 用户正在看着软件时不打扰；很快结束的任务和后台小事不提醒。
 */

/** 需要等待、值得提醒的任务；Agent 杂项、清理、检查更新等不提醒 */
const NOTIFY_KINDS = new Set<TaskKind>([
  'generate',
  'inpaint',
  'page-generate',
  'optimize',
  'preview',
  'inpaint-plan',
  'page-chat',
  'reverse-analyze',
  'reverse-score',
  'reverse-install',
  'db-update',
  'db-translate',
  'db-implications',
])
/** 短于这个时长的任务不提醒，用户多半还没离开 */
export const NOTIFY_MIN_MS = 3000

export interface NotifierWindow {
  isFocused(): boolean
  isMinimized(): boolean
  isVisible(): boolean
  flashFrame(flag: boolean): void
  show(): void
  focus(): void
  once(event: 'focus', listener: () => void): void
}

export interface TaskNotifierOptions {
  window: () => NotifierWindow | null
  enabled: () => boolean
  notify: (message: { title: string; body: string; onClick: () => void }) => void
}

export function taskNotice(task: AppTask): { title: string; body: string } | null {
  if (!NOTIFY_KINDS.has(task.kind) || !['completed', 'failed'].includes(task.status)) {
    return null
  }
  if (!task.endedAt || task.endedAt - task.startedAt < NOTIFY_MIN_MS) {
    return null
  }
  const label = task.label || TASK_LABELS[task.kind]
  if (task.status === 'failed') {
    return { title: `${label}失败`, body: task.message || '请回到 NovelPrompt 查看原因' }
  }
  const detail = task.message && !['已完成', '准备中…'].includes(task.message) ? task.message : ''
  return { title: `${label}已完成`, body: detail || '点击回到 NovelPrompt 查看结果' }
}

export function createTaskNotifier(options: TaskNotifierOptions) {
  const announced = new Set<string>()
  let primed = false
  return (snapshot: TaskSnapshot) => {
    const ended = snapshot.tasks.filter((task) => task.endedAt)
    // 启动后第一次快照里已经结束的任务是历史记录，不补发
    if (!primed) {
      primed = true
      ended.forEach((task) => announced.add(task.id))
      return
    }
    for (const task of ended) {
      if (announced.has(task.id)) {
        continue
      }
      announced.add(task.id)
      const notice = taskNotice(task)
      const win = options.window()
      if (!notice || !win || !options.enabled()) {
        continue
      }
      if (win.isFocused() && win.isVisible() && !win.isMinimized()) {
        continue
      }
      win.flashFrame(true)
      win.once('focus', () => win.flashFrame(false))
      options.notify({
        ...notice,
        onClick: () => {
          win.show()
          win.focus()
        },
      })
    }
    // 只记住快照里还在的任务，避免长时间运行后无限增长
    const present = new Set(snapshot.tasks.map((task) => task.id))
    for (const id of announced) {
      if (!present.has(id)) {
        announced.delete(id)
      }
    }
  }
}
