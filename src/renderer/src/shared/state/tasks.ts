import { taskIsActive, type TaskKind, type TaskSnapshot } from '@shared/tasks/model'
import { reactive } from 'vue'
import { cleanErr } from '../lib/format'
import { toast } from '../lib/notifications'

export const taskState = reactive<TaskSnapshot>({ revision: -1, tasks: [] })
export function receiveTasks(snapshot: TaskSnapshot) {
  if (snapshot.revision <= taskState.revision) {
    return
  }
  taskState.revision = snapshot.revision
  taskState.tasks = snapshot.tasks
}
export function connectTasks(): () => void {
  const off = window.api.onTasks(receiveTasks)
  // Subscribe before fetching; revision guards prevent an older snapshot overwriting live progress.
  void window.api
    .tasksList()
    .then(receiveTasks)
    .catch((candidate) => toast(`任务状态读取失败：${cleanErr(candidate)}`))
  return off
}
export const activeTask = (kind: TaskKind) =>
  taskState.tasks.find((task) => task.kind === kind && taskIsActive(task))
export async function cancelTask(id: string): Promise<void> {
  try {
    await window.api.tasksCancel(id)
  } catch (error) {
    toast(`取消失败：${cleanErr(error)}`)
  }
}
