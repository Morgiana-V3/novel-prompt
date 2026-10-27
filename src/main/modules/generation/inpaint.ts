import { PNG } from 'pngjs'
import { pngSize } from '../../providers/novelai/png-response'

const MAX_PIXELS = 4 * 1024 * 1024
const MAX_BYTES = 40 * 1024 * 1024

function decode(data: Buffer, label: string): PNG {
  const size = pngSize(data)
  if (
    !size ||
    !size.width ||
    !size.height ||
    size.width * size.height > MAX_PIXELS ||
    data.length > MAX_BYTES
  ) {
    throw new Error(`${label}必须是有效 PNG，且不超过 4096×1024 总像素`)
  }
  try {
    return PNG.sync.read(data)
  } catch {
    throw new Error(`${label} PNG 已损坏，无法读取`)
  }
}

export interface PreparedInpaint {
  source: PNG
  mask: PNG
  imageBase64: string
  maskBase64: string
}

/**
 * 发送同原图尺寸的不透明黑白遮罩：白色重绘，黑色保留。
 * 官方客户端（novelai.net/image，2026-10-25）的 /8 遮罩只是中间数据；
 * 请求前 fillImageBackground(mask, 'black', height, width, false, false)
 * 还会最近邻放大并铺黑底，不能直接发送透明的 /8 PNG。
 * 本地保留完整分辨率遮罩用于合成，避免潜空间缩小后的遮罩影响选区外像素。
 */
export function prepareInpaint(
  sourceBytes: Buffer,
  maskBase64: string,
  width: number,
  height: number,
): PreparedInpaint {
  const source = decode(sourceBytes, '原图')
  if (source.width !== width || source.height !== height) {
    throw new Error('重绘尺寸必须与原图一致，请重新打开局部重绘')
  }
  if (width % 64 || height % 64) {
    throw new Error('原图宽高必须是 64 的倍数，局部重绘不会拉伸原图')
  }
  if (
    typeof maskBase64 !== 'string' ||
    maskBase64.length > (MAX_BYTES * 4) / 3 ||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(maskBase64)
  ) {
    throw new Error('遮罩数据无效')
  }
  const mask = decode(Buffer.from(maskBase64, 'base64'), '遮罩')
  if (mask.width !== width || mask.height !== height) {
    throw new Error('遮罩尺寸与原图不一致')
  }
  const latent = new PNG({ width: width / 8, height: height / 8 })
  let marked = false
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4
      const pixelValue = mask.data[i]
      if (
        mask.data[i + 1] !== pixelValue ||
        mask.data[i + 2] !== pixelValue ||
        mask.data[i + 3] !== 255
      ) {
        throw new Error('遮罩必须为不透明的黑白 PNG')
      }
      if (!pixelValue) {
        continue
      }
      marked = true
      const j = (Math.floor(y / 8) * latent.width + Math.floor(x / 8)) * 4
      latent.data.fill(255, j, j + 4)
    }
  }
  if (!marked) {
    throw new Error('请先涂出需要重绘的区域')
  }
  const wireMask = new PNG({ width, height })
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4
      const pixelValue = latent.data[(Math.floor(y / 8) * latent.width + Math.floor(x / 8)) * 4]
      wireMask.data.fill(pixelValue, i, i + 3)
      wireMask.data[i + 3] = 255
    }
  }
  return {
    source,
    mask,
    imageBase64: sourceBytes.toString('base64'),
    maskBase64: PNG.sync.write(wireMask).toString('base64'),
  }
}

/** 仅替换遮罩里的像素。透明度按 straight alpha 合成，遮罩外逐字节保留。 */
export function compositeInpaint(prepared: PreparedInpaint, generatedBytes: Buffer): Buffer {
  const generated = decode(generatedBytes, '重绘结果')
  const { source, mask } = prepared
  if (generated.width !== source.width || generated.height !== source.height) {
    throw new Error('重绘结果尺寸与原图不一致，未覆盖原图')
  }
  const result = new PNG({ width: source.width, height: source.height })
  source.data.copy(result.data)
  for (let i = 0; i < result.data.length; i += 4) {
    const m = mask.data[i] / 255
    if (!m) {
      continue
    }
    const a = (generated.data[i + 3] / 255) * m
    const b = (source.data[i + 3] / 255) * (1 - m)
    const alpha = a + b
    for (let c = 0; c < 3; c++) {
      result.data[i + c] = alpha
        ? Math.round((generated.data[i + c] * a + source.data[i + c] * b) / alpha)
        : 0
    }
    result.data[i + 3] = Math.round(alpha * 255)
  }
  // pngjs 不保留元数据：复制服务端的文本块，确保图库仍能读回本次提示词。
  const textChunks: Buffer[] = []
  for (let offset = 8; offset + 12 <= generatedBytes.length;) {
    const length = generatedBytes.readUInt32BE(offset)
    const end = offset + length + 12
    if (end > generatedBytes.length) {
      break
    }
    if (
      ['tEXt', 'iTXt', 'zTXt'].includes(generatedBytes.toString('ascii', offset + 4, offset + 8))
    ) {
      textChunks.push(generatedBytes.subarray(offset, end))
    }
    offset = end
  }
  const png = PNG.sync.write(result)
  return Buffer.concat([
    png.subarray(0, png.length - 12),
    ...textChunks,
    png.subarray(png.length - 12),
  ])
}
