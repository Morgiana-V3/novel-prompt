<script setup lang="ts">
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
        <h2>Agent 接入（MCP）</h2>
      </div>
    </div>
    <div class="form-grid">
      <div
        v-if="mcp?.runtime"
        class="form-field full"
      >
        <label>当前环境：{{ mcp.runtime.mode === 'development' ? '开发版' : '安装版' }} </label>
      </div>

      <div class="form-field">
        <label>允许调用 AI 服务</label>
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
        <label>允许生图</label>
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
        <label for="mcp-scope">接入范围</label>
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
        <summary class="disclosure">Agent 自动配置</summary>
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
        <summary class="disclosure">手动配置</summary>
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
            />Skill 启用与优先级
          </button>
        </div>
      </div>
    </div>
    <details class="mcp-log manual">
      <summary class="disclosure">
        调用历史<span v-if="mcp?.log.length"> · {{ mcp.log.length }} 条</span>
      </summary>
      <div class="mcp-log-head">
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
    </details>
  </div>
</template>
