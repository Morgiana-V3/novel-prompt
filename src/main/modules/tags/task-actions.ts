import type { IpcActions } from '../../../shared/contracts/api'
import type { UpdateProgress } from '../../../shared/tags/types'
import { aiTranslate } from '../prompts/translator'
import { getSettings } from '../settings/service'
import type { TaskContext } from '../tasks/context'
import { Cancelled, updateImplications, updateTagDatabase } from './fetcher'
import { tagStore } from './store'

export function createTagsActions(context: TaskContext) {
  const { tasks, send } = context

  const database = (
    kind: 'db-update' | 'db-translate' | 'db-implications',
    work: (report: (progress: UpdateProgress) => void, signal: AbortSignal) => Promise<void>,
  ) =>
    tasks.run(
      kind,
      async ({ signal, progress }) => {
        const report = (progress2: UpdateProgress) => {
          progress(progress2.message, progress2.current, progress2.total)
          send('progress', progress2)
        }
        try {
          await work(report, signal)
          if (signal.aborted) {
            report({ stage: 'done', message: '已取消，已保存的数据保留' })
          }
          return tagStore.status()
        } catch (error) {
          if (signal.aborted || error instanceof Cancelled) {
            report({ stage: 'done', message: '已取消，已保存的数据保留' })
          } else {
            report({
              stage: 'error',
              message: String(error instanceof Error ? error.message : error),
            })
          }
          throw error
        }
      },
      { resource: 'database' },
    )
  return {
    'task:cancel': () => tasks.cancelResource('database'),
    'db:update': () =>
      database('db-update', async (report, signal) => {
        await updateTagDatabase(getSettings().minPostCount, report, signal)
        report({ stage: 'index', message: '正在构建索引…' })
        tagStore.load()
        report({ stage: 'done', message: '数据更新完成' })
      }),
    'db:aiTranslate': () =>
      database('db-translate', async (report, signal) => {
        try {
          await aiTranslate(getSettings().translateMinCount, report, signal)
        } finally {
          tagStore.refreshTranslations()
        }
      }),
    'db:implications': () =>
      database('db-implications', async (report, signal) => {
        const count = await updateImplications(tagStore.names(), report, signal)
        tagStore.loadImplications()
        report({ stage: 'done', message: `包含关系下载完成，共 ${count.toLocaleString()} 条` })
      }),
  } satisfies Partial<IpcActions>
}
