import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type Sharp from 'sharp'
import type * as Onnx from 'onnxruntime-node'
import {
  reverseModels,
  type ReverseResult,
  type ReverseTag,
  type ReverseModel,
} from '../../../shared/reverse/types'

import { decodeWdTags } from './wd-tags'

const send = (value: unknown) => process.parentPort?.postMessage(value)
let sharp: typeof Sharp
let onnx: typeof Onnx

async function tensor(image: Buffer, kind: ReverseModel): Promise<Onnx.Tensor> {
  const { width = 0, height = 0 } = await sharp(image).metadata()
  if (!width || !height) {
    throw new Error('无法读取图片尺寸')
  }
  if (kind === 'pixai') {
    const size = 1008
    const scale = size / Math.max(width, height)
    const w = Math.round(width * scale)
    const h = Math.round(height * scale)
    const resized = await sharp(image)
      .resize(w, h, { kernel: 'cubic', fit: 'fill' })
      .png()
      .toBuffer()
    const data = await sharp(resized)
      .extend({
        left: Math.floor((size - w) / 2),
        right: Math.ceil((size - w) / 2),
        top: Math.floor((size - h) / 2),
        bottom: Math.ceil((size - h) / 2),
        background: 'black',
      })
      .removeAlpha()
      .raw()
      .toBuffer()
    const values = new Float32Array(size * size * 3)
    for (let p = 0; p < size * size; p++) {
      for (let c = 0; c < 3; c++) {
        values[c * size * size + p] = data[p * 3 + c] / 127.5 - 1
      }
    }
    return new onnx.Tensor('float32', values, [1, 3, size, size])
  }
  if (kind === 'wd') {
    const side = Math.max(width, height)
    const padded = await sharp(image)
      .extend({
        left: Math.floor((side - width) / 2),
        right: Math.ceil((side - width) / 2),
        top: Math.floor((side - height) / 2),
        bottom: Math.ceil((side - height) / 2),
        background: 'white',
      })
      .png()
      .toBuffer()
    const data = await sharp(padded)
      .resize(448, 448, { kernel: 'cubic' })
      .removeAlpha()
      .raw()
      .toBuffer()
    const values = new Float32Array(data.length)
    for (let i = 0; i < data.length; i += 3) {
      values[i] = data[i + 2]
      values[i + 1] = data[i + 1]
      values[i + 2] = data[i]
    }
    return new onnx.Tensor('float32', values, [1, 448, 448, 3])
  }
  const scale = 512 / Math.min(width, height)
  const w = Math.floor(width * scale)
  const h = Math.floor(height * scale)
  const size = kind === 'k2' ? 448 : 512
  const resized = await sharp(image).resize(w, h, { kernel: 'cubic', fit: 'fill' }).png().toBuffer()
  const data = await sharp(resized)
    .extract({
      left: Math.round((w - size) / 2),
      top: Math.round((h - size) / 2),
      width: size,
      height: size,
    })
    .removeAlpha()
    .raw()
    .toBuffer()
  const values = new Float32Array(size * size * 3)
  const mean = [0.485, 0.456, 0.406]
  const std = [0.229, 0.224, 0.225]
  for (let p = 0; p < size * size; p++) {
    for (let c = 0; c < 3; c++) {
      values[c * size * size + p] = (data[p * 3 + c] / 255 - mean[c]) / std[c]
    }
  }
  return new onnx.Tensor('float32', values, [1, 3, size, size])
}

async function main(): Promise<void> {
  const [directory, input, selected] = process.argv.slice(2)
  const start = Date.now()
  send({ stage: '正在加载本地识别引擎' })
  // Load native dependencies inside the error boundary so startup failures reach the UI.
  try {
    sharp = (await import('sharp')).default
    onnx = await import('onnxruntime-node')
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    throw new Error(
      '本地识别引擎加载失败（sharp / onnxruntime-node）。' +
        '开发版请在项目目录运行 npm install 补全依赖；安装版请重新安装软件。' +
        '重新下载模型无法修复此问题。\n' +
        reason,
    )
  }
  sharp.concurrency(2)
  const bytes = await readFile(input)
  const metadata = await sharp(bytes, { limitInputPixels: 24_000_000 }).metadata()
  if (!['png', 'jpeg', 'webp'].includes(metadata.format ?? '')) {
    throw new Error('仅支持 PNG、JPEG 或 WebP 图片')
  }
  const aspect = (metadata.width ?? 1) / (metadata.height ?? 1)
  if (aspect > 20 || aspect < 0.05) {
    throw new Error('图片过长或过窄，请裁切后重试')
  }
  const image = await sharp(bytes, { limitInputPixels: 24_000_000, animated: false })
    .rotate()
    .resize({ width: 2048, height: 2048, fit: 'inside', withoutEnlargement: true })
    .flatten({ background: 'white' })
    .toColourspace('srgb')
    .removeAlpha()
    .png()
    .toBuffer()
  const result: ReverseResult = { tags: [], characters: [], artists: [], seconds: 0, warnings: [] }
  for (const kind of reverseModels(
    selected && selected !== 'undefined' ? JSON.parse(selected) : undefined,
  )) {
    const stages = {
      wd: '基础内容与角色',
      pixai: '角色（PixAI）',
      k2: '画师风格（K2）',
      k3: '画师风格（K3）',
    }
    send({ stage: `正在识别${stages[kind]}` })
    const session = await onnx.InferenceSession.create(join(directory, kind + '.onnx'), {
      executionProviders: ['cpu'],
      intraOpNumThreads: 4,
      interOpNumThreads: 1,
    })
    try {
      const output = await session.run({ [session.inputNames[0]]: await tensor(image, kind) })
      const scores = Array.from(output[session.outputNames[0]].data as Float32Array)
      if (kind === 'pixai') {
        const decoded = decodeWdTags(
          await readFile(join(directory, 'pixai-tags.csv'), 'utf8'),
          scores,
        )
        result.characters = decoded.characters
        result.characterModel = 'pixai'
      } else if (kind === 'wd') {
        result.characterModel = 'wd'
        Object.assign(
          result,
          decodeWdTags(await readFile(join(directory, 'wd-tags.csv'), 'utf8'), scores),
        )
      } else {
        if (kind === 'k3') {
          const embedding = output.style
          if (embedding) {
            result.style = Array.from(embedding.data as Float32Array)
          }
        }
        const labels: string[] = JSON.parse(
          await readFile(join(directory, kind + '-labels.json'), 'utf8'),
        )
        const max = Math.max(...scores)
        const probabilities = scores.map((x) => Math.exp(x - max))
        const total = probabilities.reduce((a, b) => a + b, 0)
        const tags: ReverseTag[] = probabilities
          .map((score, i) => ({ name: labels[i].replaceAll('_', ' '), score: score / total }))
          .sort((a, b) => b.score - a.score)
          .slice(0, 20)
        result.artists.push({ model: kind === 'k2' ? 'Kaloscope 2' : 'Kaloscope 3', tags })
      }
    } finally {
      await session.release()
    }
  }
  if (
    result.tags.some(
      (t) =>
        t.score >= 0.5296 && /^(?:[2-9]girls|[2-9]boys|multiple girls|multiple boys)$/.test(t.name),
    )
  ) {
    result.warnings.push('检测到多个人物：基础标签尚未区分属性属于谁，请在生图前按人物拆分。')
  }
  if (
    reverseModels(selected && selected !== 'undefined' ? JSON.parse(selected) : undefined).includes(
      'wd',
    ) &&
    !result.tags.length
  ) {
    result.warnings.push('没有识别到足够可靠的基础标签，可更换清晰的插画图片再试。')
  }
  result.warnings.push('画师候选只表示风格接近；分数不是原作者判定，也不是画师权重。')
  result.seconds = (Date.now() - start) / 1000
  send({ result })
}

main().catch((error: unknown) =>
  send({ error: error instanceof Error ? error.message : String(error) }),
)
