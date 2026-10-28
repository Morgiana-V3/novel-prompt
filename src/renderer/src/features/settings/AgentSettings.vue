<script setup lang="ts">
import HelpTip from '../../shared/ui/HelpTip.vue'
import { useMcpSettings } from './use-mcp-settings'
import { copy } from '../../shared/lib/notifications'
import Icon from '../../shared/ui/Icon.vue'
import ThemeSelect from '../../shared/ui/ThemeSelect.vue'

const scopeOptions = [
  { value: 'all', label: '全部功能' },
  { value: 'workspace,frontend,images,skills,tags', label: '工作台创作' },
  { value: 'workspace,images,skills,tags', label: '后台创作' },
  { value: 'tags,skills', label: '标签与提示词' },
  { value: 'core', label: '按需加载' },
]
const { mcp, isPackaged, loadMcp, mcpScope, codexConfig, jsonConfig, agentPrompt, fmtLogTime } =
  useMcpSettings()
defineProps<{ allowAi: boolean; allowGenerate: boolean }>()
const emit = defineEmits<{
  permission: [key: 'mcpAllowAi' | 'mcpAllowGenerate', value: boolean]
  manageSkills: []
}>()
</script>

<template>
  <div
    class="card settings-agent"
    style="--d: 120ms"
  >
    <div class="card-head">
      <span class="card-icon blue"><Icon name="wand" /></span>
      <div>
        <h2>
          Agent 接入（MCP）<HelpTip
            label="Agent 接入（MCP）"
            text="支持后台处理与前台可视化操作。告诉 Agent「这次使用前台可视化模式」，即可在界面中展示操作，并随时停止；无需另配服务。"
          />
        </h2>
      </div>
    </div>
    <div class="form-grid">
      <div
        v-if="mcp?.runtime"
        class="form-field full"
      >
        <label
          >当前环境：{{ mcp.runtime.mode === 'development' ? '开发版' : '安装版' }}
          <HelpTip
            label="当前环境"
            :text="`数据目录：${mcp.runtime.dataPath}
程序目录：${mcp.runtime.appPath}
下面的配置连接此环境。开发版与安装版的数据分别保存。`"
          />
        </label>
      </div>

      <div class="form-field">
        <label
          >允许调用 DeepSeek<HelpTip
            label="允许调用 DeepSeek"
            text="允许 Agent 使用已配置的 AI 服务，包括前台工作台讨论、优化和画面推测，会消耗对应服务额度。仅填写输入、查看或绘制区域无需开启。"
        /></label>
        <div class="seg">
          <button
            :class="{ on: !allowAi }"
            @click="emit('permission', 'mcpAllowAi', false)"
          >
            关闭
          </button>
          <button
            :class="{ on: allowAi }"
            @click="emit('permission', 'mcpAllowAi', true)"
          >
            开启
          </button>
        </div>
        <span
          v-if="allowAi"
          class="muted small"
          >已允许消耗 AI 服务额度</span
        >
      </div>
      <div class="form-field">
        <label
          >允许生图<HelpTip
            label="允许生图"
            text="前台与后台生图、重绘均检查免费条件，并要求 Agent 取得你的生成授权。"
        /></label>
        <div class="seg">
          <button
            :class="{ on: !allowGenerate }"
            @click="emit('permission', 'mcpAllowGenerate', false)"
          >
            关闭
          </button>
          <button
            :class="{ on: allowGenerate }"
            @click="emit('permission', 'mcpAllowGenerate', true)"
          >
            开启
          </button>
        </div>
      </div>
      <div
        v-if="mcp?.portable"
        class="form-field full"
      >
        <div class="error-box">
          <Icon
            name="warn"
            :size="16"
          />便携版每次运行都会解压到临时目录，路径不固定，agent 无法稳定启动它。请改用安装版。
        </div>
      </div>
      <div
        v-if="!mcp?.portable"
        class="form-field full"
      >
        <label for="mcp-scope"
          >接入范围<HelpTip
            label="接入范围"
            text="所选功能在首次连接时即可使用，范围越小，Agent 需要读取的工具说明越少。选择后复制下方新配置并重新连接。“按需加载”适合支持动态刷新工具的客户端。"
        /></label>
        <ThemeSelect
          id="mcp-scope"
          v-model="mcpScope"
          class="mcp-scope"
          aria-label="接入范围"
          :options="scopeOptions"
        />
      </div>
      <details
        v-if="!mcp?.portable"
        class="form-field full manual"
      >
        <summary>Agent 自动配置</summary>
        <span class="help"
          >把下面这段话发给你正在用的 agent（Codex、Claude Code、Cursor 等），它会自己把 MCP
          写进它的配置：</span
        >
        <div class="code-box">
          <pre>{{ agentPrompt }}</pre>
          <button
            class="icon-btn sm"
            title="复制"
            @click="copy(agentPrompt)"
          >
            <Icon
              name="copy"
              :size="15"
            />
          </button>
        </div>
        <span class="help">
          配置里的路径取自本软件当前的安装位置，更换安装目录后需要重新配置。
          {{ mcp && !isPackaged ? '当前是开发模式，配置指向本项目，需要先 npm run build。' : '' }}
        </span>
      </details>
      <details
        v-if="!mcp?.portable"
        class="form-field full manual"
      >
        <summary>手动配置</summary>
        <label>Codex（~/.codex/config.toml）</label>
        <div class="code-box">
          <pre>{{ codexConfig }}</pre>
          <button
            class="icon-btn sm"
            title="复制"
            @click="copy(codexConfig)"
          >
            <Icon
              name="copy"
              :size="15"
            />
          </button>
        </div>
        <label>Claude Code / Cursor 等（mcpServers JSON）</label>
        <div class="code-box">
          <pre>{{ jsonConfig }}</pre>
          <button
            class="icon-btn sm"
            title="复制"
            @click="copy(jsonConfig)"
          >
            <Icon
              name="copy"
              :size="15"
            />
          </button>
        </div>
        <span class="help">
          服务名 novel-prompt，传输方式 stdio。其他 agent 按各自格式填写同样的 command / args / env
          即可，改完需完全重启 agent。 接入范围只决定 Agent 首次看到哪些工具，不替代上方 AI
          与生图权限。
        </span>
      </details>
      <div class="form-field full">
        <div class="row">
          <button
            class="btn ghost small"
            @click="emit('manageSkills')"
          >
            <Icon
              name="layers"
              :size="14"
            />Skill 启用与优先级</button
          ><HelpTip
            label="Agent 使用 Skill"
            text="Agent 使用侧栏中启用的 Skill，并按优先级处理冲突；修改后下一次读取生效。Agent 也可以通过管理工具增删改 Skill。"
          />
        </div>
      </div>
    </div>
    <div class="mcp-log">
      <div class="mcp-log-head">
        <b>最近调用</b>
        <button
          class="btn ghost small ml-auto"
          @click="loadMcp"
        >
          <Icon
            name="swap"
            :size="13"
          />刷新
        </button>
      </div>
      <div
        v-if="mcp?.log.length"
        class="effect-list"
      >
        <div
          v-for="(entry, index) in mcp.log"
          :key="entry.at + '-' + index"
          class="effect-row"
        >
          <span :class="['pill', entry.ok ? 'ok' : 'bad']">{{ entry.ok ? '成功' : '失败' }}</span>
          <span class="where mono">{{ entry.tool }}</span>
          <span class="grow">{{ entry.summary }}</span>
          <span class="muted small">{{ fmtLogTime(entry.at) }} · {{ entry.ms }}ms</span>
        </div>
      </div>
      <div
        v-else
        class="muted small"
      >
        还没有 agent 调用过
      </div>
    </div>
  </div>
</template>
