// 真实环境冒烟：启动实际应用，通过 MCP 走完整的真实流程，调用真实的 AI 接口与 NovelAI 生图。
// 会消耗模型接口额度和 NovelAI Anlas，只在发版前手动运行：npm run live:smoke
// 密钥从本机开发数据目录的设置中复制到临时目录，不打印、不写入报告。
import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import { createRequire } from 'node:module'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'
import { temporaryProfile } from '../support/fixtures.cjs'

const root = fileURLToPath(new URL('../..', import.meta.url))
const electron = createRequire(import.meta.url)('electron')
const source =
  process.env.NP_LIVE_SETTINGS ||
  join(process.env.APPDATA ?? '', 'novel-prompt-dev', 'data', 'settings.json')
if (!existsSync(source)) {
  throw new Error(`找不到设置文件：${source}（可用 NP_LIVE_SETTINGS 指定）`)
}
const saved = JSON.parse(readFileSync(source, 'utf8'))
if (!saved.naiToken?.trim() || !saved.apiKey?.trim()) {
  throw new Error('设置中缺少 NovelAI Token 或模型接口 API Key')
}

const profile = temporaryProfile('np-live-')
const artifacts = join(profile, 'live-artifacts')
mkdirSync(join(profile, 'data'), { recursive: true })
mkdirSync(artifacts, { recursive: true })
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
    naiVersion: 'v5',
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
let errors = ''
child.stderr.on('data', (chunk) => (errors += chunk))
const waiting = new Map()
let sequence = 0
createInterface({ input: child.stdout }).on('line', (line) => {
  const message = JSON.parse(line)
  waiting.get(message.id)?.(message)
  waiting.delete(message.id)
})
const request = (method, params = {}, timeoutMs = 600_000) =>
  new Promise((resolve, reject) => {
    const id = ++sequence
    const timer = setTimeout(() => reject(new Error(`Timeout ${method}: ${errors}`)), timeoutMs)
    waiting.set(id, (message) => {
      clearTimeout(timer)
      resolve(message)
    })
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n')
  })

const steps = []
async function call(name, args = {}) {
  const started = Date.now()
  const message = await request('tools/call', {
    name,
    arguments: args,
  })
  if (message.error || message.result?.isError) {
    throw new Error(`${name}: ${message.error?.message || message.result.content[0].text}`)
  }
  const data = message.result.structuredContent ?? JSON.parse(message.result.content[0].text)
  steps.push({ tool: name, ms: Date.now() - started })
  return data
}
const token = async () => (await call('get_app_state')).desktop.token
const anlas = (subscription) =>
  subscription?.subscription
    ? (subscription.subscription.anlasFixed ?? 0) + (subscription.subscription.anlasPurchased ?? 0)
    : null
const pass = (text) => console.log(`PASS ${text}`)

let hostPid
try {
  await request('initialize', {
    protocolVersion: '2025-11-25',
    capabilities: {},
    clientInfo: { name: 'live-smoke', version: '1' },
  })
  const state = await call('get_app_state')
  hostPid = state.hostPid
  assert.equal(state.capabilities.ai.configured, true)
  assert.equal(state.capabilities.generation.configured, true)
  const before = await call('nai_subscription')
  pass(`真实账户已连接，Anlas ${anlas(before) ?? '未知'}`)

  /* ---------- 后台：智能优化 → 画面推测 → 生图 ---------- */
  const optimized = await call('optimize_prompt', {
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
  const preview = await call('preview_prompt', { ...draft, expectation: '' })
  assert.ok(preview, 'preview returns a result')
  pass('画面推测完成')

  const generated = await call('generate_image', {
    ...draft,
    width: 832,
    height: 1216,
    steps: 23,
    count: 1,
    confirm: true,
  })
  assert.equal(generated.images.length, 1, generated.stopped ?? 'one image')
  const image = generated.images[0]
  const listed = await call('list_images', { limit: 5 })
  assert.ok(listed.items.some((item) => item.name === image.name))
  assert.ok(listed.collections.length >= 1)
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
  workspace = await call('get_workspace', { id: workspaceId })
  const upscaled = await call('run_workspace_image_tool', {
    id: workspaceId,
    revision: workspace.revision,
    confirm: true,
    tool: 'upscale',
  })
  assert.ok(upscaled.image, 'upscale adds a candidate')
  assert.ok(upscaled.image.width > image.width, 'upscale doubles the size')
  pass('会话生成、精修与放大成功')

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
  const frontGenerated = await call('ui_generate_workspace', {
    id: frontId,
    expected_token: await token(),
    kind: 'generate',
    confirm: true,
    step_delay_ms: 0,
  })
  assert.ok(frontGenerated, 'frontend generation finished')
  pass('界面上生成新候选')

  const capture = await request('tools/call', { name: 'ui_capture_app', arguments: {} })
  const picture = capture.result?.content?.find((part) => part.type === 'image')
  if (picture) {
    writeFileSync(join(artifacts, 'final.png'), Buffer.from(picture.data, 'base64'))
  }

  const after = await call('nai_subscription')
  const report = {
    anlasBefore: anlas(before),
    anlasAfter: anlas(after),
    spent: anlas(before) !== null && anlas(after) !== null ? anlas(before) - anlas(after) : null,
    steps,
  }
  writeFileSync(join(artifacts, 'report.json'), JSON.stringify(report, null, 2))
  console.log(
    `All live checks passed. Anlas ${report.anlasBefore} → ${report.anlasAfter}（消耗 ${report.spent ?? '未知'}）。Artifacts: ${artifacts}`,
  )
} catch (error) {
  console.error(error)
  writeFileSync(join(artifacts, 'steps.json'), JSON.stringify(steps, null, 2))
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
}
