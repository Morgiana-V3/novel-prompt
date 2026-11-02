import { statistics } from '../statistics/service'
import type { IpcActions } from '../../../shared/contracts/api'
import type { TaskContext } from './context'

export function createTasksActions(context: TaskContext) {
  const { tasks } = context

  return {
    'statistics:get': () => statistics.snapshot(),
    'statistics:clear': () => statistics.clear(),
    'tasks:list': () => tasks.snapshot(),
    'tasks:cancel': (id: string) => tasks.cancel(id),
    'tasks:clear': () => tasks.clearFinished(),
  } satisfies Partial<IpcActions>
}
