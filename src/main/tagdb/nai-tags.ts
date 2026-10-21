import type { NaiVersion } from '../../shared/types'

export interface NaiTagDef {
  name: string
  zh: string
  versions: NaiVersion[]
}

const BOTH: NaiVersion[] = ['v4.5', 'v5']
const V5: NaiVersion[] = ['v5']

/** NovelAI 自有的、Danbooru 中不存在或含义不同的 tag（以空格形式书写） */
export const NAI_TAGS: NaiTagDef[] = [
  // 角色提示词中的性别标记
  { name: 'girl', zh: '女孩（角色提示词）', versions: BOTH },
  { name: 'boy', zh: '男孩（角色提示词）', versions: BOTH },
  { name: 'other', zh: '其他（角色提示词）', versions: BOTH },
  // 质量 / 美学
  { name: 'masterpiece', zh: '杰作', versions: BOTH },
  { name: 'best quality', zh: '最佳质量', versions: BOTH },
  { name: 'amazing quality', zh: '惊人质量', versions: BOTH },
  { name: 'great quality', zh: '优秀质量', versions: BOTH },
  { name: 'good quality', zh: '良好质量', versions: BOTH },
  { name: 'normal quality', zh: '一般质量', versions: BOTH },
  { name: 'bad quality', zh: '差质量', versions: BOTH },
  { name: 'low quality', zh: '低质量', versions: BOTH },
  { name: 'worst quality', zh: '最差质量', versions: BOTH },
  { name: 'very aesthetic', zh: '非常美观', versions: BOTH },
  { name: 'aesthetic', zh: '美观', versions: BOTH },
  { name: 'displeasing', zh: '不美观', versions: BOTH },
  { name: 'very displeasing', zh: '非常不美观', versions: BOTH },
  { name: 'no text', zh: '无文字', versions: BOTH },
  { name: 'too many watermarks', zh: '过多水印', versions: BOTH },
  { name: 'artistic error', zh: '作画错误', versions: BOTH },
  { name: 'blank page', zh: '空白页', versions: BOTH },
  { name: 'location', zh: '场景（无人物）', versions: BOTH },
  { name: 'fur dataset', zh: '兽人数据集', versions: BOTH },
  { name: 'background dataset', zh: '背景数据集', versions: BOTH },
  // V5 新增
  { name: 'depthness', zh: '阴影层次/纵深感', versions: V5 },
  { name: 'attractive male', zh: '帅气男性', versions: V5 },
  { name: 'low complexity', zh: '低复杂度', versions: V5 },
  { name: 'medium complexity', zh: '中复杂度', versions: V5 },
  { name: 'high complexity', zh: '高复杂度', versions: V5 },
  { name: 'ultra complexity', zh: '超高复杂度', versions: V5 },
  { name: 'meta:novel era', zh: '偏新画风', versions: V5 },
  { name: 'meta:golden era', zh: '偏旧画风', versions: V5 },
  { name: 'visual novel art', zh: '视觉小说画风', versions: V5 },
  { name: 'visual novel bg', zh: '视觉小说背景', versions: V5 },
  { name: 'visual novel cg', zh: '视觉小说CG', versions: V5 },
  { name: 'visual novel chibi', zh: '视觉小说Q版', versions: V5 },
  { name: 'visual novel sprite', zh: '视觉小说立绘', versions: V5 },
  { name: 'alpha transparency', zh: '半透明（alpha）', versions: V5 },
  { name: 'has alpha', zh: '使用alpha通道', versions: V5 }
]

/** year 2020 这类年份 tag */
export const YEAR_TAG_RE = /^year\s?\d{4}$/
