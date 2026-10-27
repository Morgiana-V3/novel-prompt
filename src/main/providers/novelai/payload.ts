import {
  UC_PRESETS,
  joinPrompt,
  parsePosition,
  withQualityTags,
} from '../../../shared/generation/presets'
import type { NaiGenRequest, NaiInpaintRequest, NaiVersion } from '../../../shared/generation/types'
import type { AiCharacter } from '../../../shared/prompts/types'

export const MODEL_ID: Record<NaiVersion, string> = {
  'v4.5': 'nai-diffusion-4-5-full',
  v5: 'nai-diffusion-5-full',
}

/* ---------- 请求体 ---------- */

export function characterCaptions(chars: AiCharacter[]) {
  const list = chars.filter((character) => character.prompt?.trim())
  const parsed = list.map((character) => parsePosition(character.position))
  const useCoords = parsed.some(Boolean)
  // 有任意角色指定了位置就启用坐标，没写位置的角色按顺序从左到右均匀排开
  const centers = parsed.map(
    (position, i) => position ?? { x: Math.round(((i + 1) / (list.length + 1)) * 10) / 10, y: 0.5 },
  )
  return {
    useCoords,
    positive: list.map((character, i) => ({
      char_caption: character.prompt.trim(),
      centers: [centers[i]],
    })),
    negative: list.map((character, i) => ({
      char_caption: character.negative?.trim() ?? '',
      centers: [centers[i]],
    })),
  }
}

export function buildBody(req: NaiGenRequest, seed: number): Record<string, unknown> {
  const parameters = req.params
  const input = parameters.qualityTags ? withQualityTags(req.base, req.version) : req.base.trim()
  const negative = joinPrompt(req.negative, UC_PRESETS[req.version][parameters.ucPreset])
  const chars = characterCaptions(req.characters)
  return {
    input,
    model: MODEL_ID[req.version],
    action: 'generate',
    parameters: {
      params_version: 3,
      width: parameters.width,
      height: parameters.height,
      steps: parameters.steps,
      scale: parameters.scale,
      cfg_rescale: parameters.cfgRescale,
      n_samples: 1,
      seed,
      sampler: parameters.sampler,
      noise_schedule: parameters.noiseSchedule,
      // 质量词和 UC 预设已由本工具显式拼进提示词，服务端开关保持关闭，发送的内容就是最终内容
      qualityToggle: false,
      ucPreset: 3,
      negative_prompt: negative,
      sm: false,
      sm_dyn: false,
      dynamic_thresholding: false,
      legacy: false,
      legacy_v3_extend: false,
      v4_prompt: {
        caption: { base_caption: input, char_captions: chars.positive },
        use_coords: chars.useCoords,
        use_order: true,
      },
      v4_negative_prompt: {
        caption: { base_caption: negative, char_captions: chars.negative },
        legacy_uc: false,
      },
    },
  }
}

export function buildInpaintBody(
  req: NaiInpaintRequest,
  seed: number,
  prepared: { imageBase64: string; maskBase64: string },
): Record<string, unknown> {
  const body = buildBody(req, seed)
  const parameters = body.parameters as Record<string, unknown>
  body.action = 'infill'
  body.model = `${MODEL_ID[req.version]}-inpainting`
  Object.assign(parameters, {
    params_version: 4,
    image: prepared.imageBase64,
    mask: prepared.maskBase64,
    add_original_image: false, // 完整分辨率的选区在本地合成，确保选区外不变
    extra_noise_seed: (seed + 4_294_967_295) >>> 0,
  })
  if (req.inpaint.strength < 1) {
    parameters.img2img = { strength: req.inpaint.strength, color_correct: true }
  }
  if (req.version === 'v5' || req.params.noiseSchedule === 'native') {
    parameters.noise_schedule = 'karras'
  }
  if (req.params.sampler === 'k_euler_ancestral') {
    parameters.deliberate_euler_ancestral_bug = false
    parameters.prefer_brownian = true
  }
  return body
}
