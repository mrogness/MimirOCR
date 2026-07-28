<script setup>
defineProps({
  title: {
    type: String,
    required: true,
  },
  description: {
    type: String,
    default: '',
  },
})
</script>

<template>
  <section class="space-y-4 rounded border border-brand-200 bg-white p-5">
    <header class="space-y-1">
      <div class="flex items-start justify-between gap-3">
        <div>
          <h2 class="text-lg font-semibold text-brand-900">{{ title }}</h2>
          <p v-if="description" class="text-sm text-brand-500">
            {{ description }}
          </p>
        </div>

        <slot name="header-action" />
      </div>
    </header>

    <slot />
  </section>
</template>
