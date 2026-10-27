import { ref, type Ref } from 'vue'
import type { Region, RegionBackup } from './model'
export const backupRegion = (region: Region): RegionBackup => ({
  annotated: region.annotated,
  anchor: region.anchor,
  baseMask: region.baseMask,
  instruction: region.instruction,
  target: region.target,
  strokes: [...region.strokes],
  hasPixels: region.hasPixels,
  plan: region.plan,
  checked: [...region.checked],
  accepted: region.accepted,
  number: region.number,
})

export function useMaskHistory(status: Ref<string>, isBlocked: () => boolean) {
  const lastRemoval = ref<{ label: string; restore: () => void } | null>(null)
  function remember(label: string, restore: () => void) {
    lastRemoval.value = { label, restore }
    status.value = label + '，可按 Ctrl+Z 或点击画布下方「撤销」恢复。'
  }
  function restoreRemoval() {
    const removal = lastRemoval.value
    if (!removal || isBlocked()) {
      return
    }
    lastRemoval.value = null
    removal.restore()
    status.value = '已撤销：' + removal.label
  }
  return { lastRemoval, remember, restoreRemoval }
}
