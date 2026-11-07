<script setup lang="ts">
import { computed, ref } from 'vue'
import type { PageInputContext, PageInputImage } from '@shared/workspace/context'
import type { PageMessage } from '@shared/workspace/model'
import { displayVersionLabel } from '../labels'
import WorkspaceInputDraft from './WorkspaceInputDraft.vue'
import WorkspaceInputRules from './WorkspaceInputRules.vue'

const props = defineProps<{
  message: PageMessage
  messages: PageMessage[]
}>()
const emit = defineEmits<{ message: [id: string] }>()
const isOpen = ref(false)
const context = computed(() => {
  const recorded = props.message.inputContext
  return recorded?.schema === 1 && recorded.requestId === props.message.id ? recorded : undefined
})
const messageIndex = computed(
  () => new Map(props.messages.map((message, index) => [message.id, { message, index }])),
)
const imageRoles: Record<PageInputImage['role'], string> = {
  'edit-target': '修改底图',
  discussion: '讨论图',
  reference: '参考图',
  region: '区域示意图',
}
const imageModes: Record<PageInputContext['images']['mode'], string> = {
  unassembled: '尚未记录图片装配结果。',
  'external-reference': '图片可供外部 Agent 读取；此记录不代表 Agent 已经看图。',
  included: '记录的输入内容已装配图片；这不代表图片已经发送或模型已理解图片。',
  'text-only': '记录的输入内容为纯文本，未附带图片。',
  missing: '本轮所需图片缺失，未能附带图片。',
  none: '本轮没有图片输入。',
}
const deliveryLabels: Record<NonNullable<PageInputContext['images']['delivery']>, string> = {
  prepared: '已准备',
  attempted: '已尝试提交',
  responded: '已收到模型回复',
}
const decisionNames: Record<PageInputContext['history']['decisions'][number]['status'], string> = {
  accepted: '已采纳',
  rejected: '已拒绝',
  withdrawn: '已撤回',
}

function toggle(event: Event) {
  isOpen.value = (event.currentTarget as HTMLDetailsElement).open
}

function timestamp(at: number): string {
  return new Date(at).toLocaleString()
}

function imageStatus(image: PageInputImage): string {
  if (image.status === 'available') {
    return context.value?.images.mode === 'external-reference'
      ? '可供外部读取'
      : '存在，未记录是否发送'
  }
  const labels = {
    included: '已装配到输入',
    'text-only': '仅文字描述',
    missing: '图片缺失',
    none: '无图片',
  }
  return labels[image.status]
}

function imageLabel(id: string): string {
  const image = context.value?.images.entries.find((entry) => entry.id === id)
  return image ? `${imageRoles[image.role]}「${displayVersionLabel(image.label)}」` : id
}

function messageLabel(id: string): string {
  const indexed = messageIndex.value.get(id)
  if (!indexed) {
    return `记录已不可用 · ${id}`
  }
  const roleNames = { user: '请求', assistant: '回复', event: '事件' }
  return `#${indexed.index + 1} ${roleNames[indexed.message.role]} · ${timestamp(indexed.message.createdAt)}`
}

function executionRegions(recorded: PageInputContext): string {
  const ids = recorded.execution.regionIds ?? []
  const selected = ids.length ? ids : [recorded.execution.regionId].filter(Boolean)
  return (
    selected
      .map((id) => recorded.selectedRegions.find((region) => region.id === id)?.label ?? id)
      .join('、') || '未指定区域'
  )
}
</script>

<template>
  <details
    :id="`workspace-input-${message.id}`"
    class="pw-input-context"
    @toggle="toggle"
  >
    <summary class="disclosure">查看本轮输入</summary>
    <div
      v-if="isOpen"
      class="pw-input-context-body"
    >
      <p v-if="!context">
        当时未保存可用的输入快照，无法还原本轮完整输入。此处不会用当前草稿或规则补推。
      </p>
      <template v-else>
        <p class="pw-input-note">
          {{ timestamp(context.capturedAt) }} 冻结 · 修订 {{ context.revision }}
        </p>
        <section>
          <b>原始任务</b>
          <pre>{{ message.text || '（空）' }}</pre>
          <b>工作台目标</b>
          <pre>{{ context.goal || '（空）' }}</pre>
          <b>保留要求</b>
          <pre>{{ context.preserve || '（空）' }}</pre>
        </section>
        <section>
          <b>讨论图与修改底图</b>
          <dl>
            <dt>讨论图</dt>
            <dd>
              {{ displayVersionLabel(context.discussion.label) }}
              <small>{{ context.discussion.image?.name ?? '无图片' }}</small>
            </dd>
            <dt>修改底图</dt>
            <dd>
              {{ displayVersionLabel(context.editTarget.label) }}
              <small>{{ context.editTarget.image?.name ?? '无图片' }}</small>
            </dd>
            <dt>工作台模型</dt>
            <dd>{{ context.model }}</dd>
            <dt>执行计划</dt>
            <dd>
              {{ context.execution.kind === 'inpaint' ? '局部重绘' : '完整生成' }}
              <template v-if="context.execution.kind === 'inpaint'">
                · {{ executionRegions(context) }}
              </template>
            </dd>
          </dl>
          <p
            v-if="context.discussion.versionId !== context.editTarget.versionId"
            class="pw-input-note"
          >
            本轮讨论图与修改底图不同，方案基于上面记录的修改底图。
          </p>
          <WorkspaceInputDraft
            title="修改底图：完整冻结草稿与参数"
            :draft="context.editTarget.draft"
            :params="context.editTarget.params"
            :model="context.editTarget.model"
            :strength="context.editTarget.strength"
          />
          <WorkspaceInputDraft
            v-if="context.discussion.recipe"
            :title="
              context.discussion.recipe.source === 'generated'
                ? '讨论图：生成时的配方'
                : '讨论图：初始配方'
            "
            :draft="context.discussion.recipe.draft"
            :params="context.discussion.recipe.params"
          />
          <p
            v-else
            class="pw-input-note"
          >
            讨论图未记录配方。
          </p>
        </section>
        <section>
          <b>图片输入</b>
          <p>{{ imageModes[context.images.mode] }}</p>
          <p v-if="context.images.delivery">
            最近一次供应商请求：<b>{{ deliveryLabels[context.images.delivery] }}</b
            >。
            <template v-if="context.images.delivery === 'prepared'"
              >尚未进入本次网络调用。</template
            >
            <template v-else-if="context.images.delivery === 'attempted'">
              尚未记录本次有效回复，网络结果可能未知。
            </template>
            <template v-else>收到回复不代表模型已理解图片。</template>
          </p>
          <p
            v-else-if="context.images.mode !== 'external-reference'"
            class="pw-input-note"
          >
            当时未记录投递阶段。
          </p>
          <p
            v-if="context.images.attempts !== undefined || context.images.responses !== undefined"
            class="pw-input-note"
          >
            本轮网络尝试 {{ context.images.attempts ?? '未记录' }} 次，有效回复
            {{ context.images.responses ?? '未记录' }} 次。
          </p>
          <ul class="pw-input-list">
            <li
              v-for="image in context.images.entries"
              :key="image.id"
            >
              <b>{{ imageRoles[image.role] }} · {{ displayVersionLabel(image.label) }}</b>
              <span>{{ imageStatus(image) }}</span>
              <small>{{ image.imageName ?? '无图片文件' }}</small>
              <small v-if="image.sharedWith"
                >与 {{ imageLabel(image.sharedWith) }} 共用同一装配图片</small
              >
            </li>
          </ul>
        </section>
        <section>
          <b>所选区域 · {{ context.selectedRegions.length }}</b>
          <p v-if="!context.selectedRegions.length">未选择区域。</p>
          <div
            v-for="region in context.selectedRegions"
            :key="region.id"
            class="pw-input-region"
          >
            <b>{{ region.label }}</b>
            <span>
              · {{ region.target === null ? '自动识别角色' : `角色 ${region.target + 1}` }}</span
            >
            <pre>{{ region.instruction || '（未填写区域要求）' }}</pre>
            <small v-if="region.bounds">
              区域边界：x {{ region.bounds.x }}，y {{ region.bounds.y }}，宽
              {{ region.bounds.width }}，高 {{ region.bounds.height }}
            </small>
            <small v-else>当时未记录区域边界。</small>
          </div>
        </section>
        <section v-if="context.references.length">
          <b>引用版本 · {{ context.references.length }}</b>
          <div
            v-for="reference in context.references"
            :key="reference.versionId"
            class="pw-input-reference"
          >
            <span>{{ displayVersionLabel(reference.label) }}</span>
            <small>{{ reference.image?.name ?? '无图片' }}</small>
            <WorkspaceInputDraft
              v-if="reference.recipe"
              title="引用图的冻结配方"
              :draft="reference.recipe.draft"
              :params="reference.recipe.params"
            />
            <small v-else>当时未记录配方。</small>
          </div>
        </section>
        <WorkspaceInputRules
          :rules="context.rules"
          :snapshot="message.skillSnapshot"
        />
        <section>
          <b>历史范围</b>
          <p>
            记录的近期消息 {{ context.history.recentIds.length }} 条；较早消息索引
            {{ context.history.earlierIds.length }} 条；未列入该索引
            {{ context.history.omittedCount }} 条。
          </p>
          <p
            v-if="context.history.filteredRoutineCount !== undefined"
            class="pw-input-note"
          >
            常规操作记录 {{ context.history.filteredRoutineCount }} 条未纳入模型历史，原记录仍保留。
          </p>
          <p
            v-if="context.images.mode === 'external-reference'"
            class="pw-input-note"
          >
            这里只记录可追溯范围，不代表外部 Agent 已读取这些历史正文。
          </p>
          <details>
            <summary class="disclosure">查看记录的近期消息</summary>
            <ul class="pw-input-links">
              <li
                v-for="id in context.history.recentIds"
                :key="id"
              >
                <button
                  :disabled="!messageIndex.has(id)"
                  @click="emit('message', id)"
                >
                  {{ messageLabel(id) }}
                </button>
              </li>
            </ul>
          </details>
          <details v-if="context.history.earlierIds.length">
            <summary class="disclosure">查看较早消息索引</summary>
            <ul class="pw-input-links">
              <li
                v-for="id in context.history.earlierIds"
                :key="id"
              >
                <button
                  :disabled="!messageIndex.has(id)"
                  @click="emit('message', id)"
                >
                  {{ messageLabel(id) }}
                </button>
              </li>
            </ul>
          </details>
          <details>
            <summary class="disclosure">
              采纳 / 拒绝 / 撤回索引 · {{ context.history.decisions.length }}
            </summary>
            <p v-if="!context.history.decisions.length">本轮未记录已作决定的方案。</p>
            <ul class="pw-input-links">
              <li
                v-for="decision in context.history.decisions"
                :key="decision.messageId"
              >
                <span>{{ decisionNames[decision.status] }} · {{ decision.title }}</span>
                <button
                  :disabled="!messageIndex.has(decision.messageId)"
                  @click="emit('message', decision.messageId)"
                >
                  {{ messageLabel(decision.messageId) }}
                </button>
              </li>
            </ul>
          </details>
          <p class="pw-input-note">以上范围与决定状态冻结于提交时；链接定位到聊天中的原记录。</p>
        </section>
        <details class="pw-input-identifiers">
          <summary class="disclosure">记录标识</summary>
          <dl>
            <dt>请求</dt>
            <dd>{{ context.requestId }}</dd>
            <dt>工作台</dt>
            <dd>{{ context.workspaceId }}</dd>
            <dt>讨论版本</dt>
            <dd>{{ context.discussion.versionId }}</dd>
            <dt>修改版本</dt>
            <dd>{{ context.editTarget.versionId }}</dd>
            <dt>来源版本</dt>
            <dd>{{ context.editTarget.parentId ?? '无' }}</dd>
            <dt>规则摘要</dt>
            <dd>{{ context.rules.digest }}</dd>
          </dl>
        </details>
      </template>
    </div>
  </details>
</template>

<style scoped>
.pw-input-context {
  margin-top: 8px;
  font-size: 11px;
  color: var(--text2);
  overflow-wrap: anywhere;
}

.pw-input-context summary {
  cursor: pointer;
}

.pw-input-context-body {
  min-width: 0;
  margin-top: 8px;
  padding: 10px;
  background: var(--panel);
  border: 1px solid var(--line2);
  border-radius: 9px;
}

.pw-input-context-body > section {
  margin-top: 12px;
}

.pw-input-context-body p {
  margin: 5px 0;
}

.pw-input-context-body pre {
  max-height: 240px;
  margin: 5px 0 8px;
  padding: 7px 9px;
  overflow: auto;
  font: inherit;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  background: var(--bg);
  border: 1px solid var(--line2);
  border-radius: 6px;
}

.pw-input-context-body dl {
  display: grid;
  grid-template-columns: minmax(60px, auto) minmax(0, 1fr);
  gap: 4px 8px;
  margin: 6px 0;
}

.pw-input-context-body dt,
.pw-input-context-body small,
.pw-input-note {
  color: var(--muted);
}

.pw-input-context-body dd {
  margin: 0;
}

.pw-input-context-body small {
  display: block;
  font-size: 10px;
}

.pw-input-list,
.pw-input-links {
  display: grid;
  gap: 8px;
  margin: 7px 0;
  padding: 0;
  list-style: none;
}

.pw-input-list li,
.pw-input-links li {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
}

.pw-input-region,
.pw-input-reference {
  margin-top: 8px;
}

.pw-input-links button {
  padding: 0;
  text-align: left;
  color: var(--pink-deep);
}

.pw-input-links button:disabled {
  color: var(--muted);
}

.pw-input-identifiers {
  margin-top: 12px;
  color: var(--muted);
}
</style>
