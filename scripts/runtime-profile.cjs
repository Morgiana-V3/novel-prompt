// Shared by the Electron entry, dev launcher and MCP proxy.
const { join, resolve, dirname, relative, isAbsolute, sep } = require('node:path')
const { homedir } = require('node:os')
const { existsSync, realpathSync } = require('node:fs')

function appDataPath() {
  if (process.platform === 'win32') return process.env.APPDATA || join(homedir(), 'AppData', 'Roaming')
  if (process.platform === 'darwin') return join(homedir(), 'Library', 'Application Support')
  return process.env.XDG_CONFIG_HOME || join(homedir(), '.config')
}
function canonical(path) {
  let existing = resolve(path)
  while (!existsSync(existing) && dirname(existing) !== existing) existing = dirname(existing)
  const value = resolve(realpathSync(existing), relative(existing, resolve(path)))
  return process.platform === 'win32' ? value.toLowerCase() : value
}
function contains(parent, child) {
  const rel = relative(parent, child)
  return !rel || (rel !== '..' && !rel.startsWith('..' + sep) && !isAbsolute(rel))
}
function resolveRuntimeProfile({ packaged, appData = appDataPath(), defaultUserData, override = process.env.NOVELPROMPT_USER_DATA } = {}) {
  const selected = resolve(override || (packaged ? defaultUserData || join(appData, 'novel-prompt') : join(appData, 'novel-prompt-dev')))
  if (!packaged) {
    const dev = canonical(selected)
    for (const name of ['novel-prompt', 'NovelPrompt']) {
      const production = canonical(join(appData, name))
      if (contains(production, dev) || contains(dev, production)) throw Error('开发版不能使用安装版数据目录或其父子目录。请使用 novel-prompt-dev 或独立测试目录。')
    }
  }
  return selected
}
module.exports = { resolveRuntimeProfile }
