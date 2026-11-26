import {
  isUcPreset,
  isNaiNoiseSchedule,
  isNaiSampler,
  validImg2Img,
  type Img2ImgBase,
  type NaiGenRequest,
} from '../../../shared/generation/types'
import { checkReferences } from '../../../shared/generation/references'
import { checkVibes } from '../../../shared/generation/vibes'
import { nativeImage } from 'electron'
import { randomUUID, createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import type { ImageRecipe, SavedRecipe } from '../../../shared/images/types'
import { writeFileAtomic } from '../../infrastructure/atomic-file'
import { dataDir } from '../../infrastructure/paths'
import { readPage } from '../workspace/repository'
import { checkDraft, checkPageParams } from '../workspace/validation'
import { importReferenceImage } from '../generation/references'
import { libraryImagePath, readImageRecipe, readImageRecipeAtPath } from './library'
import { embedRecipe, readPngRecipe } from './png-record'

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
  const hasImage = existsSync(path)
  let recipe = record.recipe
  if (hasImage && recipe.sourceKind === 'inpaint') {
    try {
      if (readImageRecipeAtPath(path)?.sourceKind === 'img2img') {
        recipe = { ...recipe, sourceKind: 'img2img' }
      }
    } catch {
      // Keep the saved record when its optional PNG provenance is unreadable.
    }
  }
  return { ...record, recipe, imageUrl: hasImage ? `np-img://favorite/${record.id}` : undefined }
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
export async function createConfigRecipe(
  request: NaiGenRequest,
  img2img?: Img2ImgBase,
): Promise<SavedRecipe> {
  if (!request || !['v5', 'v4.5'].includes(request.version)) {
    throw new Error('模型无效')
  }
  checkDraft(request, request.version)
  checkPageParams(request.params)
  const parameters = request.params
  const references = parameters.preciseReferences ?? []
  checkReferences(references, request.version)
  checkVibes(parameters.vibeReferences ?? [], request.version, references.length > 0)
  if (
    !Number.isInteger(parameters.count) ||
    parameters.count < 1 ||
    parameters.count > 8 ||
    typeof parameters.qualityTags !== 'boolean' ||
    (parameters.qualityMode !== undefined &&
      !['standard', 'light'].includes(parameters.qualityMode)) ||
    !isUcPreset(parameters.ucPreset) ||
    !Number.isFinite(parameters.cfgRescale) ||
    parameters.cfgRescale < 0 ||
    parameters.cfgRescale > 1 ||
    !isNaiNoiseSchedule(parameters.noiseSchedule) ||
    !isNaiSampler(parameters.sampler)
  ) {
    throw new Error('生成配置无效')
  }
  if (img2img !== undefined) {
    if (!validImg2Img(img2img)) {
      throw new Error('图生图底图或重绘参数无效')
    }
    await importReferenceImage(img2img.imageName)
  }
  return saveRecipe(
    '',
    {
      schema: 1,
      createdAt: Date.now(),
      sourceKind: 'generate',
      request: structuredClone(request),
    },
    img2img,
  )
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
    sourceKind: generationSnapshot.execution.kind,
    request: {
      ...structuredClone(generationSnapshot.draft),
      version: generationSnapshot.model,
      params: { ...generationSnapshot.params, count: 1, qualityTags: false, ucPreset: 'none' },
    },
  }
  return saveRecipe(version.image?.name ?? '', recipe)
}
function saveRecipe(imageName: string, recipe: ImageRecipe, img2img?: Img2ImgBase): SavedRecipe {
  const path = libraryImagePath(imageName)
  const originalBytes = path ? readFileSync(path) : undefined
  const bytes = originalBytes ? embedRecipe(originalBytes, recipe) : undefined
  const contentHash = bytes ? createHash('sha256').update(bytes).digest('hex') : undefined
  if (contentHash) {
    const favorites = listRecipes()
    let existing = favorites.find((item) => item.contentHash === contentHash)
    if (!existing && recipe.sourceKind === 'img2img' && originalBytes) {
      const legacyBytes = embedRecipe(originalBytes, { ...recipe, sourceKind: 'inpaint' })
      const legacyHash = createHash('sha256').update(legacyBytes).digest('hex')
      const legacyFavorite = favorites.find((item) => item.contentHash === legacyHash)
      // Compare the exact old encoding only when the PNG carries image-to-image provenance.
      if (legacyFavorite && readPngRecipe(legacyBytes)?.sourceKind === 'img2img') {
        existing = legacyFavorite
      }
    }
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
    ...(img2img ? { img2img: { ...img2img } } : {}),
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
