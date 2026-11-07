import type { Ref } from 'vue'
import type { FrontendContext } from '@shared/contracts/desktop'
import type { PageAction, PageWorkspace } from '@shared/workspace/model'

export type WorkspaceOperation = 'chat' | 'generate' | 'save' | ''
export type WorkspaceMutation = (action: PageAction) => Promise<void>

/** All actions share the page's operation lock and autosave/revision chain. */
export interface WorkspaceActionContext {
  work: Ref<PageWorkspace>
  operation: Ref<WorkspaceOperation>
  error: Ref<string>
  flushNotes: () => Promise<void>
  updated: () => void
  frontendContext: () => FrontendContext | undefined
}
