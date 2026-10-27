<script setup lang="ts">
import { computed, ref } from 'vue'
import { regionIds as messageRegionIds } from '@shared/workspace/regions'
import WorkspaceRegionChecklist from './WorkspaceRegionChecklist.vue'
import type {
  PageWorkspace,
  PageVersion,
  PageMessage,
  PageExecution,
  PageAgentIdentity,
} from '@shared/workspace/model'
import Icon from '../../../shared/ui/Icon.vue'
import ThemeSelect from '../../../shared/ui/ThemeSelect.vue'
import MarkdownText from '../../../shared/ui/MarkdownText.vue'
import WorkspaceProposalCard from './WorkspaceProposalCard.vue'
import { copy } from '../../../shared/lib/notifications'
import { vAutosize } from '../../../shared/lib/autosize'
const props = defineProps<{
  work: PageWorkspace
  current: PageVersion
  busy: boolean
  historical: boolean
  external: boolean
  agentLabel: string
  agentConnected: boolean
  agentStatus: string
  agentActivity?: NonNullable<PageAgentIdentity['activity']>[number]
  pendingRequest?: PageMessage
  pendingText: string
  operation: string
  progress: string
  error: string
  editingPrompt: boolean
  selectedProposalId: string | null
  references: string[]
  discussionContext: { versionId: string; label: string; editVersionId: string; editLabel: string }
  label: (id: string) => string
  time: (at: number) => string
  status: (status: string) => string
  stale: (message: PageMessage) => boolean
  planLabel: (execution?: PageExecution, versionId?: string) => string
}>()
const composer = defineModel<string>('composer', { required: true })
const regionIds = defineModel<string[]>('regionIds', { required: true })
const displayedRegionIds = computed({
  get: () => (props.pendingRequest ? messageRegionIds(props.pendingRequest) : regionIds.value),
  set: (ids: string[]) => {
    regionIds.value = ids
  },
})
const emit = defineEmits<{
  agentMode: [mode: 'internal' | 'external']
  view: [id: string]
  proposal: [message: PageMessage, decision: 'accept' | 'reject' | 'undo']
  cancelExternal: []
  cancelChat: []
  clearError: []
  reference: [id: string]
  annotation: []
  locate: [id: string]
  send: []
}>()
const thread = ref<HTMLElement>()
const input = ref<HTMLTextAreaElement>()
function sendOnEnter(event: KeyboardEvent) {
  if (!event.isComposing) {
    emit('send')
  }
}
function copyContinuation() {
  return copy(
    `请继续处理 NovelPrompt 项目 ${props.work.id}（${props.work.title}）的待处理需求。先读取 get_workspace_context；如连接已更换，请重新接管后处理，不要重复提交需求。`,
  )
}
defineExpose({
  focusComposer: () => input.value?.focus(),
  scrollEnd: () => {
    if (thread.value) {
      thread.value.scrollTop = thread.value.scrollHeight
    }
  },
})
</script>

<template>
  <aside class="pw-conversation">
    <div class="pw-thread-header">
      <div>
        <Icon
          name="sparkle"
          :size="17"
        /><b>对话</b>
      </div>
      <span :title="agentLabel">{{ agentLabel }}</span>
    </div>
    <div class="pw-agent-mode">
      <ThemeSelect
        :model-value="work.agentMode ?? 'internal'"
        :disabled="busy"
        :options="[
          { value: 'internal', label: '内置 AI' },
          { value: 'external', label: '外部 Agent 接管' },
        ]"
        aria-label="会话处理方式"
        @update:model-value="emit('agentMode', $event)"
      /><span
        v-if="external"
        :class="{ connected: agentConnected }"
        >{{ agentStatus }}</span
      >
    </div>
    <div class="pw-context">
      <span class="pw-context-dot"></span>当前蓝本 <b>{{ current.label }}</b
      ><button
        v-if="historical"
        :disabled="busy"
        @click="emit('view', current.id)"
      >
        回到当前
      </button>
    </div>
    <div
      ref="thread"
      class="pw-thread scroll"
      aria-live="polite"
    >
      <div
        v-if="!work.messages.some((m) => m.role === 'user') && !pendingText"
        class="pw-welcome"
      >
        <p>描述想生成或修改的内容</p>
      </div>
      <div
        v-for="messageItem in work.messages"
        :key="messageItem.id"
        :class="['pw-message', messageItem.role, { failed: messageItem.error }]"
      >
        <template v-if="messageItem.role === 'event'"
          ><span>{{ messageItem.text }}</span></template
        ><template v-else
          ><div class="pw-message-meta">
            <b>{{ messageItem.role === 'user' ? '你' : messageItem.author?.name || 'AI' }}</b
            ><button
              :disabled="editingPrompt"
              @click="emit('view', messageItem.versionId)"
            >
              {{ label(messageItem.versionId) }}</button
            ><time>{{ time(messageItem.createdAt) }}</time>
          </div>
          <MarkdownText
            v-if="messageItem.role === 'assistant'"
            :text="messageItem.text"
          />
          <div
            v-else
            class="pw-message-text"
          >
            {{ messageItem.text }}
          </div>
          <div
            v-if="
              messageItem.discussion && messageItem.discussion.versionId !== messageItem.versionId
            "
            class="pw-citations"
          >
            <button
              :disabled="editingPrompt"
              @click="emit('view', messageItem.discussion.versionId)"
            >
              讨论 {{ messageItem.discussion.label }}</button
            ><span>建议修改 {{ label(messageItem.versionId) }}</span>
          </div>
          <div
            v-if="messageItem.referenceIds?.length"
            class="pw-citations"
          >
            <button
              v-for="id in messageItem.referenceIds"
              :key="id"
              :disabled="editingPrompt"
              @click="emit('view', id)"
            >
              引用 {{ label(id) }}
            </button>
          </div>
          <details
            v-if="messageItem.regions?.length"
            class="pw-message-regions"
          >
            <summary>
              本轮区域 · {{ messageItem.regions.map((region) => region.label).join('、') }}
            </summary>
            <p
              v-for="region in messageItem.regions"
              :key="region.id"
            >
              <b>{{ region.label }}</b> · {{ region.instruction || '要求见讨论内容' }}
            </p>
          </details>
          <WorkspaceProposalCard
            v-if="messageItem.proposal"
            :message="messageItem"
            :selected-proposal-id="selectedProposalId"
            :busy="busy"
            :is-stale="stale(messageItem)"
            :adopted-version-id="current.id"
            :execution-label="planLabel(messageItem.proposal.execution, messageItem.versionId)"
            :status-label="status(messageItem.proposal.status)"
            @decide="emit('proposal', messageItem, $event)"
          />
          <details
            v-if="messageItem.skills"
            class="pw-used-skills"
          >
            <summary>本轮 Skill · {{ messageItem.skills.length }}</summary>
            {{ messageItem.skills.join('、') || '未启用 Skill' }}
          </details></template
        >
      </div>
      <div
        v-if="pendingRequest"
        class="pw-external-wait"
        role="status"
      >
        <span>{{
          agentActivity
            ? agentActivity.message || 'Agent 正在处理本轮需求'
            : agentConnected
              ? '需求已保存，等待 Agent 开始处理'
              : '需求已保存，等待重新接管'
        }}</span
        ><small>{{
          agentActivity
            ? '处理状态由 Agent 报告；长时间没有更新会回到等待状态。'
            : '连接不会自动启动处理。复制接续指令到 Agent 对话中继续。'
        }}</small
        ><button
          class="btn ghost small"
          @click="copyContinuation"
        >
          复制接续指令</button
        ><button
          class="btn ghost small"
          :disabled="busy"
          @click="emit('cancelExternal')"
        >
          取消本轮需求
        </button>
      </div>
      <div
        v-if="pendingText"
        class="pw-message user"
      >
        <div class="pw-message-text">{{ pendingText }}</div>
      </div>
      <div
        v-if="operation === 'chat'"
        class="pw-thinking"
      >
        <Icon
          name="sparkle"
          :size="16"
          class="spin-slow"
        />正在分析上下文…<button @click="emit('cancelChat')">停止</button>
      </div>
      <div
        v-if="operation === 'generate'"
        class="pw-thinking"
      >
        {{ progress }}
      </div>
    </div>
    <div class="pw-compose">
      <div
        class="pw-discussion-context"
        aria-label="本轮讨论对象"
      >
        <span
          >{{ pendingRequest ? '已提交讨论' : '本轮讨论' }}
          <b>{{ discussionContext.label }}</b></span
        >
        <span v-if="discussionContext.versionId !== discussionContext.editVersionId"
          >建议修改 <b>{{ discussionContext.editLabel }}</b
          >；要修改这张图，请先设为蓝本</span
        >
      </div>
      <div
        v-if="error"
        class="pw-error"
        role="alert"
      >
        {{ error }}<button @click="emit('clearError')">×</button>
      </div>
      <div
        v-if="references.length"
        class="pw-reference-chips"
      >
        <button
          v-for="id in references"
          :key="id"
          :disabled="busy"
          @click="emit('reference', id)"
        >
          引用 {{ label(id) }} ×
        </button>
      </div>
      <WorkspaceRegionChecklist
        v-if="current.editor.regions.length"
        v-model="displayedRegionIds"
        :regions="current.editor.regions"
        :disabled="busy || !!pendingRequest"
        @change="emit('annotation')"
        @locate="emit('locate', $event)"
      />
      <div class="pw-input-wrap">
        <textarea
          ref="input"
          v-model="composer"
          v-autosize
          :disabled="busy"
          maxlength="6000"
          aria-label="持续讨论输入"
          :placeholder="
            regionIds.length
              ? '补充这些区域的共同要求、保留内容，或继续讨论…'
              : '描述目标，或接着上次的结果继续说…'
          "
          @keydown.enter.exact.prevent="sendOnEnter"
        ></textarea
        ><button
          class="pw-send"
          :disabled="busy || !composer.trim() || (external && !!pendingRequest)"
          :title="external ? '保存需求，等待外部 Agent 回复' : '发送'"
          @click="emit('send')"
        >
          <Icon
            name="arrow"
            :size="18"
          />
        </button>
      </div>
    </div>
  </aside>
</template>

<style scoped>
.pw-message-regions {
  margin-top: 8px;
  font-size: 11px;
  color: var(--text2);
  overflow-wrap: anywhere;
}

.pw-message-regions summary {
  cursor: pointer;
}

.pw-discussion-context {
  display: flex;
  flex-direction: column;
  gap: 3px;
  margin-bottom: 8px;
  font-size: 10px;
  line-height: 1.5;
  color: var(--muted);
  overflow-wrap: anywhere;
}

.pw-discussion-context b {
  font-weight: 500;
  color: var(--text2);
}

.pw-agent-mode {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 20px;
  font-size: 11px;
  color: var(--muted);
}

.pw-agent-mode :deep(.theme-select) {
  flex: 1;
  min-width: 0;
}

.pw-agent-mode .connected {
  color: var(--pink-deep);
}

.pw-external-wait {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 8px;
  padding: 14px;
  border: 1px solid var(--pink-line);
  border-radius: 12px;
  background: var(--pink-soft);
  font-size: 12px;
}

.pw-external-wait small {
  color: var(--muted);
}

.pw-thread-header {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 16px 20px 12px;
  flex-shrink: 0;
}

.pw-thread-header > div {
  display: flex;
  gap: 8px;
  align-items: center;
  font-size: 14px;
}

.pw-thread-header .icon {
  color: var(--pink);
}

.pw-thread-header > span {
  display: block;
  max-width: 180px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  margin: 0 0 0 auto;
  font-size: 11px;
  color: var(--muted);
}

.pw-context {
  display: flex;
  align-items: center;
  gap: 7px;
  margin: 0 20px 12px;
  padding: 9px 11px;
  border-radius: 9px;
  background: var(--panel);
  font-size: 11px;
  color: var(--text2);
  flex-shrink: 0;
}

.pw-context b {
  color: var(--text);
}

.pw-context button {
  margin-left: auto;
  color: var(--pink-deep);
  font-size: 10px;
}

.pw-context-dot {
  width: 6px;
  height: 6px;
  background: var(--pink);
  border-radius: 50%;
}

.pw-thread {
  flex: 1;
  min-height: 0;
  padding: 6px 20px 20px;
  scroll-behavior: smooth;
}

.pw-welcome {
  padding: 28px 2px 12px;
}

.pw-welcome-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 52px;
  height: 52px;
  border-radius: 17px;
  background: var(--pink-soft);
  color: var(--pink);
  margin-bottom: 16px;
}

.pw-welcome h2 {
  font-size: 19px;
}

.pw-welcome p {
  font-size: 12px;
  color: var(--text2);
  line-height: 1.9;
  margin: 12px 0 20px;
}

.pw-welcome > button {
  display: flex;
  align-items: center;
  justify-content: space-between;
  text-align: left;
  gap: 10px;
  width: 100%;
  padding: 12px 14px;
  margin: 8px 0;
  font-size: 12px;
  border: 1px solid var(--line2);
  border-radius: 12px;
  line-height: 1.6;
}

.pw-welcome > button:hover {
  border-color: var(--pink-line);
  background: var(--pink-soft);
}

.pw-message {
  margin: 16px 0;
  font-size: 12px;
  line-height: 1.8;
}

.pw-message-meta {
  display: flex;
  gap: 8px;
  align-items: center;
  margin-bottom: 6px;
  font-size: 10px;
  color: var(--muted);
}

.pw-message-meta b {
  color: var(--text2);
  font-size: 11px;
}

.pw-message-meta button {
  font-size: 10px;
  background: var(--panel);
  border-radius: 5px;
  padding: 0 5px;
}

.pw-message-meta time {
  margin-left: auto;
}

.pw-message-text {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  user-select: text;
}

.pw-message.user .pw-message-text {
  background: var(--pink-soft);
  border-radius: 12px 3px 12px 12px;
  padding: 11px 14px;
}

.pw-message.event {
  font-size: 10px;
  color: var(--muted);
  border-left: 2px solid var(--line2);
  padding-left: 10px;
}

.pw-message.event.failed {
  color: var(--bad);
}

.pw-citations {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  margin-top: 7px;
}

.pw-citations button {
  font-size: 10px;
  color: var(--pink-deep);
  display: flex;
  align-items: center;
  gap: 4px;
}

.pw-thinking {
  display: flex;
  gap: 7px;
  align-items: center;
  font-size: 12px;
  color: var(--text2);
  padding: 15px 0;
}

.pw-thinking button {
  color: var(--pink-deep);
  margin-left: auto;
  flex-shrink: 0;
}

.pw-compose {
  padding: 12px 16px 16px;
  border-top: 1px solid var(--line);
  flex-shrink: 0;
  background: var(--bg);
}

.pw-target {
  display: flex;
  gap: 8px;
  align-items: center;
  margin-bottom: 10px;
}

.pw-target > :first-child {
  flex: 1;
  min-width: 0;
}

.pw-input-wrap {
  border: 1px solid var(--line2);
  border-radius: 14px;
  padding: 10px 10px 8px;
  background: var(--panel);
  display: flex;
  align-items: flex-end;
  gap: 8px;
}

.pw-input-wrap:focus-within {
  border-color: var(--pink-line);
  box-shadow: 0 0 0 3px var(--pink-soft);
}

.pw-input-wrap textarea {
  border: 0;
  outline: none;
  box-shadow: none;
  background: transparent;
  resize: none;
  min-height: 50px;
  max-height: 180px;
  flex: 1;
  min-width: 0;
  font-size: 12px;
  line-height: 1.8;
}

.pw-send {
  width: 32px;
  height: 32px;
  border-radius: 11px;
  background: var(--pink);
  color: white;
  display: grid;
  place-items: center;
  flex-shrink: 0;
}

.pw-send:disabled {
  opacity: 0.4;
}

.pw-compose-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-top: 10px;
  min-height: 30px;
}

.pw-compose-foot > span {
  font-size: 10px;
  color: var(--muted);
}

.pw-reference-chips {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
  margin-bottom: 8px;
}

.pw-reference-chips button {
  font-size: 10px;
  padding: 5px 8px;
  border-radius: 7px;
  background: var(--pink-soft);
  color: var(--pink-deep);
  display: flex;
  gap: 5px;
  align-items: center;
}

.pw-error {
  font-size: 11px;
  background: var(--bad-soft);
  color: var(--bad);
  padding: 8px 10px;
  border-radius: 8px;
  margin-bottom: 10px;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  display: flex;
  justify-content: space-between;
  gap: 10px;
}

.pw-error button {
  flex-shrink: 0;
}

@media (width <= 800px) {
  .pw-thread {
    padding: 6px 12px 15px;
  }
}

.pw-used-skills {
  font-size: 10px;
  color: var(--muted);
  margin-top: 8px;
}

.pw-conversation {
  display: flex;
  flex-direction: column;
  border-left: 1px solid var(--line);
  background: var(--bg);
  width: var(--pw-chat-width);
  min-width: var(--pw-chat-width);
  max-width: none;
  flex: 0 0 var(--pw-chat-width);
}
</style>
