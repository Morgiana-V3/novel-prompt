import type { InpaintDraft, NaiImage, NaiVersion } from './types'
import type { PageExternalReply } from './page-workspace'

export const APP_TABS = ['compare', 'ai', 'preview', 'generate', 'workspace', 'search', 'settings'] as const
export type AppTab = typeof APP_TABS[number]
export type FrontendAction = 'open' | 'create' | 'view' | 'compose' | 'send' | 'region' | 'review' | 'generate' | 'agent' | 'reply' | 'external-cancel'
export interface FrontendRequest {
  action: FrontendAction
  actionId: string
  label: string
  step_delay_ms?: number
  id?: string
  expected_token?: string
  title?: string
  source?: 'blank' | 'current' | 'image'
  image?: NaiImage
  pane?: 'canvas' | 'prompt' | 'changes' | 'suggestions' | 'history'
  version_id?: string
  text?: string
  region_id?: string | null
  reference_ids?: string[]
  rectangles?: { x: number; y: number; width: number; height: number }[]
  instruction?: string
  target?: number | null
  message_id?: string
  decision?: 'accept' | 'reject' | 'undo' | 'switch'
  kind?: 'generate' | 'inpaint'
  mode?: 'internal' | 'external'
  response?: PageExternalReply
}
export interface FrontendContext { actionId: string; signal: AbortSignal; step: (message: string) => Promise<void> }
export interface DesktopState {
  token: string
  tab: AppTab
  draft: InpaintDraft
  model: NaiVersion
  image: NaiImage | null
  workspace: { id: string; revision: number; title: string; versionId: string; regionId: string | null; pane: string; editing: boolean; composer: string;
    viewedVersionId?: string; historyOpen?: boolean; references?: string[]; image?: NaiImage | null;
    regions?: { id: string; label: string; instruction: string; target: number | null }[];
    latestProposal?: { id: string; title: string; status: string } | null; lastMessage?: string;
    agentMode?: 'internal' | 'external'; agentName?: string; agentConnected?: boolean; pendingRequestId?: string | null } | null
  frontend?: { label: string; stage: string; status: 'running' | 'completed' | 'error' } | null
  blockers: string[]
}
export interface DesktopCommand { id: string; type: 'snapshot' | 'capture-prepare' | 'capture-end' | 'navigate' | 'apply-prompt' | 'workspace-lock' | 'workspace-release' | 'show-image' | 'frontend'; args: Record<string, unknown> }
export interface DesktopCaptureReady { desktop: DesktopState; viewport: { width: number; height: number; devicePixelRatio: number }; redactedFields: number; redactions: { x: number; y: number; width: number; height: number }[]; expiresAt: number }
export interface DesktopReply { id: string; result?: unknown; error?: string }
