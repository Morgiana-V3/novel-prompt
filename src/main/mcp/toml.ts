/**
 * 替换 TOML 文本里的 [mcp_servers.<name>] 段（含其子表，如 [mcp_servers.<name>.env]），没有就追加到末尾。
 * 其他内容（包括注释、其他 MCP 服务）原样保留。
 */
export function upsertTomlTable(toml: string, name: string, block: string): string {
  const esc = name.replace(/[.*+?^${}()|[\]\\-]/g, '\\$&')
  const head = new RegExp(`^\\s*\\[\\s*mcp_servers\\s*\\.\\s*(?:${esc}|"${esc}"|'${esc}')\\s*(?:\\.[^\\]]*)?\\]\\s*(#.*)?$`)
  const anyTable = /^\s*\[/
  const out: string[] = []
  let skipping = false
  for (const line of toml.replace(/\r\n/g, '\n').split('\n')) {
    if (head.test(line)) {
      skipping = true
      continue
    }
    if (skipping && anyTable.test(line)) skipping = false
    if (!skipping) out.push(line)
  }
  const body = out.join('\n').replace(/\s+$/, '')
  return (body ? `${body}\n\n` : '') + block.trim() + '\n'
}
