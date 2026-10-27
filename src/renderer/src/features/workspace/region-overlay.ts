import type { PageRegion } from '@shared/workspace/model'

/** Canvas-only preview; the main process independently validates and merges execution masks. */
export async function regionOverlay(
  regions: PageRegion[],
  focusedId: string | null,
): Promise<string> {
  if (!regions.length) {
    return ''
  }
  const images = await Promise.all(
    regions.map(async (region) => {
      const image = new Image()
      image.src = `data:image/png;base64,${region.mask}`
      await image.decode()
      return image
    }),
  )
  const canvas = document.createElement('canvas')
  canvas.width = images[0].width
  canvas.height = images[0].height
  const context = canvas.getContext('2d')!
  const overlay = context.createImageData(canvas.width, canvas.height)
  const bounds = images.map((image, index) => {
    context.clearRect(0, 0, canvas.width, canvas.height)
    context.drawImage(image, 0, 0)
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data
    let left = canvas.width
    let top = canvas.height
    let right = 0
    let bottom = 0
    for (let i = 0; i < pixels.length; i += 4) {
      if (!pixels[i]) {
        continue
      }
      const x = (i / 4) % canvas.width
      const y = Math.floor(i / 4 / canvas.width)
      left = Math.min(left, x)
      top = Math.min(top, y)
      right = Math.max(right, x)
      bottom = Math.max(bottom, y)
      const alpha = Math.round(pixels[i] * (regions[index].id === focusedId ? 0.48 : 0.28))
      if (alpha > overlay.data[i + 3]) {
        overlay.data.set([255, 107, 154, alpha], i)
      }
    }
    return { left, top, right, bottom }
  })
  context.putImageData(overlay, 0, 0)
  const fontSize = Math.max(18, Math.round(canvas.width / 40))
  context.font = `bold ${fontSize}px sans-serif`
  context.textBaseline = 'top'
  bounds.forEach((box, index) => {
    if (box.left > box.right) {
      return
    }
    const label = regions[index].label
    const width = context.measureText(label).width + 12
    context.fillStyle = '#b83266'
    context.fillRect(box.left, box.top, width, fontSize + 8)
    context.fillStyle = '#ffffff'
    context.fillText(label, box.left + 6, box.top + 4)
    if (regions[index].id === focusedId) {
      context.strokeStyle = '#b83266'
      context.lineWidth = Math.max(2, canvas.width / 350)
      context.strokeRect(box.left, box.top, box.right - box.left + 1, box.bottom - box.top + 1)
    }
  })
  return canvas.toDataURL('image/png')
}
