import type {
  AiPreviewResult,
  Basis,
  Confidence,
  PreviewEffect,
  PreviewPoint,
  PreviewRisk,
  PreviewSuggestion,
} from '../../../shared/prompts/types'
const CONF: Confidence[] = ['high', 'medium', 'low']
const BASES: Basis[] = ['rule', 'data', 'doc', 'taste']
const conf = (value: unknown, fallbackConfidence: Confidence = 'medium'): Confidence =>
  CONF.includes(value as Confidence) ? (value as Confidence) : fallbackConfidence
const basis = (value: unknown): Basis => (BASES.includes(value as Basis) ? (value as Basis) : 'doc')
const str = (value: unknown) => {
  if (typeof value === 'string') {
    return value.trim()
  }
  if (value == null) {
    return '' as const
  }
  return String(value)
}
const strList = (value: unknown) => (Array.isArray(value) ? value.map(str).filter(Boolean) : [])
const asRecord = (value: unknown) =>
  value && typeof value === 'object' ? (value as Record<string, unknown>) : {}

function point(value: unknown): PreviewPoint {
  const record = typeof value === 'string' ? { text: value } : asRecord(value)
  return { text: str(record.text), tags: strList(record.tags), confidence: conf(record.confidence) }
}

function effects(value: unknown): PreviewEffect[] {
  return (Array.isArray(value) ? value : [])
    .map((candidate) => ({
      tag: str(asRecord(candidate).tag),
      effect: str(asRecord(candidate).effect),
    }))
    .filter((effect) => effect.tag || effect.effect)
}

export function normalizePreview(
  raw: Record<string, unknown>,
): Omit<AiPreviewResult, 'issues' | 'tagCount' | 'evidence'> {
  return {
    summary: str(raw.summary),
    confidence: conf(raw.confidence),
    style: point(raw.style),
    composition: point(raw.composition),
    scene: point(raw.scene),
    lighting: point(raw.lighting),
    characters: (Array.isArray(raw.characters) ? raw.characters : []).map((character, i) => {
      const record = asRecord(character)
      return {
        ...point(record),
        name: str(record.name) || `角色 ${i + 1}`,
        position: str(record.position) || undefined,
      }
    }),
    emphasis: effects(raw.emphasis),
    suppressed: effects(raw.suppressed),
    risks: (Array.isArray(raw.risks) ? raw.risks : [])
      .map((riskInput): PreviewRisk => {
        const record = asRecord(riskInput)
        return {
          level: conf(record.level, 'medium'),
          text: str(record.text),
          tags: strList(record.tags),
          basis: basis(record.basis),
          evidence: str(record.evidence),
        }
      })
      .filter((risk) => risk.text),
    gap: str(raw.gap),
    suggestions: (Array.isArray(raw.suggestions) ? raw.suggestions : [])
      .map((candidate): PreviewSuggestion => {
        const record = typeof candidate === 'string' ? { text: candidate } : asRecord(candidate)
        return {
          text: str(record.text),
          basis: basis(record.basis),
          evidence: str(record.evidence),
        }
      })
      .filter((suggestion) => suggestion.text),
  }
}
