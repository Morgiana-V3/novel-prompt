import { RESULT_SCHEMA } from './contract'

type Schema = Record<string, any>
const str = { type: 'string' }, num = { type: 'number' }, int = { type: 'integer' }, bool = { type: 'boolean' }, obj = { type: 'object' }
const nullable = (s: Schema) => ({ anyOf: [s, { type: 'null' }] })
const array = (items: Schema = obj) => ({ type: 'array', items })
const shape = (properties: Record<string, Schema>, required = Object.keys(properties)): Schema => ({ type: 'object', properties, required, additionalProperties: true })
const strings = array(str)
const draft = shape({ base: str, negative: str, characters: array(shape({ prompt: str, negative: str, position: str }, ['prompt'])) })
const image = shape({ name: str, url: str, width: num, height: num, storage: str }, ['name'])
const region = shape({ id: str, label: str, instruction: str, target: nullable(int) })
const page = shape({ total: int, matching: int, limit: int, revision: int, included: bool, hasMore: bool, nextBeforeVersionId: nullable(str), nextBeforeMessageId: nullable(str) }, ['total', 'matching', 'revision', 'included', 'hasMore'])
const version = shape({ id: str, label: str, image: nullable(image), editor: shape({ draft, params: obj, strength: num, regions: array(region) }), regionCount: int, detailDigest: str }, ['id', 'label'])
const message = shape({ id: str, role: str, text: str, textTruncated: bool, versionId: str, proposal: obj, detailDigest: str }, ['id', 'role', 'text'])
const desktopWorkspace = shape({ id: str, revision: int, title: str, versionId: str, regionId: nullable(str), pane: str, editing: bool, composer: str,
  viewedVersionId: str, adoptedVersionId: str, regions: array(region), config: obj, pendingRequestId: nullable(str) }, ['id', 'revision', 'title', 'versionId', 'regionId', 'pane', 'editing', 'composer'])
const desktop = shape({ token: str, tab: str, draft, model: str, image: nullable(image), workspace: nullable(desktopWorkspace), blockers: strings, frontend: nullable(obj) })
// frontend is optional before the first visible action.
desktop.required = desktop.required.filter((k: string) => k !== 'frontend')
const workspace = shape({ id: str, revision: int, title: str, currentVersionId: str, detail: { type: 'string', enum: ['summary', 'full'] },
  delta: bool, notModified: bool, resetRequired: bool, partial: bool, sinceRevision: int, removedMessageIds: strings, removedVersionIds: strings,
  versions: array(version), messages: array(message), versionsPage: page, history: page,
  addedRegionId: str, regionId: str, outcome: str, deletedVersionId: str }, ['id', 'revision', 'detail'])
workspace.anyOf = [{ required: ['notModified'], properties: { notModified: { enum: [true] } } }, { required: ['delta', 'versions', 'messages', 'versionsPage', 'history'] }]
const rules = nullable(shape({ digest: str, task: str, segmented: bool, manifestChanged: bool, removedIds: strings,
  manifest: array(shape({ id: str, name: str, digest: str, scope: str, priority: int, textLength: int, selected: bool, required: bool })),
  sections: array(shape({ id: str, digest: str, text: str })), selectedIds: strings, requiredIds: strings, missingRequiredIds: strings,
  bodiesNotModified: bool, selectionComplete: bool, nextAction: str }))
const context = shape({ id: str, revision: int, model: str, skills: rules, requestId: nullable(str), request: nullable(obj),
  draft, params: obj, image: nullable(image), discussion: obj, currentVersionId: str, adoptedVersionId: str,
  candidates: array(shape({ id: str, groupId: str, label: str, adopted: bool, image: nullable(image) })), candidatesPage: page,
  groups: array(obj), regions: array(region), processing: shape({ state: str, activity: nullable(obj), canAutoWakeAgent: bool, nextAction: str }), instructions: str }, ['id', 'revision', 'model', 'skills'])
context.anyOf = [{ required: ['requestId'] }, { required: ['request', 'draft', 'params', 'currentVersionId', 'discussion', 'candidates', 'candidatesPage', 'processing'] }]
const task = shape({ id: str, kind: str, status: str }, ['id', 'kind', 'status'])
const tasks = shape({ tasks: array(task) })
const report = shape({ text: str })
const guide = shape({ topic: str, content: str, fingerprint: str }, ['topic', 'content', 'fingerprint'])
const dimensions = shape({ width: num, height: num })
const generation = shape({ images: array(image), stopped: nullable(str), anlasChange: { type: ['number', 'string'] } })
const namedSchemas: Record<string, Schema> = {
  get_workspace: workspace,
  get_workspace_context: context,
  get_app_state: shape({ desktop: nullable(desktop), tasks, connection: shape({ sessionId: nullable(str), connected: bool, workspace: nullable(obj), nextActions: array(obj), recovery: str }), capabilities: shape({ ai: obj, generation: obj, canAutoWakeAgent: bool }), visible: bool, version: str, hostPid: int, runtime: obj }, ['desktop', 'tasks', 'capabilities', 'connection']),
  list_workspaces: shape({ items: array(shape({ id: str, title: str, updatedAt: num, image: nullable(image), versions: int, messages: int })) }),
  list_workspace_requests: shape({ items: array(shape({ id: str, requestId: str }, ['id', 'requestId'])) }),
  report_workspace_progress: shape({ id: str, requestId: str, phase: { enum: ['processing', 'waiting'] }, activity: nullable(obj), canAutoWakeAgent: bool }),
  delete_workspace: shape({ id: str, outcome: { enum: ['deleted'] }, records: str, images: str, sharedImages: str }),
  delete_image: shape({ name: str, outcome: { enum: ['deleted', 'not_found'] } }),
  compare_workspace_versions: shape({ id: str, revision: int, adoptedVersionId: str }, ['id', 'revision', 'adoptedVersionId']),
  generate_workspace: shape({ workspace, image: nullable(image), adoptedVersionId: str, generatedVersionId: str, stopped: nullable(str) }, ['workspace', 'adoptedVersionId']),
  list_tasks: tasks,
  cancel_task: shape({ tasks: array(task), id: str, cancellation: { enum: ['accepted', 'already_stopping', 'already_finished', 'not_found'] } }),
  navigate_app: desktop, apply_app_prompt: desktop,
  ui_capture_app: shape({ capturedAt: str, original: dimensions, displayed: dimensions, desktop, beforeToken: str, stateChangedDuringCapture: bool }, ['original', 'displayed', 'desktop', 'stateChangedDuringCapture']),
  read_image: shape({ original: dimensions, displayed: dimensions }),
  read_image_prompt: draft,
  list_images: shape({ items: array(image), total: int, hasMore: bool, nextBeforeName: nullable(str) }),
  generate_image: generation, inpaint_image: generation,
  prepare_inpaint: shape({ image_name: str, width: num, height: num, mask_path: str, preview_path: str, selected_pixels: int, coverage: num, bounds: obj }),
  nai_subscription: shape({ subscription: obj, freeCheckForDefaults: obj }),
  agent_guide: guide,
  inpaint_guide: report,
  prompt_guide: { anyOf: [report, shape({ fingerprint: str, version: str, guide: str, skills: array(shape({ id: str, name: str, chars: int })) })] },
  analyze_prompt: report, search_tags: report, validate_tags: report, related_tags: report, tag_wiki: report,
  optimize_prompt: shape({ positive: str, negative: str, characters: draft.properties.characters, assessment: str,
    changes: array(obj), invalid: strings, dropped: nullable(strings), fidelity: strings }),
  preview_prompt: shape({ summary: str, confidence: str, style: obj, composition: obj, scene: obj, lighting: obj,
    characters: array(obj), emphasis: array(obj), suppressed: array(obj), risks: array(obj), gap: str,
    suggestions: array(obj), issues: array(obj), tagCount: int, evidence: obj }),
  plan_inpaint: shape({ plans: array(shape({ id: str, summary: str, warning: str, changes: array(obj) })), mode: { enum: ['vision'] }, skills: strings, original: draft }),
  configure_tools: shape({ activeGroups: strings, exposedToolCount: int, groups: array(shape({ id: str, description: str, tools: strings })) }),
  get_operation: { anyOf: [shape({ operation: nullable(obj), result: obj, nextAction: str }, ['operation']), shape({ items: array(obj), retentionDays: int })] },
  list_skills: shape({ items: array(shape({ id: str, name: str, enabled: bool, priority: int }, ['id', 'name', 'enabled'])) }),
  get_skill: { anyOf: [report, shape({ id: str, name: str, content: str })] },
  create_skill: shape({ id: str, name: str, outcome: { enum: ['created'] }, items: array(obj) }),
  update_skill: shape({ id: str, name: str, chars: int, outcome: { enum: ['updated'] } }),
  delete_skill: shape({ id: str, outcome: { enum: ['deleted'] }, items: array(obj) }),
  set_skill_config: shape({ items: array(obj), outcome: str }, ['items']),
}
const workspaceWrites = ['create_workspace', 'set_workspace_agent', 'submit_workspace_request', 'reply_workspace_request', 'cancel_workspace_request', 'propose_workspace_edit', 'apply_workspace_action', 'add_workspace_region', 'update_workspace', 'update_workspace_region', 'delete_workspace_image']
for (const name of workspaceWrites) namedSchemas[name] = workspace

/** Errors and operation-only recovery receipts are explicit alternatives, not
 * permissive success objects. Unknown extension tools keep their own schema. */
export function toolOutputSchema(name: string): Schema | undefined {
  const success = namedSchemas[name] ?? (name.startsWith('ui_') ? desktop : undefined)
  if (!success) return undefined
  return { title: `${name}.result`, type: 'object', properties: { error: RESULT_SCHEMA.properties.error, operation: RESULT_SCHEMA.properties.operation },
    anyOf: [success, { required: ['error'] }, { required: ['operation'], maxProperties: 1 }], additionalProperties: true }
}
