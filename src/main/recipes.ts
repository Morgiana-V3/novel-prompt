import { nativeImage } from 'electron'
import { randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync, readdirSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { dataDir } from './paths'
import { writeFileAtomic } from './fs-safe'
import { libraryImagePath, readImageRecipe } from './image-library'
import type { ImageRecipe, SavedRecipe, NaiGenRequest } from '../shared/types'
import { readPage, checkDraft, checkPageParams } from './page-workspaces'

const directory = () => { const p = join(dataDir(), 'recipes'); mkdirSync(p, { recursive: true }); return p }
const file = (id: string) => {
  if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error('收藏标识无效')
  return join(directory(), `${id}.json`)
}
export function listRecipes(): SavedRecipe[] {
  return readdirSync(directory()).filter(n => /^[a-f0-9-]{36}\.json$/.test(n)).flatMap(n => {
    try { const r = JSON.parse(readFileSync(join(directory(), n), 'utf8')); return r.recipe?.schema === 1 ? [r as SavedRecipe] : [] } catch { return [] }
  }).sort((a, b) => b.createdAt - a.createdAt)
}
export function createRecipe(imageName: string): SavedRecipe {
  const recipe = readImageRecipe(imageName)
  if (!recipe) throw new Error('这张旧图片没有完整生成设置，无法收藏准确配方；新生成的图片支持收藏')
  return saveRecipe(imageName, recipe)
}
export function createConfigRecipe(request: NaiGenRequest): SavedRecipe {
  if (!request || !['v5', 'v4.5'].includes(request.version)) throw new Error('模型无效')
  checkDraft(request, request.version)
  checkPageParams(request.params)
  const p = request.params
  if (!Number.isInteger(p.count) || p.count < 1 || p.count > 8 || typeof p.qualityTags !== 'boolean'
    || !['heavy', 'light', 'human', 'none'].includes(p.ucPreset) || !Number.isFinite(p.cfgRescale) || p.cfgRescale < 0 || p.cfgRescale > 1
    || !['native', 'karras', 'exponential', 'polyexponential'].includes(p.noiseSchedule)
    || !['k_euler_ancestral', 'k_euler', 'k_dpmpp_2s_ancestral', 'k_dpmpp_2m_sde', 'k_dpmpp_2m', 'k_dpmpp_sde'].includes(p.sampler)) throw new Error('生成配置无效')
  return saveRecipe('', { schema: 1, createdAt: Date.now(), sourceKind: 'generate', request: structuredClone(request) })
}
export function createWorkspaceRecipe(id: string, versionId: string): SavedRecipe {
  const w = readPage(id), v = w.versions.find(v => v.id === versionId)
  if (!v) throw new Error('历史记录不存在，请刷新会话')
  const recorded = v.image ? readImageRecipe(v.image.name) : null
  if (recorded) return saveRecipe(v.image!.name, recorded)
  const g = v.generated
  if (!g?.model || g.params.seed === null) throw new Error('这条旧记录缺少当时的模型或种子，无法收藏准确配方；仍可查看和加载历史设置')
  const recipe: ImageRecipe = { schema: 1, createdAt: v.createdAt, sourceKind: g.execution.kind === 'inpaint' ? 'inpaint' : 'generate',
    request: { ...structuredClone(g.draft), version: g.model, params: { ...g.params, count: 1, qualityTags: false, ucPreset: 'none' } } }
  return saveRecipe(v.image?.name ?? '', recipe)
}
function saveRecipe(imageName: string, recipe: ImageRecipe): SavedRecipe {
  const path = libraryImagePath(imageName)
  const image = path ? nativeImage.createFromPath(path) : null
  const size = image?.getSize()
  const r: SavedRecipe = { id: randomUUID(), name: recipe.request.base.slice(0, 60) || '未命名配方', note: '', tags: [], createdAt: Date.now(),
    sourceImage: imageName, thumbnail: image && !image.isEmpty() ? image.resize(size!.width >= size!.height ? { width: 240 } : { height: 240 }).toDataURL() : '', recipe }
  writeFileAtomic(file(r.id), JSON.stringify(r))
  return r
}
export function updateRecipe(id: string, patch: Pick<SavedRecipe, 'name' | 'note' | 'tags'>): SavedRecipe {
  if (typeof patch.name !== 'string' || !patch.name.trim() || patch.name.length > 100 || typeof patch.note !== 'string' || patch.note.length > 6000 || !Array.isArray(patch.tags) || patch.tags.length > 20 || patch.tags.some(t => typeof t !== 'string' || t.length > 60)) throw new Error('收藏名称、备注或标签格式无效')
  const r = JSON.parse(readFileSync(file(id), 'utf8')) as SavedRecipe
  Object.assign(r, { name: patch.name.trim(), note: patch.note, tags: patch.tags.map(t => t.trim()).filter(Boolean) })
  writeFileAtomic(file(id), JSON.stringify(r)); return r
}
export function deleteRecipe(id: string): void { unlinkSync(file(id)) }
