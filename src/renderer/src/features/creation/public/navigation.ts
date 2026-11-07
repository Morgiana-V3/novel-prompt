import { shallowReadonly } from 'vue'
import { creationTabs as state } from '../tabs'

export const creationTabs = shallowReadonly(state)
export {
  createTab,
  openTabForLoad,
  switchTab,
  tabSummaries,
  tabsBlocker,
  creationSnapshots,
} from '../tabs'
