import type { TaskSnapshot } from '../../shared/tasks/model'
import { invoke } from './bridge'

export const tasksApi = {
  tasksList: (): Promise<TaskSnapshot> => invoke('tasks:list'),
  tasksCancel: (id: string): Promise<void> => invoke('tasks:cancel', id),
  tasksClear: (): Promise<void> => invoke('tasks:clear'),
}
