import { randomUUID } from 'node:crypto'
import {
  TASK_LABELS,
  taskIsActive,
  type AppTask,
  type TaskKind,
  type TaskSnapshot,
} from '../../../shared/tasks/model'

interface TaskOptions {
  key?: string
  resource?: 'database' | 'generation' | 'reverse'
  targetId?: string
  cancelMode?: AppTask['cancelMode']
  onCancel?: () => void
  origin?: 'agent'
  label?: string
}
interface TaskContext {
  id: string
  signal: AbortSignal
  progress: (message: string, current?: number, total?: number) => boolean
}

/** Main-process ownership keeps cancellation and resource locks independent of the visible page. */
export class TaskManager {
  private revision = 0
  private records: AppTask[] = []
  private active = new Map<
    string,
    { task: AppTask; ctrl: AbortController; options: TaskOptions; key: string }
  >()
  constructor(private publish: (snapshot: TaskSnapshot) => void) {}

  snapshot(): TaskSnapshot {
    return { revision: this.revision, tasks: this.records.map((task) => ({ ...task })) }
  }
  private changed() {
    // Retain a bounded session history, without ever pruning running tasks.
    let finished = 0
    this.records = this.records.filter((task) => taskIsActive(task) || ++finished <= 20)
    this.revision++
    this.publish(this.snapshot())
  }
  cancel(id: string): void {
    const entry = this.active.get(id)
    if (!entry || entry.task.status !== 'running' || entry.task.cancelMode === 'none') {
      return
    }
    entry.task.status = 'cancelling'
    entry.task.message =
      entry.task.cancelMode === 'after-current' ? '当前图片完成后停止，结果会保留' : '正在取消…'
    entry.ctrl.abort()
    entry.options.onCancel?.()
    this.changed()
  }
  cancelResource(resource: TaskOptions['resource']): void {
    for (const [id, entry] of this.active) {
      if (entry.options.resource === resource) {
        this.cancel(id)
      }
    }
  }
  cancelKey(key: string): void {
    for (const [id, entry] of this.active) {
      if (entry.key === key) {
        this.cancel(id)
      }
    }
  }
  clearFinished(): void {
    this.records = this.records.filter(taskIsActive)
    this.changed()
  }
  async run<T>(
    kind: TaskKind,
    work: (context: TaskContext) => Promise<T>,
    options: TaskOptions = {},
  ): Promise<T> {
    const key = options.key ?? kind
    for (const entry of this.active.values()) {
      if (entry.key === key || (options.resource && entry.options.resource === options.resource)) {
        throw new Error(`「${TASK_LABELS[entry.task.kind]}」仍在运行，请等待完成或取消`)
      }
    }
    const ctrl = new AbortController()
    const task: AppTask = {
      id: randomUUID(),
      kind,
      status: 'running',
      message: '准备中…',
      startedAt: Date.now(),
      cancelMode: options.cancelMode ?? 'abort',
      targetId: options.targetId,
      origin: options.origin,
      label: options.label,
    }
    this.active.set(task.id, { task, ctrl, options, key })
    this.records.unshift(task)
    this.changed()
    const progress: TaskContext['progress'] = (message, current, total) => {
      if (task.status !== 'running') {
        return false
      }
      Object.assign(task, { message, current, total })
      this.changed()
      return true
    }
    try {
      const result = await work({ id: task.id, signal: ctrl.signal, progress })
      // An API may resolve despite aborting; never expose such a late AI result as successful.
      if (ctrl.signal.aborted && task.cancelMode === 'abort') {
        throw new Error('已取消')
      }
      task.status = ctrl.signal.aborted ? 'cancelled' : 'completed'
      if (ctrl.signal.aborted) {
        task.message = '已停止，已完成的结果已保留'
      } else {
        if (task.message === '准备中…') {
          task.message = '已完成'
        } else {
          task.message = task.message
        }
      }
      return result
    } catch (error) {
      const cancelled = ctrl.signal.aborted && task.cancelMode === 'abort'
      task.status = cancelled ? 'cancelled' : 'failed'
      if (cancelled) {
        task.message = '已取消，已保存的内容保留'
      } else {
        task.message = String(error instanceof Error ? error.message : error).slice(0, 500)
      }
      throw cancelled ? new Error('已取消') : error
    } finally {
      task.endedAt = Date.now()
      this.active.delete(task.id)
      this.changed()
    }
  }
}
