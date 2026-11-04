import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { shellState } from '../../shared/state/shell'

/** Dismiss the settings surface without discarding the shared generation parameters. */
export function useSettingsPopover() {
  const open = ref(false)
  const dock = ref<HTMLElement>()
  const trigger = ref<HTMLButtonElement>()

  function owns(target: EventTarget | null) {
    if (!(target instanceof Element)) {
      return false
    }
    if (dock.value?.contains(target)) {
      return true
    }
    // Select menus are portaled to body; their owning combobox remains in this dock.
    const menu = target.closest('.theme-select-menu')?.querySelector('[role="listbox"]')
    return !!menu?.id && !!dock.value?.querySelector(`[aria-controls="${CSS.escape(menu.id)}"]`)
  }

  function outside(event: Event) {
    if (open.value && !owns(event.target)) {
      open.value = false
    }
  }

  function keydown(event: KeyboardEvent) {
    if (!open.value || event.key !== 'Escape' || event.defaultPrevented) {
      return
    }
    if (dock.value?.querySelector('.theme-select[aria-expanded="true"]')) {
      return
    }
    event.preventDefault()
    event.stopImmediatePropagation()
    open.value = false
    trigger.value?.focus({ preventScroll: true })
  }

  watch(
    () => shellState.tab,
    () => {
      open.value = false
    },
  )
  onMounted(() => {
    document.addEventListener('pointerdown', outside, true)
    document.addEventListener('focusin', outside)
    window.addEventListener('keydown', keydown)
  })
  onBeforeUnmount(() => {
    document.removeEventListener('pointerdown', outside, true)
    document.removeEventListener('focusin', outside)
    window.removeEventListener('keydown', keydown)
  })
  return { open, dock, trigger }
}
