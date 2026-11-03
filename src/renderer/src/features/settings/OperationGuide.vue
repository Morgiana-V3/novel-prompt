<script setup lang="ts">
import type { OperationTopic } from './operation-guides'
import Icon from '../../shared/ui/Icon.vue'
defineProps<{ topic: OperationTopic }>()
</script>
<template>
  <article class="card operation-guide">
    <div class="card-head">
      <span class="card-icon"><Icon name="book" /></span>
      <h2>{{ topic.label }}</h2>
    </div>
    <section
      v-for="section in topic.sections"
      :key="section.title"
    >
      <h3>{{ section.title }}</h3>
      <p
        v-for="paragraph in section.paragraphs"
        :key="paragraph"
      >
        {{ paragraph }}
      </p>
      <dl v-if="section.shortcuts">
        <div
          v-for="[key, description] in section.shortcuts"
          :key="key"
        >
          <dt>
            <kbd>{{ key }}</kbd>
          </dt>
          <dd>{{ description }}</dd>
        </div>
      </dl>
    </section>
  </article>
</template>

<style scoped>
.operation-guide section + section {
  margin-top: 24px;
  padding-top: 20px;
  border-top: 1px solid var(--line);
}

.operation-guide p,
.operation-guide dd {
  color: var(--text2);
  line-height: 1.8;
}

.operation-guide p {
  margin: 10px 0 0;
}

.operation-guide dl {
  margin: 12px 0;
}

.operation-guide dl > div {
  display: grid;
  grid-template-columns: 130px minmax(0, 1fr);
  gap: 12px;
  margin: 8px 0;
}

.operation-guide dd {
  margin: 0;
}

.operation-guide kbd {
  display: inline-block;
  padding: 1px 5px;
  border: 1px solid var(--line);
  border-radius: 4px;
  font-size: 12px;
}
</style>
