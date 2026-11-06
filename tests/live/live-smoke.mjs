// 真实环境冒烟：启动实际应用，通过 MCP 走完整的真实流程，调用真实的 AI 接口与 NovelAI 生图。
// 会消耗模型接口额度和 NovelAI Anlas，只在发版前手动运行：npm run live:smoke
// 密钥从本机开发数据目录的设置中复制到临时目录，不打印、不写入报告。
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'
import { temporaryProfile } from '../support/fixtures.cjs'
import {
  checkInpaintPreservation,
  clearCredentials,
  imageEvidence,
  liveClient,
} from './support.mjs'

const root = fileURLToPath(new URL('../..', import.meta.url))
const electron = createRequire(import.meta.url)('electron')
// Optimization, prediction and generation must agree about presets appended by the provider.
const promptContext = {
  version: 'v5',
  quality_tags: true,
  quality_mode: 'standard',
  uc_preset: 'heavy',
}
const developmentProfile = join(process.env.APPDATA ?? '', 'novel-prompt-dev')
const locationFile = join(developmentProfile, 'storage-location.json')
const dataRoot = existsSync(locationFile)
  ? JSON.parse(readFileSync(locationFile, 'utf8')).path || developmentProfile
  : developmentProfile
const source = process.env.NP_LIVE_SETTINGS || join(dataRoot, 'data', 'settings.json')
if (!existsSync(source)) {
  throw new Error(`找不到设置文件：${source}（可用 NP_LIVE_SETTINGS 指定）`)
}
const saved = JSON.parse(readFileSync(source, 'utf8'))
const secrets = [saved.naiToken, saved.apiKey, saved.visionApiKey].filter(Boolean)
const redact = (value) =>
  secrets.reduce((text, secret) => text.replaceAll(secret, '[redacted]'), value)
if (!saved.naiToken?.trim() || !saved.apiKey?.trim()) {
  throw new Error('设置中缺少 NovelAI Token 或模型接口 API Key')
}

const profile = temporaryProfile('np-live-')
const artifacts = join(profile, 'live-artifacts')
mkdirSync(join(profile, 'data'), { recursive: true })
mkdirSync(artifacts, { recursive: true })
console.log(`Artifacts: ${artifacts}`)
// 只复制接口配置；Agent 付费授权在临时目录里放开（运行本脚本即视为同意消耗额度）
writeFileSync(
  join(profile, 'data', 'settings.json'),
  JSON.stringify({
    apiKey: saved.apiKey,
    baseUrl: saved.baseUrl,
    model: saved.model,
    aiPreset: saved.aiPreset,
    reasoningEffort: 'low',
    visionModel: saved.visionModel ?? '',
    visionBaseUrl: saved.visionBaseUrl ?? '',
    visionApiKey: saved.visionApiKey ?? '',
    naiToken: saved.naiToken,
    naiVersion: promptContext.version,
    agentFreeOnly: false,
    mcpAllowAi: true,
    mcpAllowGenerate: true,
  }),
)

const child = spawn(electron, [join(root, 'src/runtime/mcp-proxy.cjs'), root], {
  windowsHide: true,
  env: {
    ...process.env,
    ELECTRON_RUN_AS_NODE: '1',
    NOVELPROMPT_USER_DATA: profile,
    NOVELPROMPT_MCP_GROUPS: 'all',
  },
  stdio: ['pipe', 'pipe', 'pipe'],
})
const request = liveClient(child, redact)

const steps = []
const images = []
const balances = []
let catalog = []
let failure
let preservation
const startedAt = new Date().toISOString()
async function call(name, args = {}, timeoutMs) {
  const started = Date.now()
  const schema = catalog.find((tool) => tool.name === name)?.inputSchema
  const argumentsRecord = schema?.properties?.operation_id
    ? { operation_id: randomUUID(), ...args }
    : args
  const step = { tool: name, operationId: argumentsRecord.operation_id, status: 'running' }
  steps.push(step)
  const message = await request('tools/call', { name, arguments: argumentsRecord }, timeoutMs)
  step.ms = Date.now() - started
  if (message.error || message.result?.isError) {
    step.status = 'failed'
    throw new Error(redact(`${name}: ${message.error?.message || message.result.content[0].text}`))
  }
  const data = message.result.structuredContent ?? JSON.parse(message.result.content[0].text)
  step.status = 'succeeded'
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
  return result
}
async function verifyImage(name, stage) {
  const listed = await call('list_images', { query: name, limit: 1 })
  assert.equal(listed.items[0]?.name, name, `${stage} persisted in the gallery`)
  const evidence = imageEvidence(profile, listed.items[0])
  assert.ok(!images.some((image) => image.name === name), `${stage} produced a new image`)
  images.push({ stage, ...evidence })
  return evidence
}

let hostPid
try {
  const initialized = await request('initialize', {
    protocolVersion: '2025-11-25',
    capabilities: {},
    clientInfo: { name: 'live-smoke', version: '1' },
  })
  assert.ok(!initialized.error, 'MCP initialize succeeded')
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n')
  catalog = (await request('tools/list')).result.tools
  const groups = await call('configure_tools')
  assert.equal(catalog.length, groups.exposedToolCount)
  writeFileSync(join(artifacts, 'tool-catalog.json'), JSON.stringify(groups, null, 2))
  const state = await call('get_app_state')
  hostPid = state.hostPid
  assert.equal(state.capabilities.ai.configured, true)
  assert.equal(state.capabilities.generation.configured, true)
  const before = await balance('before')
  pass(`真实账户已连接，Anlas ${anlas(before) ?? '未知'}`)

  /* ---------- 后台：智能优化 → 画面推测 → 生图 ---------- */
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
    title: 'Live smoke 后台会话',
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
    title: 'Live smoke V4.5 扩图',
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
  await balance('after-outpaint')
  pass('V4.5 生图与向右扩图成功')

  /* ---------- 前台：标签页、界面上的 AI 讨论与生成 ---------- */
  await call('navigate_app', { tab: 'generate' })
  const tabbed = await call('apply_app_prompt', {
    expected_token: await token(),
    draft,
    target: 'fresh_tab',
    tab_title: 'Live smoke',
  })
  assert.equal(tabbed.creationTabs.find((tab) => tab.active)?.title, 'Live smoke')
  pass('Agent 在新标签中写入提示词')

  const opened = await call('ui_create_workspace', {
    title: 'Live smoke 前台会话',
    source: 'image',
    image_name: image.name,
    step_delay_ms: 0,
  })
  const frontId = opened.workspace?.id ?? (await call('get_app_state')).desktop.workspace.id
  await call('ui_set_workspace_input', {
    id: frontId,
    expected_token: await token(),
    text: '保持人物不变，把背景改成黄昏的天空，并给出可直接生成的方案',
    step_delay_ms: 0,
  })
  await call('ui_send_workspace_message', {
    id: frontId,
    expected_token: await token(),
    step_delay_ms: 0,
  })
  const thread = await call('get_workspace', { id: frontId, detail: 'full', message_limit: 10 })
  const reply = [...thread.messages].reverse().find((message) => message.role === 'assistant')
  assert.ok(reply?.text?.trim(), 'built-in AI replied in the workspace')
  assert.ok(!reply.text.includes('没有看到图片'), 'the discussion model saw the image')
  pass('内置 AI 看图完成讨论')
  assert.ok(reply.proposal, 'discussion must return the requested executable proposal')
  if (reply.proposal) {
    await call('ui_review_workspace', {
      id: frontId,
      expected_token: await token(),
      decision: 'accept',
      message_id: reply.id,
      step_delay_ms: 0,
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
    step_delay_ms: 0,
  })
  const frontAfter = await call('get_workspace', { id: frontId, detail: 'full' })
  assert.ok(frontAfter.latestGeneratedVersionId, 'frontend generation creates a candidate')
  assert.notEqual(frontAfter.latestGeneratedVersionId, frontBefore.latestGeneratedVersionId)
  const frontImage = frontAfter.versions.find(
    (version) => version.id === frontAfter.latestGeneratedVersionId,
  )?.image
  await verifyImage(frontImage?.name, 'frontend-generation')
  pass('界面上生成新候选')

  const capture = await request('tools/call', { name: 'ui_capture_app', arguments: {} })
  const picture = capture.result?.content?.find((part) => part.type === 'image')
  assert.ok(!capture.error && !capture.result?.isError && picture, 'UI capture returns an image')
  writeFileSync(join(artifacts, 'final.png'), Buffer.from(picture.data, 'base64'))

  const after = await balance('after')
  console.log(
    `All live checks passed. Anlas ${anlas(before)} → ${anlas(after)}（消耗 ${anlas(before) - anlas(after)}）。Artifacts: ${artifacts}`,
  )
} catch (error) {
  failure = redact(error.stack || String(error))
  console.error(failure)
  if (hostPid) {
    await balance('after-failure').catch(() => {})
  }
  console.error(`Artifacts: ${artifacts}`)
  process.exitCode = 1
} finally {
  child.kill()
  if (hostPid) {
    try {
      process.kill(hostPid)
    } catch {
      /* 已退出 */
    }
  }
  let cleanupFailure
  try {
    clearCredentials(profile)
  } catch (error) {
    cleanupFailure = redact(error.stack || String(error))
    console.error(cleanupFailure)
    process.exitCode = 1
  }
  const before = balances[0]?.total ?? null
  const finalBalance = balances.at(-1)
  const after = ['after', 'after-failure'].includes(finalBalance?.stage) ? finalBalance.total : null
  writeFileSync(
    join(artifacts, 'report.json'),
    JSON.stringify(
      {
        status: failure || cleanupFailure ? 'failed' : 'passed',
        startedAt,
        finishedAt: new Date().toISOString(),
        failure,
        anlasBefore: before,
        anlasAfter: after,
        spent: before !== null && after !== null ? before - after : null,
        balances,
        images,
        preservation,
        exposedToolCount: catalog.length,
        steps,
        credentialsRemoved: !cleanupFailure,
        cleanupFailure,
      },
      null,
      2,
    ),
  )
}
