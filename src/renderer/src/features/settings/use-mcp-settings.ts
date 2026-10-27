import type { McpInfo } from '@shared/contracts/mcp'
import { computed, onMounted, ref, watch } from 'vue'
import { reportError } from '../../shared/lib/notifications'
import { shellState } from '../../shared/state/shell'

export function useMcpSettings() {
  /* ---------- Agent 接入 ---------- */
  const mcp = ref<McpInfo | null>(null)

  const isPackaged = computed(() => !!mcp.value?.packaged)

  async function loadMcp() {
    mcp.value = await window.api.mcpInfo()
  }

  // TOML 字面量字符串（单引号）不处理反斜杠转义，适合 Windows 路径
  const tomlStr = (text: string) => `'${text.replace(/'/g, "''")}'`

  const mcpScope = ref('all')

  const mcpEnv = computed(() => ({ ...mcp.value?.env, NOVELPROMPT_MCP_GROUPS: mcpScope.value }))

  const codexConfig = computed(() => {
    const mcpInfo = mcp.value
    if (!mcpInfo) {
      return ''
    }
    const env = Object.entries(mcpEnv.value).map(([k, v]) => `${k} = ${tomlStr(v)}`)
    return `[mcp_servers.${mcpInfo.serverName ?? 'novel-prompt'}]\ncommand = ${tomlStr(mcpInfo.command)}\nargs = [${mcpInfo.args.map(tomlStr).join(', ')}]\nenv = { ${env.join(', ')} }`
  })

  const launchJson = computed(() =>
    mcp.value
      ? JSON.stringify(
          { command: mcp.value.command, args: mcp.value.args, env: mcpEnv.value },
          null,
          2,
        )
      : '',
  )

  const jsonConfig = computed(() =>
    mcp.value
      ? JSON.stringify(
          {
            mcpServers: {
              [mcp.value.serverName ?? 'novel-prompt']: {
                command: mcp.value.command,
                args: mcp.value.args,
                env: mcpEnv.value,
              },
            },
          },
          null,
          2,
        )
      : '',
  )

  const agentPrompt = computed(() =>
    mcp.value
      ? [
          '帮我把 NovelPrompt 完整配置成你的 MCP 服务：',
          `- 服务名 ${mcp.value.serverName ?? 'novel-prompt'}，传输方式 stdio，启动参数如下（路径原样使用）：`,
          launchJson.value,
          `- 写进你自己的 MCP 配置文件（用户级），改之前先把原文件备份为 .bak，只新增或覆盖 ${mcp.value.serverName ?? 'novel-prompt'} 这一项，其他配置不要动。`,
          '- 配置完成后重新连接 MCP；若客户端不支持重连则重启客户端。连接后调用 agent_guide 和 get_app_state 核对功能、运行环境及连接状态；写提示词前再读取相关规则。',
        ].join('\n')
      : '',
  )

  const fmtLogTime = (t: number) =>
    new Date(t).toLocaleString(undefined, {
      month: 'numeric',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  onMounted(() => loadMcp().catch(reportError))
  watch(
    () => shellState.tab,
    (tab) => {
      if (tab === 'settings') {
        void loadMcp().catch(reportError)
      }
    },
  )
  return {
    mcp,
    isPackaged,
    loadMcp,
    tomlStr,
    mcpScope,
    mcpEnv,
    codexConfig,
    launchJson,
    jsonConfig,
    agentPrompt,
    fmtLogTime,
  }
}
