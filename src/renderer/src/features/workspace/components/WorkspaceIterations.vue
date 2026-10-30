<script setup lang="ts">
import { computed } from 'vue'
import { pageConfigurationChanges, type PageWorkspace } from '@shared/workspace/model'
import { reviewDrafts } from '../../prompts/prompt-review'
import PromptReview from '../../prompts/components/PromptReview.vue'
import FavoriteButton from '../../../shared/ui/FavoriteButton.vue'

const props = defineProps<{ work: PageWorkspace; versionId: string; compareId: string }>()
const iteration = computed(() =>
  pageConfigurationChanges(props.work, props.versionId, props.compareId),
)
const groups = computed(() =>
  iteration.value.before && iteration.value.snapshot
    ? reviewDrafts(iteration.value.before.draft, iteration.value.snapshot.draft)
    : [],
)
function name(id: string) {
  const i = props.work.versions.findIndex((version) => version.id === id)
  return props.work.versions[i]?.label ?? '历史版本'
}
function value(value2: unknown, label: string) {
  if (value2 === undefined) {
    return '无 / 未记录'
  }
  if (value2 === null) {
    if (label === '种子') {
      return '随机' as const
    }
    if (label === '区域对应角色') {
      return '全局' as const
    }
    return '未指定' as const
  }
  if (label === '区域对应角色' && typeof value2 === 'number') {
    return `角色 ${value2 + 1}`
  }
  if (typeof value2 === 'boolean') {
    if (value2) {
      return '开' as const
    }
    return '关' as const
  }
  if (value2 === 'generate') {
    return '整图生成' as const
  }
  if (value2 === 'inpaint') {
    return '局部重绘' as const
  }
  return String(value2)
}
const parameters = computed(() =>
  iteration.value.parameters.map((parameterChange) => ({
    ...parameterChange,
    before: value(parameterChange.before, parameterChange.label),
    after: value(parameterChange.after, parameterChange.label),
  })),
)
const maskUrl = computed(() => {
  const mask = iteration.value.result?.inpaint?.mask
  if (mask) {
    if (mask.startsWith('data:')) {
      return mask
    }
    return `data:image/png;base64,${mask}`
  }
  return '' as const
})
</script>

<template>
  <section class="wi">
    <article class="wi-record">
      <div class="wi-images">
        <figure>
          <img
            v-if="iteration.source?.image && !iteration.source.image.missing"
            :src="iteration.source.image.url"
            alt="对比图片"
            @error="iteration.source.image.missing = true"
          />
          <div
            v-else
            class="wi-no-image"
          >
            {{ iteration.source?.image ? '图片缺失 · 文字记录保留' : '无来源图片，可指定对比对象' }}
          </div>
          <figcaption>
            对比对象{{ iteration.source ? ' · ' + name(iteration.source.id) : '' }}
            <FavoriteButton
              v-if="iteration.source?.image && !iteration.source.image.missing"
              :image="iteration.source.image"
            />
          </figcaption>
        </figure>
        <figure>
          <img
            v-if="iteration.version?.image && !iteration.version.image.missing"
            :src="iteration.version.image.url"
            alt="正在查看的图片"
            @error="iteration.version.image.missing = true"
          />
          <div
            v-else
            class="wi-no-image"
          >
            {{ iteration.version?.image ? '图片缺失 · 文字记录保留' : '暂无图片' }}
          </div>
          <figcaption>
            正在查看 · {{ name(versionId) }}
            <FavoriteButton
              v-if="iteration.version?.image && !iteration.version.image.missing"
              :image="iteration.version.image"
            />
          </figcaption>
        </figure>
      </div>
      <p
        v-if="!iteration.before"
        class="muted small"
      >
        尚无可用的对比快照，可选择其他版本作为对比对象。
      </p>
      <p
        v-else-if="!iteration.snapshot"
        class="muted small"
      >
        此版本未保存生成快照，仅能查看图片与历史草稿。
      </p>
      <p
        v-else-if="!iteration.source?.generated"
        class="muted small"
      >
        对比对象为项目起始稿与设置，不代表导入图片的实际生成参数。
      </p>
      <PromptReview
        :groups="groups"
        before-label="对比对象"
        after-label="正在查看"
      />
      <p
        v-if="
          iteration.before &&
          iteration.snapshot &&
          !groups.length &&
          !parameters.length &&
          !iteration.maskChanged
        "
        class="muted small"
      >
        生图配置无差异
      </p>
      <table
        v-if="parameters.length && iteration.before"
        class="wi-params"
      >
        <caption>
          生图配置
          <span>{{ parameters.length }} 项修改</span>
        </caption>
        <thead>
          <tr>
            <th>参数</th>
            <th>对比对象</th>
            <th>正在查看</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="p in parameters"
            :key="p.label"
          >
            <th>{{ p.label }}</th>
            <td>
              <span class="wi-param-before">{{ p.before }}</span>
            </td>
            <td>
              <span class="wi-param-after">{{ p.after }}</span>
            </td>
          </tr>
        </tbody>
      </table>
      <p
        v-if="iteration.maskChanged && !iteration.result?.inpaint"
        class="muted small"
      >
        此版本不再使用重绘遮罩。
      </p>
      <details
        v-if="iteration.maskChanged && iteration.result?.inpaint"
        class="wi-mask"
      >
        <summary>
          重绘区域已变更{{
            iteration.result.inpaint.label ? ` · ${iteration.result.inpaint.label}` : ''
          }}
        </summary>
        <img
          :src="maskUrl"
          alt="本轮遮罩，白色为重绘区域"
        />
        <p v-if="iteration.result.inpaint.instruction">
          {{ iteration.result.inpaint.instruction }}
        </p>
        <p>
          重绘强度 {{ iteration.result.inpaint.strength
          }}<template v-if="iteration.result.inpaint.target != null">
            · 角色 {{ iteration.result.inpaint.target + 1 }}</template
          >
        </p>
      </details>
    </article>
  </section>
</template>

<style scoped>
.wi-compare {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
  margin-bottom: 18px;
}

.wi-compare label {
  display: flex;
  align-items: center;
  gap: 8px;
}

.wi-compare :deep(.theme-select) {
  max-width: 260px;
}

.wi-heading {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
  font-size: 13px;
}

.wi-heading span,
.wi-heading time {
  font-size: 11px;
  color: var(--text2);
}

.wi-heading time {
  margin-left: auto;
}

.wi-images figure {
  margin: 0;
  min-width: 0;
}

.wi-images img,
.wi-no-image {
  width: 100%;
  height: 220px;
  object-fit: contain;
  background: var(--panel);
  border-radius: 10px;
}

.wi-no-image {
  display: grid;
  place-items: center;
  color: var(--muted);
  font-size: 12px;
}

.wi-images figcaption {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  text-align: center;
  font-size: 11px;
  color: var(--text2);
  padding-top: 6px;
}

.wi-params {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
  margin: 16px 0;
  text-align: left;
  table-layout: fixed;
}

.wi-params caption {
  text-align: left;
  padding: 10px 0;
  font-size: 13px;
  font-weight: 650;
}

.wi-params caption span {
  margin-left: 8px;
  color: var(--text2);
  font-size: 11px;
  font-weight: 400;
}

.wi-param-before,
.wi-param-after {
  padding: 2px 6px;
  border-radius: 4px;
  box-decoration-break: clone;
}

.wi-param-before {
  background: var(--bad-soft);
  color: var(--bad);
}

.wi-param-after {
  background: var(--ok-soft);
  color: var(--ok);
}

.wi-params th,
.wi-params td {
  padding: 8px;
  border-bottom: 1px solid var(--line);
  overflow-wrap: anywhere;
}

.wi-params th {
  font-weight: 500;
}

.wi-params thead {
  color: var(--text2);
}

.wi-mask {
  margin-top: 16px;
  font-size: 12px;
}

.wi summary {
  cursor: pointer;
  color: var(--text2);
}

.wi-mask img {
  display: block;
  max-width: 100%;
  height: 160px;
  margin-top: 10px;
}

.wi-mask p {
  white-space: pre-wrap;
}

.wi-start {
  padding: 12px 0;
}

.wi {
  min-width: 0;
  margin: 0 0 20px;
}

.wi-record {
  border-radius: 16px;
  min-width: 0;
  border: 0;
  padding: 0;
}

.wi-images {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
  margin: 0 0 16px;
}
</style>
