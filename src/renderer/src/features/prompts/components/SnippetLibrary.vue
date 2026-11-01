<script setup lang="ts">
import { computed, nextTick, onMounted, reactive, ref } from 'vue'
import type { PromptSnippet } from '@shared/prompts/snippets'
import { cleanErr } from '../../../shared/lib/format'
import { copy, reportError, toast } from '../../../shared/lib/notifications'
import Icon from '../../../shared/ui/Icon.vue'

const items = ref<PromptSnippet[]>([])
const query = ref('')
const category = ref('')
/** 正在编辑的片段 id；'new' 表示新建 */
const editing = ref('')
const deleting = ref('')
/** 同一时间只展开一条，展开只影响这一行的高度 */
const expanded = ref('')
const busy = ref(false)
const error = ref('')
const nameInput = ref<HTMLInputElement[]>()
const draft = reactive({ name: '', text: '', category: '' })
const categories = computed(() => [
  ...new Set(items.value.map((item) => item.category).filter(Boolean)),
])
const filtered = computed(() => {
  const keyword = query.value.trim().toLowerCase()
  return items.value.filter(
    (item) =>
      (!category.value || category.value === item.category) &&
      `${item.name} ${item.text} ${item.category}`.toLowerCase().includes(keyword),
  )
})
const rows = computed(() => (editing.value === 'new' ? [null, ...filtered.value] : filtered.value))
async function run(action: () => Promise<void>) {
  busy.value = true
  error.value = ''
  try {
    await action()
  } catch (reason) {
    error.value = cleanErr(reason)
  } finally {
    busy.value = false
  }
}
onMounted(() =>
  run(async () => {
    items.value = await window.api.snippetsList()
  }),
)
async function edit(item?: PromptSnippet) {
  Object.assign(draft, {
    name: item?.name ?? '',
    text: item?.text ?? '',
    category: item?.category ?? (category.value || ''),
  })
  editing.value = item?.id ?? 'new'
  deleting.value = ''
  await nextTick()
  nameInput.value?.[0]?.focus()
}
const save = () =>
  run(async () => {
    const item = await window.api.snippetsSave({
      ...draft,
      id: editing.value === 'new' ? undefined : editing.value,
    })
    items.value = [item, ...items.value.filter((entry) => entry.id !== item.id)]
    if (category.value && category.value !== item.category) {
      category.value = ''
    }
    editing.value = ''
  })
function askDelete(id: string) {
  if (deleting.value !== id) {
    deleting.value = id
    return
  }
  run(async () => {
    await window.api.snippetsDelete(id)
    items.value = items.value.filter((item) => item.id !== id)
    deleting.value = ''
    toast('已删除片段')
  }).catch(reportError)
}
function toggle(id: string) {
  expanded.value = expanded.value === id ? '' : id
}
function copyText(item: PromptSnippet) {
  copy(item.text).catch(reportError)
}
</script>

<template>
  <section
    class="snippet-library"
    aria-label="提示词片段库"
  >
    <div class="snippet-toolbar">
      <div class="snippet-search">
        <Icon
          name="search"
          :size="14"
        />
        <input
          v-model="query"
          class="input"
          type="search"
          placeholder="搜索名称或提示词"
          aria-label="搜索提示词片段"
        />
      </div>
      <div
        v-if="categories.length"
        class="snippet-categories"
        role="group"
        aria-label="片段分类"
      >
        <button
          :class="['chip', { on: !category }]"
          @click="category = ''"
        >
          全部</button
        ><button
          v-for="name in categories"
          :key="name"
          :class="['chip', { on: category === name }]"
          @click="category = category === name ? '' : name"
        >
          {{ name }}
        </button>
      </div>
      <button
        class="btn accent small"
        :disabled="busy || editing === 'new'"
        @click="edit()"
      >
        新建片段
      </button>
    </div>
    <p
      v-if="error"
      class="error-box"
      role="alert"
    >
      {{ error }}
    </p>
    <div
      class="snippet-list scroll"
      role="list"
    >
      <template
        v-for="(item, index) in rows"
        :key="item?.id ?? 'new'"
      >
        <form
          v-if="editing === (item?.id ?? 'new')"
          class="snippet-form"
          @submit.prevent="save"
          @keydown.esc.stop="editing = ''"
        >
          <div class="snippet-form-row">
            <input
              ref="nameInput"
              v-model="draft.name"
              class="input"
              maxlength="120"
              placeholder="片段名称，例如：暖色电影光影"
              aria-label="片段名称"
              required
            /><input
              v-model="draft.category"
              class="input"
              maxlength="80"
              placeholder="分类（可选）"
              aria-label="片段分类"
            />
          </div>
          <div
            v-if="categories.length"
            class="snippet-form-categories"
          >
            <span>已有分类</span
            ><button
              v-for="name in categories"
              :key="name"
              type="button"
              :class="{ on: draft.category === name }"
              @click="draft.category = draft.category === name ? '' : name"
            >
              {{ name }}
            </button>
          </div>
          <textarea
            v-model="draft.text"
            class="input snippet-text"
            rows="4"
            maxlength="100000"
            placeholder="提示词正文"
            aria-label="提示词正文"
            required
            spellcheck="false"
          ></textarea>
          <div class="snippet-form-actions">
            <button
              class="btn ghost small"
              type="button"
              :disabled="busy"
              @click="editing = ''"
            >
              取消</button
            ><button
              class="btn primary small"
              :disabled="busy"
              type="submit"
            >
              保存片段
            </button>
          </div>
        </form>
        <article
          v-else-if="item"
          :class="['snippet-card', { open: expanded === item.id }]"
          role="listitem"
          :style="{ '--i': Math.min(index, 12) }"
          @mouseleave="deleting === item.id && (deleting = '')"
        >
          <button
            class="snippet-row"
            :aria-expanded="expanded === item.id"
            :title="expanded === item.id ? '收起' : '展开全文'"
            @click="toggle(item.id)"
          >
            <b>{{ item.name }}</b
            ><span
              v-if="item.category"
              class="snippet-category"
              >{{ item.category }}</span
            ><span class="snippet-excerpt">{{ item.text }}</span
            ><Icon
              name="chevron"
              class="snippet-caret"
              :size="13"
            />
          </button>
          <div class="snippet-actions">
            <button
              class="icon-btn sm"
              aria-label="复制片段"
              title="复制"
              @click="copyText(item)"
            >
              <Icon
                name="copy"
                :size="14"
              />
            </button>
            <button
              class="icon-btn sm"
              aria-label="编辑片段"
              title="编辑"
              :disabled="busy"
              @click="edit(item)"
            >
              <Icon
                name="edit"
                :size="14"
              />
            </button>
            <button
              v-if="deleting === item.id"
              class="btn small danger-confirm"
              :disabled="busy"
              @click="askDelete(item.id)"
            >
              确认删除
            </button>
            <button
              v-else
              class="icon-btn sm"
              aria-label="删除片段"
              title="删除"
              :disabled="busy"
              @click="askDelete(item.id)"
            >
              <Icon
                name="trash"
                :size="14"
              />
            </button>
          </div>
          <div class="snippet-full">
            <pre>{{ item.text }}</pre>
          </div>
        </article>
      </template>
      <div
        v-if="!filtered.length && editing !== 'new'"
        class="snippet-empty"
      >
        <Icon
          name="book"
          :size="28"
        />
        <b>{{ query || category ? '没有匹配的片段' : '还没有片段' }}</b>
        <span>{{
          query || category
            ? '换个关键词或分类试试。'
            : '把常用的画师串、光影、负面词存成片段，在提示词框悬停时的星标里一键插入。'
        }}</span>
      </div>
    </div>
  </section>
</template>

<style scoped>
.snippet-library {
  display: flex;
  flex-direction: column;
  gap: 14px;
  min-height: 0;
}

.snippet-toolbar {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-shrink: 0;
}

.snippet-toolbar > .btn {
  margin-left: auto;
  flex-shrink: 0;
}

.snippet-search {
  position: relative;
  display: flex;
  align-items: center;
  flex-shrink: 0;
}

.snippet-search .icon {
  position: absolute;
  left: 11px;
  color: var(--muted);
  pointer-events: none;
}

.snippet-search input {
  width: 240px;
  padding-left: 32px;
}

.snippet-categories {
  display: flex;
  gap: 6px;
  min-width: 0;
  overflow-x: auto;
  scrollbar-width: none;
}

.snippet-categories .chip {
  flex-shrink: 0;
  height: 26px;
  font-size: 12px;
}

/* 单列列表：每条一行，展开只撑开自己 */
.snippet-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  flex: 1;
  min-height: 0;
  padding: 2px 2px 12px;
}

.snippet-card {
  position: relative;
  flex-shrink: 0;
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  border: 1px solid var(--line);
  border-radius: 12px;
  background: var(--bg);
  animation: fade-up var(--dur-slow) var(--ease-out) backwards;
  animation-delay: calc(var(--i, 0) * 20ms);
  transition:
    border-color var(--dur-base) var(--ease-out),
    box-shadow var(--dur-base) var(--ease-out);
}

.snippet-card:hover {
  border-color: var(--line2);
}

.snippet-card.open {
  border-color: var(--pink-line);
  box-shadow: 0 0 0 3px var(--pink-soft);
}

.snippet-row {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
  height: 44px;
  padding: 0 4px 0 14px;
  text-align: left;
  border-radius: 12px;
}

.snippet-row:focus-visible {
  box-shadow: none;
}

.snippet-row b {
  flex: 0 1 auto;
  max-width: 220px;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 13px;
  font-weight: 600;
}

.snippet-category {
  flex-shrink: 0;
  max-width: 110px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  padding: 1px 8px;
  border-radius: 999px;
  background: var(--pink-soft);
  color: var(--pink-deep);
  font-size: 11px;
}

.snippet-excerpt {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--muted);
  font: 12px var(--mono);
}

.snippet-caret {
  flex-shrink: 0;
  color: var(--muted);
  transform: rotate(90deg);
  transition: transform var(--dur-base) var(--ease-out);
}

.snippet-card.open .snippet-caret {
  transform: rotate(-90deg);
}

/* 操作始终占位，只改透明度，悬停时摘要宽度不会跳动 */
.snippet-actions {
  display: flex;
  align-items: center;
  gap: 2px;
  padding-right: 8px;
  opacity: 0;
  transition: opacity var(--dur-base) var(--ease-out);
}

.snippet-card:hover .snippet-actions,
.snippet-card.open .snippet-actions,
.snippet-actions:focus-within,
.snippet-actions:has(.danger-confirm) {
  opacity: 1;
}

.snippet-full {
  grid-column: 1 / -1;
  display: grid;
  grid-template-rows: 0fr;
  transition: grid-template-rows var(--dur-slow) var(--ease-out);
}

.snippet-card.open .snippet-full {
  grid-template-rows: 1fr;
}

.snippet-full pre {
  min-height: 0;
  overflow: hidden;
  margin: 0 12px;
  padding: 0 12px;
  border-radius: 10px;
  background: var(--panel);
  color: var(--text);
  font: 12px/1.7 var(--mono);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  user-select: text;
  transition:
    padding var(--dur-slow) var(--ease-out),
    margin var(--dur-slow) var(--ease-out);
}

.snippet-card.open .snippet-full pre {
  margin-bottom: 12px;
  padding: 10px 12px;
  max-height: 320px;
  overflow: auto;
}

.snippet-form {
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px 14px 14px;
  border: 1px solid var(--pink-line);
  border-radius: 12px;
  background: var(--bg);
  box-shadow: 0 0 0 3px var(--pink-soft);
  animation: pop var(--dur-base) var(--ease-out);
}

.snippet-form-row {
  display: grid;
  grid-template-columns: minmax(0, 1.6fr) minmax(0, 1fr);
  gap: 8px;
}

.snippet-form-categories {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  font-size: 11.5px;
  color: var(--muted);
}

.snippet-form-categories button {
  height: 22px;
  padding: 0 9px;
  border-radius: 999px;
  background: var(--hover);
  color: var(--text2);
  font-size: 11.5px;
  transition:
    background-color var(--dur-fast) var(--ease-out),
    color var(--dur-fast) var(--ease-out);
}

.snippet-form-categories button.on {
  background: var(--pink-soft);
  color: var(--pink-deep);
}

.snippet-text {
  resize: vertical;
  min-height: 96px;
  font: 12px/1.7 var(--mono);
}

.snippet-form-actions {
  display: flex;
  justify-content: flex-end;
  gap: 6px;
}

.snippet-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 56px 16px;
  color: var(--muted);
  font-size: 12px;
  text-align: center;
  line-height: 1.7;
}

.snippet-empty b {
  color: var(--text);
  font-size: 14px;
}

.snippet-empty span {
  max-width: 360px;
}

@media (width <= 1100px) {
  .snippet-search input {
    width: 180px;
  }
}
</style>
