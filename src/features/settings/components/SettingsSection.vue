<script setup>
/** @file Group related settings under a title, optional description, and header action. */
defineProps({
  /** Visible heading for this group of related settings. */
  title: {
    type: String,
    required: true,
  },
  /** Optional explanatory text displayed beneath the setting/section heading. */
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

        <!-- @slot Optional action control aligned with the section heading. -->
        <slot name="header-action" />
      </div>
    </header>

    <!-- @slot Setting rows or other controls belonging to this section. -->
    <slot />
  </section>
</template>
