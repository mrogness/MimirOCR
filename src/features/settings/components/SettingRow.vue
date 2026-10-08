<script setup>
defineProps({
  label: {
    type: String,
    required: true,
  },
  description: {
    type: String,
    default: '',
  },
  inputId: {
    type: String,
    default: '',
  },
})
</script>

<template>
  <div class="space-y-2 py-2">
    <div class="flex items-center gap-2">
      <label
        v-if="inputId"
        :for="inputId"
        class="text-sm font-medium text-brand-700"
      >
        {{ label }}
      </label>

      <span
        v-else
        class="text-sm font-medium text-brand-700"
      >
        {{ label }}
      </span>

      <slot name="help" />
    </div>

    <p
      v-if="description"
      :id="inputId ? `${inputId}-description` : undefined"
      class="text-sm text-brand-500"
    >
      {{ description }}
    </p>

    <div>
      <slot />
    </div>
  </div>
</template>
