import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  reactive,
  ref,
  watch,
  type WatchStopHandle,
} from 'vue'
import { createCanvasSession, type CanvasSession } from './session'
import { runningCards } from './operations'
import { reportError, toast } from '../../shared/lib/notifications'

interface ProjectTab {
  id: string
  name: string
  session: CanvasSession
  revision: number
  saved: number
  saving: boolean
}
export function useCanvasProjects() {
  const tabs = ref<ProjectTab[]>([])
  const activeId = ref('')
  const active = computed(() => tabs.value.find((tab) => tab.id === activeId.value)!)
  const watchers = new Map<string, WatchStopHandle>()
  let serial = 0
  let opening = false
  function add(name: string, session: CanvasSession, id = crypto.randomUUID()) {
    const tab = reactive({ id, name, session, revision: 0, saved: 0, saving: false })
    tabs.value.push(tab)
    activeId.value = id
    watchers.set(
      id,
      watch(
        () => [tab.session.operations, tab.session.images, tab.session.camera],
        () => {
          tab.revision++
        },
        { deep: true },
      ),
    )
  }
  function create() {
    add('未命名画布 ' + ++serial, createCanvasSession())
  }
  async function open() {
    if (opening) {
      return
    }
    opening = true
    try {
      const id = crypto.randomUUID()
      const result = await window.canvasApi.openProject(id)
      if (result) {
        add(result.name, result.session, id)
      }
    } catch (error) {
      reportError(error)
    } finally {
      opening = false
    }
  }
  async function save(saveAs = false) {
    const tab = active.value
    if (tab.saving) {
      return false
    }
    tab.saving = true
    try {
      await nextTick()
      const revision = tab.revision
      const name = await window.canvasApi.saveProject(
        tab.id,
        tab.name,
        JSON.parse(JSON.stringify(tab.session)),
        saveAs,
      )
      if (!name) {
        return false
      }
      tab.saved = revision
      tab.name = name
      toast('已保存 ' + name)
      return true
    } catch (error) {
      reportError(error)
      return false
    } finally {
      tab.saving = false
    }
  }
  function processing(tab: ProjectTab) {
    return tab.saving || tab.session.operations.some((node) => runningCards.has(node))
  }
  async function close(id: string) {
    const index = tabs.value.findIndex((tab) => tab.id === id)
    const tab = tabs.value[index]
    if (!tab) {
      return
    }
    if (processing(tab)) {
      toast('请等待当前操作完成')
      return
    }
    if (
      tab.revision !== tab.saved &&
      !window.confirm('关闭「' + tab.name + '」并放弃未保存的更改？')
    ) {
      return
    }
    await window.canvasApi.closeProject(id)
    watchers.get(id)?.()
    watchers.delete(id)
    tabs.value.splice(index, 1)
    if (!tabs.value.length) {
      create()
    } else if (activeId.value === id) {
      activeId.value = tabs.value[Math.min(index, tabs.value.length - 1)].id
    }
  }
  function unload(event: BeforeUnloadEvent) {
    if (tabs.value.some((tab) => processing(tab) || tab.saved !== tab.revision)) {
      event.preventDefault()
      event.returnValue = false
    }
  }
  function shortcut(event: KeyboardEvent) {
    if (!(event.ctrlKey || event.metaKey) || event.altKey) {
      return
    }
    const key = event.key.toLowerCase()
    if (!['s', 'o', 'n', 'w'].includes(key)) {
      return
    }
    event.preventDefault()
    if (event.repeat) {
      return
    }
    if (key === 's') {
      save(event.shiftKey).catch(reportError)
    }
    if (key === 'n') {
      create()
    }
    if (key === 'o') {
      open().catch(reportError)
    }
    if (key === 'w') {
      close(activeId.value).catch(reportError)
    }
  }
  create()
  onMounted(() => {
    window.addEventListener('keydown', shortcut, true)
    window.addEventListener('beforeunload', unload)
  })
  onBeforeUnmount(() => {
    window.removeEventListener('keydown', shortcut, true)
    window.removeEventListener('beforeunload', unload)
    for (const stop of watchers.values()) {
      stop()
    }
  })
  return { tabs, activeId, active, create, open, save, close }
}
