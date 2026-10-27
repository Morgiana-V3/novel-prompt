import { PNG } from 'pngjs'
import type { PageRegion } from '../../../shared/workspace/model'
import { prepareInpaint } from '../generation/inpaint'

/** Union only the selected masks, retaining feathering and all unselected pixels. */
export function mergeRegionMasks(
  source: Buffer,
  regions: PageRegion[],
  width: number,
  height: number,
): string {
  if (!regions.length) {
    throw new Error('请至少选择一个重绘区域')
  }
  const merged = new PNG({ width, height })
  for (const region of regions) {
    const { mask } = prepareInpaint(source, region.mask, width, height)
    for (let i = 0; i < mask.data.length; i += 4) {
      const value = Math.max(merged.data[i], mask.data[i])
      merged.data.fill(value, i, i + 3)
      merged.data[i + 3] = 255
    }
  }
  return PNG.sync.write(merged).toString('base64')
}
