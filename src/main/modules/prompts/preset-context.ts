import {
  qualityTagsFor,
  effectiveQualityMode,
  UC_PRESETS,
  UC_LABEL,
  withQualityTags,
  joinPrompt,
} from '../../../shared/generation/presets'
import type { NaiVersion, UcPreset } from '../../../shared/generation/types'

export interface PromptPresets {
  qualityTags: boolean
  qualityMode?: 'standard' | 'light'
  ucPreset: UcPreset
}

/** Use the same preset strings as the generation payload; never write them into the editable draft. */
export function presetContext(
  version: NaiVersion,
  presets?: PromptPresets,
  base = '',
  negative = '',
): string {
  if (!presets) {
    return '## 内置提示词设置\n调用方未提供质量词或 UC 预设状态；不要假定开启或关闭，也不要声称其必然影响画面。'
  }
  const quality = qualityTagsFor(version, effectiveQualityMode(version, presets))
  const uc = UC_PRESETS[version][presets.ucPreset]
  return [
    '## 内置提示词设置（与实际生图一致）',
    `Add Quality Tags：${presets.qualityTags ? `开启（${effectiveQualityMode(version, presets)}）` : '关闭'}；自动附加：${quality || '无'}`,
    `UC 预设：${UC_LABEL[presets.ucPreset]}；自动附加：${uc || '无'}`,
    `当前实际主提示词：${presets.qualityTags ? withQualityTags(base, version, presets.qualityMode) : base.trim()}`,
    `当前实际负面提示词：${joinPrompt(negative, uc)}`,
    '输出 positive / negative 仍是用户可编辑部分，不要把上述自动附加词再抄入结果。已开启的预设不需要靠重复添加同义质量词或负面词补齐；关闭时不要擅自补回整套预设，应按用户目标及启用规则决定。',
    '必须检查预设与用户意图的冲突：例如 no text 与画面文字、screentone / halftone 与漫画网点、multiple views 与多格画面。预设是外部设置，修改可编辑提示词不能取消它；若需要调整开关或 UC，在 changes 中给出 scope=optional 的明确设置建议，注明当前状态与冲突词，不要声称已替用户更改设置。不要为了迁就预设删除用户明确要求的风格、权重或文字内容。',
  ].join('\n')
}
