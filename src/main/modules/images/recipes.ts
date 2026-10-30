import { isUcPreset, isNaiNoiseSchedule, isNaiSampler } from '../../../shared/generation/types'
import { nativeImage } from 'electron'
import { randomUUID, createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import type { NaiGenRequest } from '../../../shared/generation/types'
import type { ImageRecipe, SavedRecipe } from '../../../shared/images/types'
import { writeFileAtomic } from '../../infrastructure/atomic-file'
import { dataDir } from '../../infrastructure/paths'
import { readPage } from '../workspace/repository'
import { checkDraft, checkPageParams } from '../workspace/validation'
import { libraryImagePath, readImageRecipe } from './library'
import { embedRecipe } from './png-record'

const directory = () => {
  const path = join(dataDir(), 'recipes')
  mkdirSync(path, { recursive: true })
  return path
}
const file = (id: string) => {
  if (!/^[a-f0-9-]{36}$/.test(id)) {
    throw new Error('收藏标识无效')
  }
  return join(directory(), `${id}.json`)
}
const pictureFile = (id: string) => {
  file(id)
  const path = join(directory(), 'images')
  mkdirSync(path, { recursive: true })
  return join(path, `${id}.png`)
}
export function favoriteImagePath(id: string): string | null {
  if (!/^[a-f0-9-]{36}$/.test(id)) {
    return null
  }
  const path = pictureFile(id)
  return existsSync(file(id)) && existsSync(path) ? path : null
}
function withImage(record: SavedRecipe): SavedRecipe {
  // Upgrade old configuration favorites while their original image is still available.
  const path = pictureFile(record.id)
  if (!existsSync(path) && record.sourceImage) {
    const original = libraryImagePath(record.sourceImage)
    if (original) {
      const bytes = embedRecipe(readFileSync(original), record.recipe)
      writeFileAtomic(path, bytes)
      record.contentHash = createHash('sha256').update(bytes).digest('hex')
      writeFileAtomic(file(record.id), JSON.stringify(record))
    }
  }
  return { ...record, imageUrl: existsSync(path) ? `np-img://favorite/${record.id}` : undefined }
}
export function listRecipes(): SavedRecipe[] {
  return readdirSync(directory())
    .filter((imageName) => /^[a-f0-9-]{36}\.json$/.test(imageName))
    .flatMap((imageName) => {
      try {
        const record = JSON.parse(readFileSync(join(directory(), imageName), 'utf8'))
        if (record.recipe?.schema !== 1) {
          return []
        }
        try {
          return [withImage(record)]
        } catch {
          return [{ ...record, imageUrl: undefined }]
        }
      } catch {
        return []
      }
    })
    .sort((recipe, recipe2) => recipe2.createdAt - recipe.createdAt)
}
export function createRecipe(imageName: string): SavedRecipe {
  const recipe = readImageRecipe(imageName)
  if (!recipe) {
    throw new Error('这张旧图片没有完整生成设置，无法收藏准确配方；新生成的图片支持收藏')
  }
  return saveRecipe(imageName, recipe)
}
export function createConfigRecipe(request: NaiGenRequest): SavedRecipe {
  if (!request || !['v5', 'v4.5'].includes(request.version)) {
    throw new Error('模型无效')
  }
  checkDraft(request, request.version)
  checkPageParams(request.params)
  const parameters = request.params
  if (
    !Number.isInteger(parameters.count) ||
    parameters.count < 1 ||
    parameters.count > 8 ||
    typeof parameters.qualityTags !== 'boolean' ||
    !isUcPreset(parameters.ucPreset) ||
    !Number.isFinite(parameters.cfgRescale) ||
    parameters.cfgRescale < 0 ||
    parameters.cfgRescale > 1 ||
    !isNaiNoiseSchedule(parameters.noiseSchedule) ||
    !isNaiSampler(parameters.sampler)
  ) {
    throw new Error('生成配置无效')
  }
  return saveRecipe('', {
    schema: 1,
    createdAt: Date.now(),
    sourceKind: 'generate',
    request: structuredClone(request),
  })
}
export function createWorkspaceRecipe(id: string, versionId: string): SavedRecipe {
  const workspace = readPage(id)
  const version = workspace.versions.find((version2) => version2.id === versionId)
  if (!version) {
    throw new Error('历史记录不存在，请刷新会话')
  }
  const recorded = version.image ? readImageRecipe(version.image.name) : null
  if (recorded) {
    return saveRecipe(version.image!.name, recorded)
  }
  const generationSnapshot = version.generated
  if (!generationSnapshot?.model || generationSnapshot.params.seed === null) {
    throw new Error('这条旧记录缺少当时的模型或种子，无法收藏准确配方；仍可查看和加载历史设置')
  }
  const recipe: ImageRecipe = {
    schema: 1,
    createdAt: version.createdAt,
    sourceKind: generationSnapshot.execution.kind === 'inpaint' ? 'inpaint' : 'generate',
    request: {
      ...structuredClone(generationSnapshot.draft),
      version: generationSnapshot.model,
      params: { ...generationSnapshot.params, count: 1, qualityTags: false, ucPreset: 'none' },
    },
  }
  return saveRecipe(version.image?.name ?? '', recipe)
}
function saveRecipe(imageName: string, recipe: ImageRecipe): SavedRecipe {
  const path = libraryImagePath(imageName)
  const bytes = path ? embedRecipe(readFileSync(path), recipe) : undefined
  const contentHash = bytes ? createHash('sha256').update(bytes).digest('hex') : undefined
  if (contentHash) {
    const existing = listRecipes().find((item) => item.contentHash === contentHash)
    if (existing) {
      existing.sourceImages = [
        ...new Set([...(existing.sourceImages ?? []), existing.sourceImage, imageName]),
      ]
      writeFileAtomic(file(existing.id), JSON.stringify(existing))
      return existing
    }
  }
  const image = path ? nativeImage.createFromPath(path) : null
  const size = image?.getSize()
  const resolveR = () => {
    if (image && !image.isEmpty()) {
      return image
        .resize(size!.width >= size!.height ? { width: 240 } : { height: 240 })
        .toDataURL()
    }
    return '' as const
  }
  const recipe2: SavedRecipe = {
    id: randomUUID(),
    name: recipe.request.base.slice(0, 60) || '未命名配方',
    note: '',
    tags: [],
    createdAt: Date.now(),
    sourceImage: imageName,
    thumbnail: resolveR(),
    recipe,
    contentHash,
    sourceImages: imageName ? [imageName] : [],
  }
  if (bytes) {
    writeFileAtomic(pictureFile(recipe2.id), bytes)
  }
  try {
    writeFileAtomic(file(recipe2.id), JSON.stringify(recipe2))
  } catch (error) {
    if (bytes) {
      unlinkSync(pictureFile(recipe2.id))
    }
    throw error
  }
  return withImage(recipe2)
}
export function updateRecipe(
  id: string,
  patch: Pick<SavedRecipe, 'name' | 'note' | 'tags'>,
): SavedRecipe {
  if (
    typeof patch.name !== 'string' ||
    !patch.name.trim() ||
    patch.name.length > 100 ||
    typeof patch.note !== 'string' ||
    patch.note.length > 6000 ||
    !Array.isArray(patch.tags) ||
    patch.tags.length > 20 ||
    patch.tags.some((text) => typeof text !== 'string' || text.length > 60)
  ) {
    throw new Error('收藏名称、备注或标签格式无效')
  }
  const recipe = JSON.parse(readFileSync(file(id), 'utf8')) as SavedRecipe
  Object.assign(recipe, {
    name: patch.name.trim(),
    note: patch.note,
    tags: patch.tags.map((text) => text.trim()).filter(Boolean),
  })
  writeFileAtomic(file(id), JSON.stringify(recipe))
  return withImage(recipe)
}
export function deleteRecipe(id: string): void {
  const image = pictureFile(id)
  unlinkSync(file(id))
  if (existsSync(image)) {
    unlinkSync(image)
  }
}
