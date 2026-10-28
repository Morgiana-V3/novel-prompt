<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { basicSetup } from 'codemirror'
import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'

const props = defineProps<{ modelValue: string; documentPath: string; readonly?: boolean }>()
const emit = defineEmits<{ 'update:modelValue': [text: string] }>()
const host = ref<HTMLDivElement>()
const documents = new Map<string, EditorState>()
let view: EditorView | undefined
let currentPath = props.documentPath

function createState(text: string): EditorState {
  return EditorState.create({
    doc: text,
    extensions: [
      basicSetup,
      markdown({ base: markdownLanguage, completeHTMLTags: false }),
      EditorView.lineWrapping,
      EditorState.readOnly.of(!!props.readonly),
      EditorView.editable.of(!props.readonly),
      EditorView.contentAttributes.of({ 'aria-label': 'Markdown 源码', spellcheck: 'false' }),
      EditorView.updateListener.of((update) => {
        if (update.docChanged) {
          emit('update:modelValue', update.state.doc.toString())
        }
      }),
      EditorView.theme({
        '&': { height: '100%', fontSize: '12px', backgroundColor: 'var(--bg)' },
        '.cm-scroller': { overflow: 'auto', fontFamily: 'var(--mono)', lineHeight: '1.7' },
        '.cm-content': { padding: '12px 0' },
        '.cm-gutters': { backgroundColor: 'var(--panel)', color: 'var(--muted)', border: 'none' },
        '&.cm-focused': { outline: 'none' },
      }),
    ],
  })
}

onMounted(() => {
  view = new EditorView({ state: createState(props.modelValue), parent: host.value })
})
watch(
  () => [props.documentPath, props.modelValue, props.readonly] as const,
  () => {
    if (!view) {
      return
    }
    if (currentPath !== props.documentPath) {
      documents.set(currentPath, view.state)
      currentPath = props.documentPath
      const previous = documents.get(currentPath)
      view.setState(
        previous?.doc.toString() === props.modelValue ? previous : createState(props.modelValue),
      )
    } else if (view.state.doc.toString() !== props.modelValue) {
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: props.modelValue } })
    }
  },
)
onBeforeUnmount(() => {
  view?.destroy()
  documents.clear()
})
</script>

<template>
  <div
    ref="host"
    class="markdown-editor"
  ></div>
</template>

<style scoped>
.markdown-editor {
  height: 100%;
  min-height: 0;
  min-width: 0;
  overflow: hidden;
}
</style>
