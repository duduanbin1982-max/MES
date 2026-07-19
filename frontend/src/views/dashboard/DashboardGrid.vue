<template>
  <section class="dashboard-grid" :class="{ 'dashboard-grid--bottom': bottom }">
    <slot />
  </section>
</template>

<script setup lang="ts">
withDefaults(defineProps<{ bottom?: boolean }>(), {
  bottom: false,
})
</script>

<style scoped>
.dashboard-grid {
  display: grid;
  grid-template-columns: minmax(0, 1.45fr) minmax(360px, 0.75fr);
  gap: 16px;
  margin-bottom: 16px;
}

.dashboard-grid--bottom {
  align-items: start;
}

@media (max-width: 1200px) {
  .dashboard-grid {
    grid-template-columns: 1fr;
  }
}
</style>
