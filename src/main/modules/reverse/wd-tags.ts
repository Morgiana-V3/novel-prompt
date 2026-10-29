import type { ReverseTag } from '../../../shared/reverse/types'

function csvRows(text: string): string[][] {
  // CSV names can contain commas and escaped quotes.
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (c === '"') {
      if (quoted && text[i + 1] === '"') {
        field += '"'
        i++
      } else {
        quoted = !quoted
      }
    } else if (!quoted && (c === ',' || c === '\n')) {
      row.push(field.replace(/\r$/, ''))
      field = ''
      if (c === '\n') {
        rows.push(row)
        row = []
      }
    } else {
      field += c
    }
  }
  if (field || row.length) {
    rows.push([...row, field.replace(/\r$/, '')])
  }
  return rows
}

/** WD's general and character outputs are independent multi-label scores.
 * Category-specific filtering follows ComfyUI-WD14-Tagger; retain low-score
 * candidates here so adjusting the UI threshold does not rerun inference.
 */
export function decodeWdTags(
  csv: string,
  scores: number[],
): {
  tags: ReverseTag[]
  characters: ReverseTag[]
} {
  const rows = csvRows(csv)
  const header = rows.shift() ?? []
  const name = header.indexOf('name')
  const category = header.indexOf('category')
  if (name < 0 || category < 0 || rows.length !== scores.length) {
    throw new Error('WD 标签表与模型输出不匹配')
  }
  const ranked = scores
    .map((score, i) => ({
      name: rows[i][name],
      score,
      category: rows[i][category],
    }))
    .filter((tag) => tag.name && Number.isFinite(tag.score) && tag.score >= 0.05 && tag.score <= 1)
    .sort((a, b) => b.score - a.score)
  const group = (category: string, limit: number) =>
    ranked
      .filter((tag) => tag.category === category)
      .slice(0, limit)
      .map(({ name, score }) => ({ name: name.replaceAll('_', ' '), score }))
  return { tags: group('0', 256), characters: group('4', 50) }
}
