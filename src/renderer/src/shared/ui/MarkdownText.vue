<script setup lang="ts">
import { computed } from 'vue'
import { renderMarkdown } from '../lib/markdown'
import { isWebUrl } from '@shared/web-url'
import { cleanErr } from '../lib/format'
import { toast } from '../lib/notifications'
const props = defineProps<{ text: string }>()
const html = computed(() => renderMarkdown(props.text))
async function openLink(event: MouseEvent) {
  const link = (event.target as Element).closest('a')
  if (!link) {
    return
  }
  event.preventDefault()
  const url = link.getAttribute('href')
  if (isWebUrl(url)) {
    try {
      await window.api.openWebUrl(url)
    } catch (error) {
      toast(cleanErr(error))
    }
  }
}
</script>
<template>
  <!-- eslint-disable vue/no-v-html -- renderMarkdown disables raw HTML and filters link protocols. -->
  <div
    class="markdown-text"
    @click="openLink"
    @auxclick.prevent
    v-html="html"
  ></div>
</template>
<style scoped>
.markdown-text {
  white-space: normal;
  overflow-wrap: anywhere;
  user-select: text;
  line-height: 1.8;
  min-width: 0;
}

.markdown-text :deep(> :first-child) {
  margin-top: 0;
}

.markdown-text :deep(> :last-child) {
  margin-bottom: 0;
}

.markdown-text :deep(p) {
  margin: 0 0 0.8em;
}

.markdown-text :deep(h1),
.markdown-text :deep(h2),
.markdown-text :deep(h3),
.markdown-text :deep(h4),
.markdown-text :deep(h5),
.markdown-text :deep(h6) {
  font-size: 1.08em;
  font-weight: 650;
  line-height: 1.6;
  margin: 1em 0 0.45em;
}

.markdown-text :deep(ul),
.markdown-text :deep(ol) {
  padding-left: 1.6em;
  margin: 0.6em 0;
}

.markdown-text :deep(li) {
  margin: 0.3em 0;
}

.markdown-text :deep(li > p) {
  margin: 0.3em 0;
}

.markdown-text :deep(strong) {
  font-weight: 650;
}

.markdown-text :deep(code) {
  font-family: var(--mono);
  font-size: 0.95em;
  background: var(--panel);
  border-radius: 4px;
  padding: 1px 4px;
  white-space: break-spaces;
}

.markdown-text :deep(pre) {
  max-width: 100%;
  overflow: auto;
  padding: 12px;
  background: var(--panel);
  border: 1px solid var(--line);
  border-radius: 10px;
  margin: 0.8em 0;
  line-height: 1.6;
}

.markdown-text :deep(pre code) {
  padding: 0;
  background: none;
  white-space: pre;
}

.markdown-text :deep(blockquote) {
  margin: 0.8em 0;
  padding-left: 12px;
  border-left: 3px solid var(--pink-line);
  color: var(--text2);
}

.markdown-text :deep(a) {
  color: var(--pink-deep);
  text-decoration: underline;
  text-underline-offset: 3px;
}

.markdown-text :deep(table) {
  display: block;
  max-width: 100%;
  overflow-x: auto;
  border-collapse: collapse;
  font-size: 0.95em;
  margin: 0.8em 0;
}

.markdown-text :deep(th),
.markdown-text :deep(td) {
  padding: 6px 10px;
  border: 1px solid var(--line);
  text-align: left;
}

.markdown-text :deep(hr) {
  border: 0;
  border-top: 1px solid var(--line);
  margin: 1em 0;
}
</style>
