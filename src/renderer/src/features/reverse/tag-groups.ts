/**
 * 反推标签的展示分组：识别模型只给出标签和分数，没有语义分类，
 * 这里按常见词根粗分，方便用户按类别扫一眼、划掉不要的。只影响展示顺序，不改动标签本身。
 */
export type TagGroup =
  'composition' | 'appearance' | 'expression' | 'clothing' | 'pose' | 'scene' | 'style' | 'other'

export const TAG_GROUPS: { key: TagGroup; label: string }[] = [
  { key: 'composition', label: '人数与构图' },
  { key: 'appearance', label: '外观' },
  { key: 'expression', label: '表情' },
  { key: 'clothing', label: '服装与配饰' },
  { key: 'pose', label: '动作' },
  { key: 'scene', label: '场景' },
  { key: 'style', label: '画风' },
  { key: 'other', label: '其他' },
]

const RULES: [TagGroup, RegExp][] = [
  [
    'composition',
    /^(?:solo|solo focus|\d\+?(?:girls?|boys?|others?)|multiple (?:girls|boys|views)|no humans|looking (?:at|away|back|down|up|to the side).*|from (?:above|below|side|behind|front)|upper body|lower body|full body|cowboy shot|portrait|close-up|profile|dutch angle|pov|wide shot|straight-on|facing (?:viewer|away)|head out of frame|feet out of frame|out of frame|cropped .*)$/,
  ],
  [
    'style',
    /(?:monochrome|greyscale|grayscale|comic|manga|sketch|lineart|line art|traditional media|watercolor|realistic|chibi|pixel art|halftone|screentone|speech bubble|sound effects|translated|border|signature|watermark|text$|english text|japanese text|artist name|dated|page number)/,
  ],
  [
    'expression',
    /(?:smile|grin|blush|closed mouth|open mouth|teeth|tongue|frown|pout|crying|tears|angry|sad|surprised|embarrassed|expressionless|smirk|sleepy|wink|half-closed eyes|closed eyes|^:[a-z3d<>]$|^;[a-z]$|>_<|parted lips|sweat)/,
  ],
  [
    'clothing',
    /(?:shirt|dress|skirt|uniform|jacket|coat|hoodie|sweater|cardigan|vest|sleeves?|collar|ribbon|bow|necktie|neckerchief|tie$|sock|thighhighs|pantyhose|legwear|shoes|boots|sandals|slippers|gloves|hat|cap$|beret|hood|glasses|eyewear|earrings|necklace|choker|jewelry|bracelet|swimsuit|bikini|kimono|yukata|apron|sailor|serafuku|shorts|pants|jeans|leggings|underwear|bra$|panties|pajamas|scarf|belt|buttons|pocket|zipper|frills|lace|hairclip|hair ornament|hairband|headband|hair ribbon|hair bow|headwear|bag|backpack|wristwatch|armband|cape|cloak|armor|nude|naked|bare (?:shoulders|legs|arms|feet)|barefoot|clothes|outfit|costume|bodysuit|leotard|camisole|tank top|t-shirt|blouse|overalls)/,
  ],
  [
    'pose',
    /(?:sitting|standing|lying|kneeling|squatting|walking|running|jumping|leaning|bending|crossed (?:arms|legs)|arms? (?:up|behind)|hands? (?:on|up|in|between|together)|holding|hugging|reaching|pointing|waving|peace sign|v$|stretching|sleeping|waking up|eating|drinking|reading|writing|rubbing|covering|carrying|grabbing|touching|spread|on (?:back|side|stomach)|pose|posing|hand|arm|legs? (?:up|together)|head tilt|motion)/,
  ],
  [
    'appearance',
    /(?:hair|bangs|ahoge|sidelocks|twintails|ponytail|braids?|bun|eyes|eyebrows|eyelashes|pupils|heterochromia|skin|freckles|mole|scar|breasts|chest|ears|tail|horns|wings|halo|fang|lips|nose|makeup|tan$|tanned|muscular|petite|tall|short$|child|teenage|mature|elf|animal|kemonomimi|cat girl|fox girl|loli|shota|girl$|boy$|female|male)/,
  ],
  [
    'scene',
    /(?:indoors|outdoors|background|sky|cloud|sun|moon|star|night|day|evening|sunset|sunrise|tree|flower|petals|grass|leaf|leaves|forest|garden|field|room|bedroom|classroom|bathroom|kitchen|bed|pillow|blanket|floor|wall|window|door|curtains|table|desk|chair|sofa|couch|stairs|building|city|street|road|town|house|school|beach|ocean|sea|water|river|lake|rain|snow|wind|light|lighting|shadow|lamp|sunlight|scenery|nature|plant|vase|book|cup|food)/,
  ],
]

export function tagGroup(tag: string): TagGroup {
  const name = tag.trim().toLowerCase().replaceAll('_', ' ')
  for (const [group, pattern] of RULES) {
    if (pattern.test(name)) {
      return group
    }
  }
  return 'other'
}
