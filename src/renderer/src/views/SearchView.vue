<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import type { SearchHit, TagCategory } from '@shared/types'
import { CATEGORY_LABEL } from '@shared/types'
import { CAT_CLASS, appendTag, copy, state, fieldList, fieldLabel, sameField } from '../store'
import TagCard from '../components/TagCard.vue'
import Icon from '../components/Icon.vue'
import Mascot from '../components/Mascot.vue'

/** tag 加到哪里：默认是最近编辑过的输入框 */
const fields = computed(() => fieldList())
const targetIndex = computed(() => Math.max(0, fields.value.findIndex((f) => sameField(f, state.focus))))
function setTarget(i: string) {
  const f = fields.value[Number(i)]
  if (f) state.focus = f
}

const query = ref('')
const cats = ref<TagCategory[]>([])
const hits = ref<SearchHit[]>([])
const allCats: TagCategory[] = [0, 1, 3, 4, 5, 100]
const examples = ['双马尾', 'school uniform', 'smw', '逆光', 'artist', '猫耳']
let timer: ReturnType<typeof setTimeout> | undefined

async function run() {
  hits.value = query.value.trim()
    ? await window.api.search({ query: query.value, categories: [...cats.value], limit: 120 })
    : []
}
watch(
  [query, cats],
  () => {
    clearTimeout(timer)
    timer = setTimeout(run, 150)
  },
  { deep: true }
)

function toggle(c: TagCategory) {
  const i = cats.value.indexOf(c)
  if (i >= 0) cats.value.splice(i, 1)
  else cats.value.push(c)
}

// 视图用 v-show 常驻，autofocus 只在首次生效；切到搜索页时手动聚焦
const input = ref<HTMLInputElement>()
watch(
  () => state.tab,
  async (t) => {
    if (t !== 'search') return
    await nextTick()
    input.value?.focus()
  }
)
</script>

<template>
  <div class="view search">
    <div class="search-box">
      <Icon name="search" :size="19" />
      <input ref="input" v-model="query" class="search-input" placeholder="搜搜看：双马尾 / twin tails / smw" autofocus />
      <button v-if="query" class="icon-btn sm clear" @click="query = ''"><Icon name="x" :size="14" /></button>
    </div>
    <div class="cat-filter">
      <button v-for="c in allCats" :key="c" :class="['chip', CAT_CLASS[c], { on: cats.includes(c) }]" @click="toggle(c)">
        <span class="cat-dot"></span>{{ CATEGORY_LABEL[c] }}
      </button>
      <span class="hint ml-auto">
        <span class="add-target">
          <kbd>单击</kbd>加入
          <select class="input sm" :value="targetIndex" @change="setTarget(($event.target as HTMLSelectElement).value)">
            <option v-for="(f, i) in fields" :key="i" :value="i">{{ fieldLabel(f) }}</option>
          </select>
        </span>
        <span><kbd>右键</kbd>复制</span>
        <span><kbd>双击中文</kbd>编辑翻译</span>
      </span>
    </div>

    <div class="scroll search-results">
      <div class="tag-grid wide" v-if="hits.length">
        <div v-for="(h, i) in hits" :key="h.name" class="hit-wrap" @contextmenu.prevent="copy(h.category === 1 ? 'artist:' + h.display : h.display)">
          <TagCard :tag="h" :via-alias="h.viaAlias" :index="i" editable @click="appendTag(h.display, h.category)" />
        </div>
      </div>
      <div v-else-if="query" class="empty">
        <Mascot mood="confused" :size="220" />
        <p>没找到「{{ query }}」，换个说法试试？</p>
      </div>
      <div v-else class="empty">
        <Mascot :mood="state.db?.loaded ? 'idle' : 'chill'" :size="220" />
        <p>{{ state.db?.loaded ? '想找什么 tag？试试这些：' : '还没有 tag 数据，先去设置页下载吧' }}</p>
        <div class="suggest center" v-if="state.db?.loaded">
          <button v-for="e in examples" :key="e" class="chip" @click="query = e">{{ e }}</button>
        </div>
      </div>
    </div>
  </div>
</template>
