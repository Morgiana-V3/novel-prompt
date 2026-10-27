import type { PageRegion, PageVersion } from './model'

/** Arrays are authoritative; a missing array reads existing single-region records. */
export function regionIds(selection: { regionIds?: string[]; regionId?: string | null }): string[] {
  if (selection.regionIds !== undefined && !Array.isArray(selection.regionIds)) {
    throw new Error('区域列表格式无效')
  }
  return selection.regionIds ?? (selection.regionId ? [selection.regionId] : [])
}

export function selectRegions(
  version: PageVersion,
  selection: string | string[] | null,
): PageRegion[] {
  const value = selection === null ? [] : selection
  const ids = Array.isArray(value) ? value : [value]
  if (
    ids.length > 16 ||
    ids.some((id) => typeof id !== 'string' || !id) ||
    new Set(ids).size !== ids.length
  ) {
    throw new Error('请选择不重复的有效区域，最多 16 个')
  }
  return ids.map((id) => {
    const region = version.editor.regions.find((item) => item.id === id)
    if (!region) {
      throw new Error('选区已不存在，请重新选择')
    }
    return region
  })
}

export function regionNotes(regions: PageRegion[]) {
  return regions.map(({ id, label, instruction, target }) => ({ id, label, instruction, target }))
}
