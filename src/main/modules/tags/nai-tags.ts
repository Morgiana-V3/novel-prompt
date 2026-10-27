import { NAI_VERSIONS } from '../../../shared/generation/types'
import type { NaiVersion } from '../../../shared/generation/types'

export interface NaiTagDef {
  name: string
  zh: string
  versions: NaiVersion[]
}

const BOTH: NaiVersion[] = [...NAI_VERSIONS]
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
  { name: 'has alpha', zh: '使用alpha通道', versions: V5 },
  // NAI 负面预设（Undesired Content）里用到、但 Danbooru 高频库里没有的写法
  { name: 'screentone', zh: '网点纸', versions: BOTH },
  { name: 'white haze', zh: '白色雾感', versions: BOTH },
  { name: 'extra people', zh: '多余的人物', versions: BOTH },
  { name: 'upscale', zh: '放大痕迹', versions: BOTH },
  { name: 'distracting watermark', zh: '干扰性水印', versions: BOTH },
  { name: 'widescreen', zh: '宽银幕/上下黑边', versions: BOTH },
  { name: 'sequence', zh: '连续画面', versions: BOTH },
  { name: 'grandfathered content', zh: '历史遗留内容', versions: BOTH },
  { name: 'blurred foreground', zh: '前景模糊', versions: BOTH },
  { name: 'simple', zh: '简单化', versions: BOTH },
  { name: 'flat colors', zh: '平涂配色', versions: BOTH },
  { name: 'multiple scenes', zh: '多个场景', versions: BOTH },
  { name: 'ych (character)', zh: 'YCH 委托角色', versions: BOTH },
  { name: 'text', zh: '文字', versions: BOTH },
  // 内容分级：V4.5 Curated 的 Add Quality Tags 会自动追加 rating:general
  { name: 'rating:general', zh: '分级：全年龄', versions: BOTH },
  { name: 'rating:questionable', zh: '分级：敏感', versions: BOTH },
  { name: 'rating:explicit', zh: '分级：限制级', versions: BOTH },
]

/** year 2020 这类年份 tag */
export const YEAR_TAG_RE = /^year\s?\d{4}$/
