<script setup>
import { nextTick, onMounted, watch } from 'vue'
import { useRoute } from 'vue-router'

import AcknowledgementsSection from '../components/help/AcknowledgementsSection.vue'
import ExportGuideSection from '../components/help/ExportGuideSection.vue'
import FrakturReferenceSection from '../components/help/FrakturReferenceSection.vue'
import GettingStartedSection from '../components/help/GettingStartedSection.vue'
import InfoNavigation from '../components/help/InfoNavigation.vue'
import ReviewTipsSection from '../components/help/ReviewTipsSection.vue'
import SettingsReferenceSection from '../components/help/SettingsReferenceSection.vue'

const route = useRoute()

async function revealHashTarget(hash) {
  if (!hash) {
    return
  }

  await nextTick()

  const targetId = decodeURIComponent(hash.replace(/^#/, ''))
  const target = document.getElementById(targetId)
  if (!target) {
    return
  }

  let parentDetails = target.closest('details')
  while (parentDetails) {
    parentDetails.open = true
    parentDetails = parentDetails.parentElement?.closest('details') || null
  }

  target.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

watch(
  () => route.hash,
  (hash) => {
    void revealHashTarget(hash)
  },
)

onMounted(() => {
  void revealHashTarget(route.hash)
})
</script>

<template>
  <div class="info-page h-full min-h-0 overflow-y-auto pr-1">
    <header class="border-b-2 border-brand-200 pb-4">
      <h1 class="text-2xl font-bold">MimirOCR Help</h1>
      <p class="text-sm text-brand-500">
        Learn how to process, review, and export Dano-Norwegian Fraktur documents.
      </p>
    </header>

    <div class="mt-6 grid items-start gap-8 xl:grid-cols-[14rem_minmax(0,1fr)]">
      <InfoNavigation class="xl:sticky xl:top-0" />

      <article class="min-w-0 max-w-5xl space-y-10 pb-8">
        <GettingStartedSection />
        <ReviewTipsSection />
        <FrakturReferenceSection />
        <SettingsReferenceSection />
        <ExportGuideSection />
        <AcknowledgementsSection />
      </article>
    </div>
  </div>
</template>
