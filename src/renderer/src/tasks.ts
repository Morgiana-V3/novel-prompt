import { reactive } from 'vue'
import { taskIsActive, type TaskKind, type TaskSnapshot } from '@shared/tasks'
import { cleanErr, toast } from './store'

export const taskState = reactive<TaskSnapshot>({ revision: -1, tasks: [] })
export function receiveTasks(snapshot: TaskSnapshot) {
  if (snapshot.revision <= taskState.revision) return
  taskState.revision = snapshot.revision
  taskState.tasks = snapshot.tasks
}
export function connectTasks(): () => void {
  const off = window.api.onTasks(receiveTasks)
  // Subscribe before fetching; revision guards prevent an older snapshot overwriting live progress.
  void window.api.tasksList().then(receiveTasks).catch(e => toast(`任务状态读取失败：${cleanErr(e)}`))
  return off
}
export const activeTask = (kind: TaskKind) => taskState.tasks.find(t => t.kind === kind && taskIsActive(t))
export async function cancelTask(id: string): Promise<void> {
  try { await window.api.tasksCancel(id) } catch (e) { toast(`取消失败：${cleanErr(e)}`) }
}
