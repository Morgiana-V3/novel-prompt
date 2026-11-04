import { inject, type InjectionKey } from 'vue'
import { shellState, type Tab } from '../state/shell'

/** Keep a page controller mounted while a host presents its tools in panels. */
export interface PagePresentation {
  isActive: (tab: Tab) => boolean
  navigate: (tab: Tab) => void
  editor: () => HTMLElement | undefined
}

export const pagePresentation: InjectionKey<PagePresentation> = Symbol('page-presentation')

export function usePagePresentation(): PagePresentation {
  return inject(pagePresentation, {
    isActive: (tab) => shellState.tab === tab,
    navigate: (tab) => {
      shellState.tab = tab
    },
    editor: () => undefined,
  })
}
