import type { Ref } from 'vue'
import type { ConfirmationRequest } from '@shared/contracts/confirmation'
import type { Tab } from '../../shared/state/shell'
import type WorkspacesView from '../../features/workspace/WorkspacesView.vue'
import type GenerateView from '../../features/generation/GenerateView.vue'
import type { AiView } from '../../features/prompts/public/views'

/** The desktop adapter consumes the same exposed actions as the visible views. */
export interface DesktopHost {
  confirmation: Ref<ConfirmationRequest | undefined>
  creationPanel: Ref<Tab>
  workspaceView: Ref<InstanceType<typeof WorkspacesView> | undefined>
  generateView: Ref<InstanceType<typeof GenerateView> | undefined>
  aiView: Ref<InstanceType<typeof AiView> | undefined>
}
