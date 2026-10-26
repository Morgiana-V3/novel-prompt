/**
 * 把本机已下载 / 翻译好的数据导出为默认数据（default-data/），随安装包分发。
 * 用法：npm run data:export
 *
 * 只导出白名单内的数据文件；settings.json（含 API Key）永远不会被导出。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, unlinkSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gzipSync } from 'node:zlib'
import runtimeProfile from './runtime-profile.cjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SRC = process.env.NP_DATA_DIR ?? join(runtimeProfile.resolveRuntimeProfile({ packaged: false }), 'data')
const OUT = join(ROOT, 'default-data')
const FILES = ['tags.json', 'aliases.json', 'implications.json', 'zh-community.json', 'zh-ai.json', 'zh-user.json', 'pinyin-cache.json']

if (!existsSync(join(SRC, 'tags.json'))) {
  console.error(`未找到 ${join(SRC, 'tags.json')}，请先在应用里下载 tag 数据`)
  process.exit(1)
}

mkdirSync(OUT, { recursive: true })
for (const f of readdirSync(OUT)) if (f.endsWith('.gz')) unlinkSync(join(OUT, f))

const files = {}
for (const name of FILES) {
  const p = join(SRC, name)
  if (!existsSync(p)) continue
  const raw = readFileSync(p)
  JSON.parse(raw.toString('utf8')) // 校验
  const gz = gzipSync(raw, { level: 9 })
  writeFileSync(join(OUT, name + '.gz'), gz)
  files[name] = { bytes: raw.length, gzBytes: gz.length }
  console.log(`${name.padEnd(20)} ${(raw.length / 1048576).toFixed(2)} MB -> ${(gz.length / 1048576).toFixed(2)} MB`)
}

const tags = JSON.parse(readFileSync(join(SRC, 'tags.json'), 'utf8'))
const count = (n) => (files[n] ? Object.keys(JSON.parse(readFileSync(join(SRC, n), 'utf8'))).length : 0)
const manifest = {
  version: 1,
  exportedAt: new Date().toISOString(),
  fetchedAt: tags.fetchedAt,
  minCount: tags.minCount,
  tagCount: tags.tags.length,
  implications: count('implications.json'),
  zhAi: count('zh-ai.json'),
  zhUser: count('zh-user.json'),
  files
}
writeFileSync(join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2))
console.log(`\n已导出到 ${OUT}`)
console.log(`tag ${manifest.tagCount}，AI 翻译 ${manifest.zhAi}，手动翻译 ${manifest.zhUser}，数据时间 ${manifest.fetchedAt}`)
