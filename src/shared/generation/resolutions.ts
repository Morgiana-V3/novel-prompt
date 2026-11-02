/** Full V4.5 / V5 presets from NovelAI's image settings (checked 2026-11-02). */
export const RESOLUTION_PRESETS = [
  {
    key: 'normal',
    label: '标准 · Normal',
    portrait: [832, 1216],
    landscape: [1216, 832],
    square: [1024, 1024],
  },
  {
    key: 'large',
    label: '大图 · Large',
    portrait: [1024, 1536],
    landscape: [1536, 1024],
    square: [1472, 1472],
  },
  {
    key: 'wallpaper',
    label: '壁纸 · Wallpaper',
    portrait: [1088, 1920],
    landscape: [1920, 1088],
    square: null,
  },
  {
    key: 'small',
    label: '小图 · Small',
    portrait: [512, 768],
    landscape: [768, 512],
    square: [640, 640],
  },
] as const
export type Orientation = 'portrait' | 'landscape' | 'square'
export function resolutionPreset(width: number, height: number) {
  for (const preset of RESOLUTION_PRESETS) {
    for (const orientation of ['portrait', 'landscape', 'square'] as const) {
      const size = preset[orientation]
      if (size?.[0] === width && size[1] === height) {
        return { tier: preset.key, orientation }
      }
    }
  }
  return null
}
