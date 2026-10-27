import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join, isAbsolute } from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { PNG } from 'pngjs'
import type { AiCharacter, InpaintDraft, NaiGenParams, NaiVersion } from '../../shared/types'
import { readPngPrompt } from '../../shared/prompt-import'
import { planInpaint } from '../ai/inpaint-planner'
import { getSettings } from '../settings'
import { composeSkills } from '../skills'
import { dataDir } from '../paths'
import { imagePath, generateImages } from '../nai/client'
import { pngSize } from '../nai/zip'
import { prepareInpaint } from '../nai/inpaint'
import type { McpTool } from './server'

type Args = Record<string, unknown>
const MAX_BYTES = 40 * 1024 * 1024
const json = (v: unknown) => JSON.stringify(v, null, 2)
const version = (v: unknown): NaiVersion => {
  if (v !== undefined && v !== 'v4.5' && v !== 'v5') throw new Error('version 必须为 v4.5 或 v5')
  return v as NaiVersion ?? getSettings().naiVersion
}
function number(v: unknown, fallback: number, min: number, max: number, integer = false): number {
  if (v === undefined) return fallback
  if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max || (integer && !Number.isInteger(v)))
    throw new Error(`参数必须为 ${min}～${max} 的${integer ? '整数' : '数字'}`)
  return v
}
function readPng(path: string): Buffer {
  if (statSync(path).size > MAX_BYTES) throw new Error('PNG 文件不能超过 40 MB')
  const bytes = readFileSync(path), size = pngSize(bytes)
  if (!size || !size.width || !size.height || size.width * size.height > 4 * 1024 * 1024) throw new Error('PNG 尺寸无效或超过 4194304 像素')
  return bytes
}
function source(a: Args) {
  const name = typeof a.image_name === 'string' ? a.image_name : ''
  const path = imagePath(name)
  if (!path) throw new Error('image_name 必须是 list_images 返回的图库文件名')
  const bytes = readPng(path), { width, height } = pngSize(bytes)!
  if (width % 64 || height % 64) throw new Error('原图宽高必须为 64 的倍数，不自动裁切或拉伸')
  return { name, bytes, width, height }
}
function mask(a: Args, s: ReturnType<typeof source>): string {
  const choices = ['mask_path', 'mask_base64', 'rectangles'].filter(k => a[k] !== undefined)
  if (choices.length !== 1) throw new Error('mask_path、mask_base64、rectangles 必须且只能提供一种')
  let encoded: string
  if (a.mask_path !== undefined) {
    if (typeof a.mask_path !== 'string' || !isAbsolute(a.mask_path)) throw new Error('mask_path 必须为 PNG 的绝对路径')
    encoded = readPng(a.mask_path).toString('base64')
  } else if (a.mask_base64 !== undefined) {
    if (typeof a.mask_base64 !== 'string') throw new Error('mask_base64 必须为 PNG base64 字符串')
    encoded = a.mask_base64
  } else {
    if (!Array.isArray(a.rectangles) || !a.rectangles.length || a.rectangles.length > 32) throw new Error('rectangles 必须包含 1～32 个矩形')
    const png = new PNG({ width: s.width, height: s.height })
    for (let i = 3; i < png.data.length; i += 4) png.data[i] = 255
    for (const r of a.rectangles) {
      if (!r || ['x', 'y', 'width', 'height'].some(k => !Number.isInteger(r[k])) || r.x < 0 || r.y < 0 || r.width <= 0 || r.height <= 0 || r.x + r.width > s.width || r.y + r.height > s.height)
        throw new Error('矩形使用原图像素坐标，必须完全位于原图内，宽高大于 0')
      for (let y = r.y; y < r.y + r.height; y++) png.data.fill(255, (y * s.width + r.x) * 4, (y * s.width + r.x + r.width) * 4)
    }
    encoded = PNG.sync.write(png).toString('base64')
  }
  prepareInpaint(s.bytes, encoded, s.width, s.height)
  return encoded
}
/** Reuse source bounds and binary-mask validation for workspace annotations. */
export function workspaceRectangleMask(imageName: string, rectangles: unknown): string {
  return mask({ rectangles }, source({ image_name: imageName }))
}

// Context polling should not decode, tint and encode an unchanged image each time.
// Retain only small receipts/hashes; never retain decoded images or mask bodies.
const workspacePreviews = new Map<string, { result: string; files: { path: string; size: number; digest: string }[] }>()
const previewDigest = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex')
export async function workspaceInpaintPreview(imageName: string, encoded: string, signal: AbortSignal): Promise<string> {
  const s = source({ image_name: imageName })
  const key = JSON.stringify([dataDir(), s.name, previewDigest(s.bytes), previewDigest(encoded)])
  const cached = workspacePreviews.get(key)
  if (cached) {
    // Recheck artifacts too: a removed, edited or replaced preview must regenerate.
    // Content hashes also catch same-size replacements with restored timestamps.
    const intact = cached.files.every(file => {
      try { return statSync(file.path).size === file.size && previewDigest(readFileSync(file.path)) === file.digest }
      catch { return false }
    })
    workspacePreviews.delete(key)
    if (intact) { workspacePreviews.set(key, cached); return cached.result }
  }
  const prepare = inpaintTools().find(tool => tool.name === 'prepare_inpaint')!
  const result = await prepare.run({ image_name: imageName, mask_base64: encoded }, signal) as string
  const receipt = JSON.parse(result)
  const files = [receipt.mask_path, receipt.preview_path].map((path: string) => {
    const bytes = readFileSync(path)
    return { path, size: bytes.length, digest: previewDigest(bytes) }
  })
  workspacePreviews.set(key, { result, files })
  while (workspacePreviews.size > 64) workspacePreviews.delete(workspacePreviews.keys().next().value!)
  return result
}
async function draft(a: Args, s: ReturnType<typeof source>): Promise<InpaintDraft> {
  let original: InpaintDraft = { base: '', negative: '', characters: [] }
  try { original = await readPngPrompt(new Blob([Uint8Array.from(s.bytes)], { type: 'image/png' })) }
  catch { if (a.base === undefined) throw new Error('原图没有可读取的提示词，请显式提供 base、negative、characters') }
  const text = (v: unknown, fallback: string) => {
    if (v === undefined) return fallback
    if (typeof v !== 'string' || v.length > 30000) throw new Error('提示词必须为不超过 30000 字符的文本')
    return v
  }
  let characters = original.characters
  if (a.characters !== undefined) {
    if (!Array.isArray(a.characters) || a.characters.length > 12) throw new Error('characters 必须是最多 12 个角色的数组')
    characters = a.characters.map((c): AiCharacter => {
      if (!c || typeof c.prompt !== 'string') throw new Error('角色必须包含 prompt')
      return { prompt: text(c.prompt, ''), negative: text(c.negative, ''), position: text(c.position, '') }
    })
  }
  return { base: text(a.base, original.base), negative: text(a.negative, original.negative), characters }
}
const MASK_PROPS = {
  mask_path: { type: 'string', description: '本机 PNG 绝对路径；与原图同尺寸，白色重绘、黑色保留、alpha 全部 255。可用 prepare_inpaint 生成。' },
  mask_base64: { type: 'string', description: '与 mask_path 相同要求的 PNG base64（不带 data: 前缀）' },
  rectangles: { type: 'array', minItems: 1, maxItems: 32, description: '原图像素坐标的矩形并集。左上角为原点；与 mask_path / mask_base64 三选一。复杂选区建议 mask_path。', items: { type: 'object', properties: { x: { type: 'integer', minimum: 0 }, y: { type: 'integer', minimum: 0 }, width: { type: 'integer', minimum: 1 }, height: { type: 'integer', minimum: 1 } }, required: ['x', 'y', 'width', 'height'] } }
}
const SOURCE_PROPS = { image_name: { type: 'string', description: 'list_images 返回的图库文件名；原图不覆盖' } }
const VERSION_PROP = { type: 'string', enum: ['v4.5', 'v5'] }
const DRAFT_PROPS = {
  base: { type: 'string', description: '修改后的完整主提示词；省略时沿用原图元数据' },
  negative: { type: 'string', description: '完整负面；省略沿用原图，空字符串表示清空' },
  characters: { type: 'array', description: '完整角色数组，保留原顺序和坐标；省略沿用原图，空数组表示清空', items: { type: 'object', properties: { prompt: { type: 'string' }, negative: { type: 'string' }, position: { type: 'string' } }, required: ['prompt'] } },
  version: VERSION_PROP
}
const READ = { readOnlyHint: true, openWorldHint: false }
const WRITE = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true }

export function inpaintTools(): McpTool[] {
  return [
    {
      name: 'inpaint_guide', title: '局部重绘指南',
      description: '局部重绘前先读：返回用户启用的 inpaint Skill、遮罩规范、MCP 工作流和当前实现边界，不调用 AI。',
      inputSchema: { type: 'object', properties: { version: VERSION_PROP } }, annotations: READ,
      run: async a => `# 局部重绘工作流\n1. list_images / read_image_prompt 选择原图并实际查看图像。\n2. prepare_inpaint 根据 PNG 遮罩或像素矩形生成遮罩与定位预览；查看 preview_path 确认范围。白色重绘，黑色保留，遮罩不是涂色底图。\n3. 结合以下 Skill 自行优化，或 plan_inpaint 调用当前 AI 看图分析（消耗 AI 额度）。每区域有独立 id 与完整字段 before/after；只分析，不生成。\n4. 向用户说明变化；获得生图授权后 inpaint_image(confirm:true) 生成一张。不要把未经采纳的建议直接生成。metadata 提示词已含质量词与 UC，默认不再自动追加。\n5. 多区域逐个执行，下一次 image_name 使用上一张结果。返回 stopped 就停止；调用取消后不要继续后续区域。固定 seed 比较提示词或强度，逐项改动；原图永不覆盖。\n当前支持整图尺寸重绘与选区外逐像素保留；尚未实现官方 Focused Inpainting、参考图重绘或自动扩展遮罩。需要更大范围时请重新准备遮罩并说明。\n\n${composeSkills('inpaint', version(a.version)).text}`
    },
    {
      name: 'prepare_inpaint', title: '准备重绘选区',
      description: '本地生成黑白遮罩和粉色定位预览，返回文件路径、覆盖比例和边界。不会调用 AI 或生成接口。遮罩输入三选一。',
      inputSchema: { type: 'object', properties: { ...SOURCE_PROPS, ...MASK_PROPS }, required: ['image_name'] }, annotations: { ...WRITE, openWorldHint: false },
      run: async a => {
        const s = source(a), encoded = mask(a, s), p = prepareInpaint(s.bytes, encoded, s.width, s.height)
        const dir = join(dataDir(), 'inpaint-previews', randomUUID()); mkdirSync(dir, { recursive: true })
        const maskPath = join(dir, 'mask.png'), previewPath = join(dir, 'preview.png')
        let count = 0, x0 = s.width, y0 = s.height, x1 = 0, y1 = 0
        for (let y = 0; y < s.height; y++) for (let x = 0; x < s.width; x++) {
          const i = (y * s.width + x) * 4
          if (!p.mask.data[i]) continue
          count++; x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y)
          for (let c = 0; c < 3; c++) p.source.data[i + c] = Math.round(p.source.data[i + c] * .7 + [255, 107, 154][c] * .3)
        }
        writeFileSync(maskPath, Buffer.from(encoded, 'base64')); writeFileSync(previewPath, PNG.sync.write(p.source))
        return json({ image_name: s.name, width: s.width, height: s.height, mask_path: maskPath, preview_path: previewPath, selected_pixels: count, coverage: count / (s.width * s.height), bounds: { x: x0, y: y0, width: x1 - x0 + 1, height: y1 - y0 + 1 }, note: '预览中的粉色仅供定位，不发送为生成底图。' })
      }
    },
    {
      name: 'plan_inpaint', title: 'AI 分析重绘批注',
      description: '调用当前 AI 模型，始终结合原图、选区裁剪、批注与启用的重绘 Skill，返回每区域独立的修改方案（不会生成或自动采纳）。消耗 AI 额度；模型必须支持图片。',
      inputSchema: { type: 'object', properties: { ...SOURCE_PROPS, ...DRAFT_PROPS, regions: { type: 'array', minItems: 1, maxItems: 8, items: { type: 'object', properties: { id: { type: 'string' }, label: { type: 'string', pattern: '^[A-Z]{2,16}$' }, instruction: { type: 'string' }, target: { type: ['integer', 'null'], description: '角色索引从 0 开始；省略或 null 由 AI 判断' }, ...MASK_PROPS }, required: ['id', 'instruction'] } } }, required: ['image_name', 'regions'] },
      annotations: { ...READ, openWorldHint: true },
      gate: () => !getSettings().mcpAllowAi ? '请在 Agent 接入中开启允许调用 AI' : !getSettings().apiKey ? '请配置 AI API Key' : null,
      run: async (a, signal, progress) => {
        progress?.('正在准备原图、选区和批注…')
        if (!Array.isArray(a.regions) || !a.regions.length || a.regions.length > 8) throw new Error('请提供 1～8 个区域')
        const s = source(a), original = await draft(a, s)
        const regions = a.regions.map(r => {
          if (!r || typeof r !== 'object') throw new Error('区域格式无效')
          return { id: r.id, label: r.label, instruction: r.instruction, target: r.target ?? null, mask: mask(r, s) }
        })
        const result = await planInpaint({ imageName: s.name, width: s.width, height: s.height, version: version(a.version), draft: original, regions }, signal)
        return json({ ...result, original, note: '每个方案独立基于 original。采纳字段后将完整 base / negative / characters 传给 inpaint_image；分析不会生成。' })
      }
    },
    {
      name: 'inpaint_image', title: 'NovelAI 局部重绘',
      description: '对图库原图的指定区域重绘一张并另存。与界面同一生成/合成链路，选区外像素不变。必须 confirm:true；强制免费检查并核对 Anlas，返回 stopped 时停止。',
      inputSchema: { type: 'object', properties: { ...SOURCE_PROPS, ...DRAFT_PROPS, ...MASK_PROPS, confirm: { type: 'boolean' }, strength: { type: 'number', minimum: .01, maximum: 1, description: '默认 1；降低时更多保留旧像素' }, seed: { type: 'integer', minimum: 0, maximum: 4294967295 }, steps: { type: 'integer', minimum: 1, maximum: 28 }, scale: { type: 'number', minimum: 0, maximum: 10 }, cfg_rescale: { type: 'number', minimum: 0, maximum: 1 }, sampler: { type: 'string', enum: ['k_euler_ancestral', 'k_euler', 'k_dpmpp_2s_ancestral', 'k_dpmpp_2m_sde', 'k_dpmpp_2m', 'k_dpmpp_sde'] } }, required: ['image_name', 'confirm'] }, annotations: WRITE,
      gate: () => !getSettings().mcpAllowGenerate ? '请在 Agent 接入中开启允许生图' : !getSettings().naiToken.trim() ? '请配置 NovelAI Token' : null,
      run: async (a, signal, progress) => {
        if (a.confirm !== true) throw new Error('需要 confirm: true 和用户的生图授权')
        const s = source(a), encoded = mask(a, s), prompts = await draft(a, s)
        const sampler = a.sampler ?? 'k_euler_ancestral'
        if (!['k_euler_ancestral', 'k_euler', 'k_dpmpp_2s_ancestral', 'k_dpmpp_2m_sde', 'k_dpmpp_2m', 'k_dpmpp_sde'].includes(String(sampler))) throw new Error('sampler 无效')
        const params: NaiGenParams = { width: s.width, height: s.height, count: 1, steps: number(a.steps, 23, 1, 28, true), scale: number(a.scale, 5, 0, 10), cfgRescale: number(a.cfg_rescale, 0, 0, 1), seed: a.seed === undefined ? null : number(a.seed, 0, 0, 4294967295, true), sampler: sampler as NaiGenParams['sampler'], noiseSchedule: 'karras', qualityTags: false, ucPreset: 'none' }
        const result = await generateImages({ ...prompts, params, version: version(a.version), inpaint: { imageName: s.name, mask: encoded, strength: number(a.strength, 1, .01, 1) } }, progress ?? (() => {}), () => signal.aborted, { freeOnly: true })
        if (signal.aborted) result.stopped ??= '已停止，已完成的图片已保留'
        return json({ images: result.images.map(i => ({ ...i, path: imagePath(i.name) })), anlasChange: result.anlasDelta ?? '未知', stopped: result.stopped ?? null, source: s.name })
      }
    }
  ]
}
