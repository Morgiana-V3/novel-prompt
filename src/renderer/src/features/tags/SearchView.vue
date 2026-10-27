<script setup lang="ts">
import { promptState } from '../prompts/state'
import { tagState } from './state'
import { shellState } from '../../shared/state/shell'
import { computed, nextTick, ref, watch } from 'vue'
import type { SearchHit, TagCategory } from '@shared/tags/types'
import { CATEGORY_LABEL } from '@shared/tags/types'
import { CAT_CLASS } from './state'
import { appendTag, fieldList, fieldLabel, sameField } from '../prompts/actions'
import { copy } from '../../shared/lib/notifications'
import TagCard from './components/TagCard.vue'
import Icon from '../../shared/ui/Icon.vue'
import Mascot from '../../shared/ui/Mascot.vue'
import ThemeSelect from '../../shared/ui/ThemeSelect.vue'

/** tag 加到哪里：默认是最近编辑过的输入框 */
const fields = computed(() => fieldList())
const targetIndex = computed(() =>
  Math.max(
    0,
    fields.value.findIndex((field) => sameField(field, promptState.focus)),
  ),
)
function setTarget(i: number) {
  const field = fields.value[Number(i)]
  if (field) {
    promptState.focus = field
  }
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
  { deep: true },
)

function toggle(category: TagCategory) {
  const i = cats.value.indexOf(category)
  if (i >= 0) {
    cats.value.splice(i, 1)
  } else {
    cats.value.push(category)
  }
}

// 视图用 v-show 常驻，autofocus 只在首次生效；切到搜索页时手动聚焦
const input = ref<HTMLInputElement>()
watch(
  () => shellState.tab,
  async (tab) => {
    if (tab !== 'search') {
      return
    }
    await nextTick()
    input.value?.focus()
  },
)
</script>

<template>
  <div class="view search">
    <div class="search-box">
      <Icon
        name="search"
        :size="19"
      />
      <input
        ref="input"
        v-model="query"
        class="search-input"
        placeholder="搜搜看：双马尾 / twin tails / smw"
        autofocus
      />
      <button
        v-if="query"
        class="icon-btn sm clear"
        @click="query = ''"
      >
        <Icon
          name="x"
          :size="14"
        />
      </button>
    </div>
    <div class="cat-filter">
      <button
        v-for="c in allCats"
        :key="c"
        :class="['chip', CAT_CLASS[c], { on: cats.includes(c) }]"
        @click="toggle(c)"
      >
        <span class="cat-dot"></span>{{ CATEGORY_LABEL[c] }}
      </button>
      <span class="hint ml-auto">
        <span class="add-target">
          <kbd>单击</kbd>加入
          <ThemeSelect
            class="sm"
            :model-value="targetIndex"
            :options="fields.map((f, i) => ({ value: i, label: fieldLabel(f) }))"
            aria-label="添加提示词到"
            @update:model-value="setTarget"
          />
        </span>
        <span><kbd>右键</kbd>复制</span>
        <span><kbd>双击中文</kbd>编辑翻译</span>
      </span>
    </div>

    <div class="scroll search-results">
      <div
        v-if="hits.length"
        class="tag-grid wide"
      >
        <div
          v-for="(tagItem, indexItem) in hits"
          :key="tagItem.name"
          class="hit-wrap"
          @contextmenu.prevent="
            copy(tagItem.category === 1 ? 'artist:' + tagItem.display : tagItem.display)
          "
        >
          <TagCard
            :tag="tagItem"
            :via-alias="tagItem.viaAlias"
            :index="indexItem"
            editable
            @click="appendTag(tagItem.display, tagItem.category)"
          />
        </div>
      </div>
      <div
        v-else-if="query"
        class="empty"
      >
        <Mascot
          mood="shrug"
          :size="220"
        />
        <p>没找到「{{ query }}」，换个说法试试？</p>
      </div>
      <div
        v-else
        class="empty"
      >
        <Mascot
          :mood="tagState.db?.loaded ? 'search' : 'point'"
          :size="220"
        />
        <p>
          {{
            tagState.db?.loaded ? '想找什么 tag？试试这些：' : '还没有 tag 数据，先去设置页下载吧'
          }}
        </p>
        <div
          v-if="tagState.db?.loaded"
          class="suggest center"
        >
          <button
            v-for="e in examples"
            :key="e"
            class="chip"
            @click="query = e"
          >
            {{ e }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
