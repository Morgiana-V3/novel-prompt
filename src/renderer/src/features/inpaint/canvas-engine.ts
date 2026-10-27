import type { Region, Stroke } from './model'

export function drawStroke(ctx: CanvasRenderingContext2D, stroke: Stroke) {
  ctx.globalCompositeOperation = stroke.tool === 'erase' ? 'destination-out' : 'source-over'
  ctx.fillStyle = '#ff6b9a'
  ctx.strokeStyle = '#ff6b9a'
  const first = stroke.points[0]
  if (stroke.tool === 'rect') {
    const end = stroke.points[stroke.points.length - 1]
    ctx.fillRect(
      Math.min(first.x, end.x),
      Math.min(first.y, end.y),
      Math.abs(end.x - first.x),
      Math.abs(end.y - first.y),
    )
    return
  }
  ctx.lineWidth = stroke.radius * 2
  ctx.lineJoin = 'round'
  ctx.lineCap = 'round'
  ctx.beginPath()
  ctx.arc(first.x, first.y, stroke.radius, 0, Math.PI * 2)
  ctx.fill()
  ctx.beginPath()
  ctx.moveTo(first.x, first.y)
  for (const point of stroke.points.slice(1)) {
    ctx.lineTo(point.x, point.y)
  }
  ctx.stroke()
}

export function createMaskCanvas(pixels: Uint8ClampedArray, width: number, height: number) {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!
  const data = ctx.createImageData(width, height)
  data.data.set(pixels)
  ctx.putImageData(data, 0, 0)
  return canvas
}

export function toCanvasPoint(
  event: Pick<MouseEvent, 'clientX' | 'clientY'>,
  bounds: Pick<DOMRect, 'left' | 'top' | 'width' | 'height'>,
  width: number,
  height: number,
) {
  return {
    x: Math.max(0, Math.min(width, ((event.clientX - bounds.left) / bounds.width) * width)),
    y: Math.max(0, Math.min(height, ((event.clientY - bounds.top) / bounds.height) * height)),
  }
}

export function encodeMask(canvas: HTMLCanvasElement, width: number, height: number) {
  const data = canvas.getContext('2d')!.getImageData(0, 0, width, height)
  for (let i = 0; i < data.data.length; i += 4) {
    const alpha = data.data[i + 3]
    data.data[i + 2] = alpha
    data.data[i + 1] = alpha
    data.data[i] = alpha
    data.data[i + 3] = 255
  }
  const output = document.createElement('canvas')
  output.width = width
  output.height = height
  output.getContext('2d')!.putImageData(data, 0, 0)
  return output.toDataURL('image/png').split(',')[1]
}

export function createRegionLayer(region: Region, width: number, height: number) {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!
  if (region.baseMask) {
    ctx.drawImage(region.baseMask, 0, 0)
  }
  for (const stroke of region.strokes) {
    drawStroke(ctx, stroke)
  }
  return canvas
}
