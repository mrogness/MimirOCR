<script setup>
/** @file Lay out one labeled setting with optional description/help and a slot for its input control. */
defineProps({
  /** Accessible or visible label for this reusable control. */
  label: {
    type: String,
    required: true,
  },
  /** Optional explanatory text displayed beneath the setting/section heading. */
  description: {
    type: String,
    default: '',
  },
  /** Optional input element ID connecting the setting label and description to its control. */
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

      <!-- @slot Optional help trigger beside the setting label. -->
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
      <!-- @slot The setting's input control and any related validation feedback. -->
      <slot />
    </div>
  </div>
</template>
