<script setup>
import FrakturCharacterGuide from '../components/help/FrakturCharacterGuide.vue'
import CompareCharacters from '../components/help/CompareCharacters.vue'

</script>

<template>
  <div class="info-page h-full min-h-0 space-y-6 overflow-y-auto pr-1">
    <header class="border-b-2 border-brand-200 pb-2">
      <h1 class="text-2xl font-bold">Info</h1>
      <p class="text-sm text-brand-500">
        Information and tips for MimirOCR.
      </p>
    </header>

    <FrakturCharacterGuide />
    <CompareCharacters/>
  </div>
</template>