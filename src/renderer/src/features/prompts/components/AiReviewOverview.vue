<script setup lang="ts">
defineProps<{ notes: string }>()
</script>
<template>
  <p
    v-if="notes"
    class="review-description"
  >
    {{ notes }}
  </p>
</template>
<style scoped>
.review-description {
  margin: 0;
  font-size: 13px;
  line-height: 1.7;
}
</style>
