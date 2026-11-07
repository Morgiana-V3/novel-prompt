import type { NaiGenParams, NaiVersion } from '../generation/types'
import type { NaiImage } from '../images/types'
import type { InpaintDraft } from '../prompts/types'
import type { PageEventBilling, PageExecutionObservation } from './events'
import type { PageDiscussion, PageExecution, PageSkillSection } from './model'

export interface PageInputRegion {
  id: string
  label: string
  instruction: string
  target: number | null
  bounds: { x: number; y: number; width: number; height: number } | null
}

export interface PageInputImage {
  id: string
  role: 'edit-target' | 'discussion' | 'reference' | 'region'
  versionId: string
  label: string
  imageName: string | null
  regionId?: string
  status: 'available' | 'included' | 'text-only' | 'missing' | 'none'
  /** Another role in this request already carries the same encoded image. */
  sharedWith?: string
  /** Local source stamp; a delivery record, never evidence of model understanding. */
  sourceSignature?: string
}

/** Frozen at submission; rule bodies remain in the request's skillSnapshot. */
export interface PageInputContext {
  schema: 1
  requestId: string
  workspaceId: string
  revision: number
  capturedAt: number
  goal: string
  preserve: string
  model: NaiVersion
  discussion: PageDiscussion
  editTarget: {
    versionId: string
    label: string
    parentId: string | null
    image: NaiImage | null
    model: NaiVersion
    draft: InpaintDraft
    params: NaiGenParams
    strength: number
  }
  execution: PageExecution
  /** Historical observations at submission, never current balance or spending authorization. */
  latestExecution?: PageExecutionObservation | null
  latestBillingObservation?: {
    messageId: string
    observedAt: number
    billing: PageEventBilling
  } | null
  selectedRegions: PageInputRegion[]
  references: PageDiscussion[]
  rules: {
    digest: string
    /** Full frozen snapshot, including reference bodies available on demand. */
    characters: number
    entries: (Pick<
      PageSkillSection,
      'id' | 'name' | 'description' | 'scope' | 'model' | 'priority' | 'digest'
    > & {
      characters: number
      /** Input plan, not proof that an external client fetched or understood the body. */
      delivery: 'initial' | 'on-demand'
      reason: string
    })[]
  }
  history: {
    recentIds: string[]
    earlierIds: string[]
    /** Routine receipts excluded before windowing; source records remain unchanged. */
    filteredRoutineCount?: number
    /** Remaining messages outside the input windows; excludes filtered routine receipts. */
    omittedCount: number
    decisions: {
      messageId: string
      versionId: string
      title: string
      status: 'accepted' | 'rejected' | 'withdrawn'
      createdAt: number
    }[]
  }
  images: {
    mode: 'unassembled' | 'external-reference' | 'included' | 'text-only' | 'missing' | 'none'
    /** Latest provider request; absent for external clients and legacy snapshots. */
    delivery?: 'prepared' | 'attempted' | 'responded'
    /** Actual network attempts and valid replies across this discussion, not model memory. */
    attempts?: number
    responses?: number
    entries: PageInputImage[]
  }
}
