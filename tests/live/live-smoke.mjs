// 当前开发实例的真实 MCP 验收：不启动宿主、不改设置、不复制密钥、不清理用户数据。
// 会消耗模型接口额度和 NovelAI Anlas，只在发版前手动运行：npm run live:smoke
import { randomUUID } from 'node:crypto'
import { renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import assert from 'node:assert/strict'
import { checkInpaintPreservation, imageEvidence } from './support.mjs'
import {
  assertCurrentDevState,
  auditDirectory,
  connectCurrentDev,
  redact,
} from './current-dev-client.mjs'
import { assertMcpCatalog } from '../../scripts/contract-catalog.mjs'

// Optimization, prediction and generation must agree about presets appended by the provider.
const promptContext = {
  version: 'v5',
  quality_tags: true,
  quality_mode: 'standard',
  uc_preset: 'heavy',
}
const readOnly = process.argv.includes('--read-only')
const artifacts = auditDirectory()
const testLabel = `[真实灰度 ${new Date().toISOString()}]`
console.log(`Artifacts: ${artifacts}`)
let client
const request = (...args) => client.request(...args)

const steps = []
const images = []
const balances = []
const inputContexts = []
const executionReceipts = []
let catalog = []
let failure
let preservation
let hostPid
const startedAt = new Date().toISOString()
function checkpoint(status = 'running') {
  const before = balances[0]?.total ?? null
  const finalBalance = balances.at(-1)
  const after = ['after', 'after-failure'].includes(finalBalance?.stage) ? finalBalance.total : null
  const report = {
    status,
    mode: readOnly ? 'current-development-read-only' : 'current-development-live',
    hostPid,
    profile: client?.profile,
    dataRoot: client?.dataRoot,
    buildModifiedAt: client?.buildModifiedAt,
    loadedRuntime: client?.loadedRuntime,
    testLabel,
    startedAt,
    updatedAt: new Date().toISOString(),
    ...(status === 'running' ? {} : { finishedAt: new Date().toISOString() }),
    failure,
    anlasBefore: before,
    anlasAfter: after,
    spent: before !== null && after !== null ? before - after : null,
    balances,
    images,
    preservation,
    inputContexts,
    executionReceipts,
    exposedToolCount: catalog.length,
    steps,
    credentialsCopied: false,
    existingHostStopped: false,
    artifactsRetained: true,
    interruptedOperationPolicy:
      'running/unknown 操作可能已执行或收费；先查询记录、图库和余额，禁止自动重放。',
  }
  const path = join(artifacts, 'report.json')
  writeFileSync(path + '.tmp', JSON.stringify(report, null, 2))
  renameSync(path + '.tmp', path)
}
async function call(name, args = {}, timeoutMs) {
  const started = Date.now()
  const schema = catalog.find((tool) => tool.name === name)?.inputSchema
  const argumentsRecord = schema?.properties?.operation_id
    ? { operation_id: randomUUID(), ...args }
    : args
  const step = {
    tool: name,
    operationId: argumentsRecord.operation_id,
    workspaceId: argumentsRecord.id,
    status: 'running',
  }
  steps.push(step)
  // Persist the operation identifier before dispatch: Windows may terminate Node without signals.
  checkpoint()
  let message
  try {
    message = await request('tools/call', { name, arguments: argumentsRecord }, timeoutMs)
  } catch (error) {
    step.status = 'unknown'
    step.ms = Date.now() - started
    checkpoint()
    throw error
  }
  step.ms = Date.now() - started
  if (message.error || message.result?.isError) {
    step.status = 'failed'
    checkpoint()
    throw new Error(redact(`${name}: ${message.error?.message || message.result.content[0].text}`))
  }
  const data = message.result.structuredContent ?? JSON.parse(message.result.content[0].text)
  step.status = 'succeeded'
  if (['create_workspace', 'ui_create_workspace'].includes(name)) {
    step.workspaceId = data.workspace?.id ?? data.id
  }
  checkpoint()
  const generationTools = [
    'generate_image',
    'inpaint_image',
    'generate_workspace',
    'run_workspace_image_tool',
    'ui_generate_workspace',
  ]
  if (
    generationTools.includes(name) &&
    (data.anlasChange === '未知' ||
      data.workspace?.latestExecution?.event.billing.status === 'unknown')
  ) {
    step.status = 'billing-unknown'
    // A fresh balance cannot retroactively prove this individual request's charge.
    step.reconciliation = {}
    checkpoint()
    const checks = [
      ['operation', () => call('get_operation', { operation_id: argumentsRecord.operation_id })],
      ['images', () => call('list_images', { limit: 10 })],
      ['balance', () => balance('billing-unknown')],
    ]
    for (const [check, read] of checks) {
      try {
        step.reconciliation[check] = { status: 'succeeded', result: await read() }
      } catch (error) {
        step.reconciliation[check] = {
          status: 'failed',
          error: redact(error.stack || String(error)),
        }
      }
      checkpoint()
    }
    const incomplete = Object.values(step.reconciliation).some(
      (result) => result.status === 'failed',
    )
    const reconciliation = incomplete
      ? '已尝试查询操作、图库和余额，部分查询失败，核对尚未完成'
      : '已完成操作、图库和余额查询，单次费用仍未知'
    throw new Error(`${name}: 单次费用未知；${reconciliation}，停止后续付费步骤。`)
  }
  return data
}
const token = async () => (await call('get_app_state')).desktop.token
const anlas = (result) => {
  const subscription = result?.subscription
  return Number.isFinite(subscription?.anlasFixed) && Number.isFinite(subscription?.anlasPurchased)
    ? subscription.anlasFixed + subscription.anlasPurchased
    : null
}
const pass = (text) => console.log(`PASS ${text}`)
const balance = async (stage) => {
  const result = await call('nai_subscription', {}, 30_000)
  const subscription = result.subscription
  balances.push({
    stage,
    total: anlas(result),
    fixed: subscription.anlasFixed,
    purchased: subscription.anlasPurchased,
    usagePercent: subscription.usagePercent,
    usageNegative: subscription.usageNegative,
  })
  checkpoint()
  return result
}
async function verifyImage(name, stage) {
  const listed = await call('list_images', { query: name, limit: 1 })
  assert.equal(listed.items[0]?.name, name, `${stage} persisted in the gallery`)
  const evidence = imageEvidence(client.dataRoot, listed.items[0])
  assert.ok(!images.some((image) => image.name === name), `${stage} produced a new image`)
  images.push({ stage, ...evidence })
  checkpoint()
  // A named favorite makes every new audit image visibly distinguishable in the real library.
  await call('save_favorite', {
    image_name: name,
    name: `${testLabel} ${stage}`,
    tags: ['真实灰度测试'],
    note: '本次真实 MCP 验收新生成的图片，未修改原有作品。',
  })
  return evidence
}

async function verifyExecution(id, kind, expectedCount, sourceVersionId) {
  const workspace = await call('get_workspace', { id, detail: 'full', message_limit: 100 })
  const receipts = workspace.messages.filter((message) => message.event?.type === 'execution')
  assert.equal(receipts.length, expectedCount, 'one persistent receipt per real execution')
  const message = receipts.at(-1)
  const event = message.event
  assert.equal(event.kind, kind)
  assert.equal(event.status, 'complete')
  // These live cases expect an uninterrupted success; complete images may otherwise
  // legitimately coexist with a stop reason or a billing warning in the domain model.
  assert.equal(event.severity, 'info', 'this live case completes without warnings')
  assert.equal(event.stopped, null, 'this live case expects no stop condition')
  assert.equal(event.error, undefined)
  assert.equal(
    event.billing.status,
    'known',
    'billing is verified independently from image success',
  )
  assert.ok(Number.isFinite(event.billing.anlasDelta), 'known billing has a finite observed delta')
  for (const key of ['usageDelta', 'remainingAnlas']) {
    if (event.billing[key] !== undefined) {
      assert.ok(Number.isFinite(event.billing[key]), `${key} is a finite observation when present`)
    }
  }
  assert.equal(
    event.sourceVersionId,
    sourceVersionId,
    'receipt retains the actual execution source',
  )
  assert.ok(workspace.versions.some((version) => version.id === sourceVersionId))
  assert.equal(event.requestedCount, event.versionIds.length)
  assert.equal(new Set(event.versionIds).size, event.versionIds.length, 'candidate IDs are unique')
  assert.ok(event.versionIds.includes(workspace.latestGeneratedVersionId))
  assert.equal(event.adoptedVersionId, workspace.currentVersionId)
  for (const versionId of event.versionIds) {
    const version = workspace.versions.find((version) => version.id === versionId)
    assert.ok(version, 'every generated candidate exists')
    assert.notEqual(version.id, sourceVersionId, 'generation creates a new candidate')
    assert.equal(version.parentId, sourceVersionId)
    assert.equal(version.generated?.sourceVersionId, sourceVersionId)
    assert.equal(version.generated?.tool?.kind ?? version.generated?.execution.kind, kind)
  }
  assert.ok(
    !workspace.messages.some(
      (message) => message.role === 'event' && /^(余额|Anlas 变化)/.test(message.text),
    ),
  )
  assert.deepEqual(workspace.latestExecution, {
    messageId: message.id,
    observedAt: message.createdAt,
    event,
  })
  const compact = await call('get_workspace', { id, message_ids: [message.id] })
  assert.deepEqual(
    compact.messages[0].event,
    event,
    'compact MCP reads preserve the structured receipt',
  )
  executionReceipts.push({ workspaceId: id, ...workspace.latestExecution })
  checkpoint()
}

checkpoint()
try {
  client = await connectCurrentDev()
  const initialized = await request('initialize', {
    protocolVersion: '2025-11-25',
    capabilities: {},
    clientInfo: { name: 'live-smoke', version: '1' },
  })
  assert.ok(!initialized.error, 'MCP initialize succeeded')
  client.notify('notifications/initialized')
  catalog = (await request('tools/list')).result.tools
  assertMcpCatalog(catalog)
  const groups = await call('configure_tools')
  assert.equal(catalog.length, groups.exposedToolCount)
  writeFileSync(
    join(artifacts, 'tool-catalog.json'),
    JSON.stringify({ ...groups, tools: catalog }, null, 2),
  )
  const state = await call('get_app_state')
  hostPid = state.hostPid
  assertCurrentDevState(client, state)
  checkpoint()
  const tasks = await call('list_tasks')
  assert.ok(
    !tasks.tasks.some((task) => ['running', 'cancelling'].includes(task.status)),
    '当前实例有运行中的任务，请完成后再验收',
  )
  assert.ok(
    !state.desktop?.blockers?.length && !state.desktop?.workspace?.editing,
    '当前界面正在编辑或有阻塞弹窗，请完成后再验收',
  )
  if (readOnly) {
    const workspaces = await call('list_workspaces')
    console.log(
      `PASS 当前开发实例只读核验：${catalog.length} 个工具，${workspaces.items.length} 个已有项目`,
    )
  } else {
    assert.equal(state.capabilities.ai.configured, true)
    assert.equal(state.capabilities.generation.configured, true)
    const before = await balance('before')
    pass(`真实账户已连接，Anlas ${anlas(before) ?? '未知'}`)

    /* ---------- 后台：智能优化 → 画面推测 → 生图 ---------- */
    console.log('阶段：后台 MCP 真实调用；任务和图片会保存，但不会逐步操作当前页面。')
    const optimized = await call('optimize_prompt', {
      ...promptContext,
      mode: 'semantic',
      instruction: '一个银发少女坐在樱花树下读书，半身，柔和的午后阳光',
    })
    assert.ok(optimized.positive?.trim(), 'semantic optimize returns a prompt')
    const draft = {
      base: optimized.positive,
      negative: optimized.negative ?? '',
      characters: (optimized.characters ?? []).map((character) => ({
        prompt: character.prompt,
        negative: character.negative ?? '',
        position: character.position ?? '',
      })),
    }
    pass('智能优化把中文描述转成提示词')
    const preview = await call('preview_prompt', { ...promptContext, ...draft, expectation: '' })
    assert.ok(preview, 'preview returns a result')
    pass('画面推测完成')

    const generationArgs = {
      ...promptContext,
      ...draft,
      width: 832,
      height: 1216,
      steps: 23,
      count: 1,
      confirm: true,
      operation_id: randomUUID(),
    }
    const generated = await call('generate_image', generationArgs)
    assert.equal(generated.images.length, 1, generated.stopped ?? 'one image')
    const image = generated.images[0]
    const originalEvidence = await verifyImage(image.name, 'text-to-image')
    const imported = await call('read_image_prompt', { name: image.name })
    assert.ok(imported.base.trim(), 'generated PNG retains its prompt')
    assert.equal(imported.width, image.width)
    assert.equal(imported.height, image.height)
    const listed = await call('list_images', { limit: 5 })
    assert.ok(listed.items.some((item) => item.name === image.name))
    assert.ok(listed.collections.length >= 1)
    const replay = await call('generate_image', generationArgs)
    assert.equal(replay.operation.replayed, true)
    assert.equal(replay.images[0].name, image.name)
    assert.equal((await call('list_images')).total, listed.total, 'replay cannot generate twice')
    await balance('after-text-to-image-and-replay')
    pass(`生图成功：${image.name}（Anlas 变化 ${generated.anlasChange}）`)

    /* ---------- 后台：AI 分析重绘批注（真实识图）→ 局部重绘 ---------- */
    const hair = [{ x: 208, y: 96, width: 416, height: 384 }]
    const plan = await call('plan_inpaint', {
      image_name: image.name,
      regions: [{ id: 'hair', label: 'HA', instruction: '把头发改成浅粉色', rectangles: hair }],
    })
    assert.equal(plan.plans.length, 1)
    assert.ok(
      !plan.plans[0].warning?.includes('没有看到图片'),
      'the configured model actually sees the image',
    )
    const patched = structuredClone(plan.original)
    for (const change of plan.plans[0].changes) {
      if (change.field === 'base') {
        patched.base = change.after
      } else if (change.field === 'negative') {
        patched.negative = change.after
      } else if (change.field === 'character') {
        patched.characters[change.characterIndex].prompt = change.after
      } else if (change.field === 'characterNegative') {
        patched.characters[change.characterIndex].negative = change.after
      }
    }
    pass(`AI 看图分析批注：${plan.plans[0].summary}`)
    const inpainted = await call('inpaint_image', {
      image_name: image.name,
      ...patched,
      rectangles: hair,
      confirm: true,
    })
    assert.ok(inpainted.image?.name ?? inpainted.images?.[0]?.name, 'inpaint returns an image')
    const inpaintEvidence = await verifyImage(inpainted.images[0].name, 'inpaint')
    preservation = checkInpaintPreservation(originalEvidence.path, inpaintEvidence.path, hair)
    await balance('after-inpaint')
    pass('局部重绘成功')

    /* ---------- 后台：图片精修会话生成与画布修图 ---------- */
    const created = await call('create_workspace', {
      draft,
      image_name: image.name,
      title: `${testLabel} 后台会话`,
      version: 'v5',
    })
    const workspaceId = created.workspace?.id ?? created.id
    let workspace = await call('get_workspace', { id: workspaceId })
    const backendGenerated = await call('generate_workspace', {
      id: workspaceId,
      revision: workspace.revision,
      confirm: true,
    })
    assert.ok(backendGenerated.generatedVersionId, 'workspace generation adds a candidate')
    assert.notEqual(backendGenerated.generatedVersionId, workspace.latestGeneratedVersionId)
    await verifyImage(backendGenerated.image.name, 'workspace-generation')
    await verifyExecution(workspaceId, 'generate', 1, workspace.currentVersionId)
    await balance('after-workspace-generation')
    workspace = await call('get_workspace', { id: workspaceId })
    const enhanced = await call('run_workspace_image_tool', {
      id: workspaceId,
      revision: workspace.revision,
      confirm: true,
      tool: 'enhance',
      scale: 1,
      strength: 0.4,
    })
    assert.ok(enhanced.image, 'enhance adds a candidate')
    assert.notEqual(enhanced.generatedVersionId, workspace.latestGeneratedVersionId)
    await verifyImage(enhanced.image.name, 'enhance')
    await verifyExecution(workspaceId, 'enhance', 2, workspace.currentVersionId)
    const beforeUpscale = await balance('before-upscale')
    workspace = await call('get_workspace', { id: workspaceId })
    const upscaled = await call('run_workspace_image_tool', {
      id: workspaceId,
      revision: workspace.revision,
      confirm: true,
      tool: 'upscale',
    })
    assert.ok(upscaled.image, 'upscale adds a candidate')
    assert.notEqual(upscaled.generatedVersionId, workspace.latestGeneratedVersionId)
    assert.equal(upscaled.image.width, image.width * 2, 'upscale doubles the width')
    assert.equal(upscaled.image.height, image.height * 2, 'upscale doubles the height')
    await verifyImage(upscaled.image.name, 'upscale')
    await verifyExecution(workspaceId, 'upscale', 3, workspace.currentVersionId)
    const afterUpscale = await balance('after-upscale')
    assert.ok(anlas(beforeUpscale) !== null && anlas(afterUpscale) !== null)
    assert.ok(anlas(beforeUpscale) > anlas(afterUpscale), 'paid upscale must really debit Anlas')
    pass('会话生成、精修与放大成功')

    /* ---------- V4.5 与扩图分支也必须返回真实 PNG ---------- */
    const legacyGenerated = await call('generate_image', {
      ...promptContext,
      ...draft,
      version: 'v4.5',
      width: 512,
      height: 768,
      steps: 23,
      count: 1,
      confirm: true,
    })
    assert.equal(legacyGenerated.images.length, 1, legacyGenerated.stopped ?? 'V4.5 image')
    const legacyImage = legacyGenerated.images[0]
    await verifyImage(legacyImage.name, 'v4.5-text-to-image')
    await balance('after-v4.5-generation')
    const outpaintWorkspace = await call('create_workspace', {
      draft,
      image_name: legacyImage.name,
      title: `${testLabel} V4.5 扩图`,
      version: 'v4.5',
    })
    const outpaintId = outpaintWorkspace.workspace?.id ?? outpaintWorkspace.id
    const beforeOutpaint = await call('get_workspace', { id: outpaintId })
    const outpainted = await call('run_workspace_image_tool', {
      id: outpaintId,
      revision: beforeOutpaint.revision,
      confirm: true,
      tool: 'outpaint',
      right: 64,
    })
    assert.notEqual(outpainted.generatedVersionId, beforeOutpaint.latestGeneratedVersionId)
    assert.equal(outpainted.image?.width, 576)
    assert.equal(outpainted.image?.height, 768)
    await verifyImage(outpainted.image.name, 'outpaint')
    await verifyExecution(outpaintId, 'outpaint', 1, beforeOutpaint.currentVersionId)
    await balance('after-outpaint')
    pass('V4.5 生图与向右扩图成功')

    /* ---------- 前台：标签页、界面上的 AI 讨论与生成 ---------- */
    console.log('阶段：前台 MCP 可见操作；本段调用内置 AI，不能替代外部 Agent 自主交互验收。')
    await call('navigate_app', { tab: 'generate' })
    const tabbed = await call('apply_app_prompt', {
      expected_token: await token(),
      draft,
      target: 'fresh_tab',
      tab_title: testLabel,
    })
    assert.equal(tabbed.creationTabs.find((tab) => tab.active)?.title, testLabel)
    pass('Agent 在新标签中写入提示词')

    const opened = await call('ui_create_workspace', {
      title: `${testLabel} 前台会话`,
      source: 'image',
      image_name: image.name,
      step_delay_ms: 2000,
    })
    const frontId = opened.workspace?.id ?? (await call('get_app_state')).desktop.workspace.id
    await call('ui_set_workspace_input', {
      id: frontId,
      expected_token: await token(),
      text: '保持人物不变，把背景改成黄昏的天空，并给出可直接生成的方案',
      step_delay_ms: 2000,
    })
    await call('ui_send_workspace_message', {
      id: frontId,
      expected_token: await token(),
      step_delay_ms: 2000,
    })
    const thread = await call('get_workspace', { id: frontId, detail: 'full', message_limit: 10 })
    const submitted = [...thread.messages].reverse().find((message) => message.role === 'user')
    const reply = [...thread.messages].reverse().find((message) => message.role === 'assistant')
    assert.ok(reply?.text?.trim(), 'built-in AI replied in the workspace')
    assert.ok(!reply.text.includes('没有看到图片'), 'the discussion model saw the image')
    const inputContext = submitted?.inputContext
    assert.ok(inputContext, 'the real submitted request retains its input context')
    assert.equal(inputContext.requestId, submitted.id)
    assert.equal(reply.requestId, submitted.id, 'the response links to its actual input')
    assert.equal(inputContext.workspaceId, frontId)
    assert.equal(inputContext.editTarget.versionId, thread.currentVersionId)
    assert.equal(inputContext.discussion.versionId, submitted.discussion.versionId)
    assert.equal(inputContext.rules.digest, submitted.skillSnapshot.digest)
    assert.ok(inputContext.rules.entries.length > 0)
    assert.equal(inputContext.images.mode, 'included', 'the request includes real image input')
    assert.equal(inputContext.images.delivery, 'responded', 'a real model response was received')
    assert.ok(inputContext.images.attempts >= 1)
    assert.ok(inputContext.images.responses >= 1)
    const imageInputs = inputContext.images.entries.filter((entry) => entry.status === 'included')
    assert.ok(imageInputs.some((entry) => entry.role === 'edit-target'))
    assert.ok(imageInputs.some((entry) => entry.role === 'discussion'))
    assert.equal(
      imageInputs.filter((entry) => !entry.sharedWith).length,
      1,
      'one source image shared by the two roles is included once',
    )
    inputContexts.push({
      requestId: submitted.id,
      workspaceId: frontId,
      rulesDigest: inputContext.rules.digest,
      imageRoles: imageInputs.length,
      uniqueImages: imageInputs.filter((entry) => !entry.sharedWith).length,
      delivery: inputContext.images.delivery,
      attempts: inputContext.images.attempts,
      responses: inputContext.images.responses,
    })
    checkpoint()
    pass('内置 AI 看图完成讨论')
    pass('真实请求输入清单、回复关联及图片去重通过')
    assert.ok(reply.proposal, 'discussion must return the requested executable proposal')
    if (reply.proposal) {
      await call('ui_review_workspace', {
        id: frontId,
        expected_token: await token(),
        decision: 'accept',
        message_id: reply.id,
        step_delay_ms: 2000,
      })
      pass('采纳 AI 方案')
    }
    // Reviewing a proposal may keep the Agent-owned config draft open. Backend reads
    // deliberately reject that state; generation saves the draft before executing.
    const frontBefore = thread
    await call('ui_generate_workspace', {
      id: frontId,
      expected_token: await token(),
      kind: 'generate',
      confirm: true,
      step_delay_ms: 2000,
    })
    const frontAfter = await call('get_workspace', { id: frontId, detail: 'full' })
    assert.ok(frontAfter.latestGeneratedVersionId, 'frontend generation creates a candidate')
    assert.notEqual(frontAfter.latestGeneratedVersionId, frontBefore.latestGeneratedVersionId)
    const frontImage = frontAfter.versions.find(
      (version) => version.id === frontAfter.latestGeneratedVersionId,
    )?.image
    await verifyImage(frontImage?.name, 'frontend-generation')
    await verifyExecution(frontId, 'generate', 1, frontBefore.currentVersionId)
    const frozenRequest = await call('get_workspace', {
      id: frontId,
      detail: 'full',
      message_ids: [submitted.id],
    })
    assert.deepEqual(
      frozenRequest.messages[0].inputContext,
      inputContext,
      'proposal adoption and generation must not rewrite the earlier input context',
    )
    pass('界面上生成新候选')

    const capture = await request('tools/call', { name: 'ui_capture_app', arguments: {} })
    const picture = capture.result?.content?.find((part) => part.type === 'image')
    assert.ok(!capture.error && !capture.result?.isError && picture, 'UI capture returns an image')
    writeFileSync(join(artifacts, 'final.png'), Buffer.from(picture.data, 'base64'))

    const after = await balance('after')
    console.log(
      `All live checks passed. Anlas ${anlas(before)} → ${anlas(after)}（消耗 ${anlas(before) - anlas(after)}）。Artifacts: ${artifacts}`,
    )
  }
} catch (error) {
  failure = redact(error.stack || String(error))
  console.error(failure)
  if (hostPid && !readOnly && balances.length) {
    await balance('after-failure').catch(() => {})
  }
  console.error(`Artifacts: ${artifacts}`)
  process.exitCode = 1
} finally {
  client?.close()
  checkpoint(failure ? 'failed' : 'passed')
}
