<script setup>
const reviewSteps = [
  {
    title: 'Correct structure first',
    text: 'Check line order and delete falsely detected lines before spending time correcting individual characters.',
  },
  {
    title: 'Use both sides together',
    text: 'Select an overlay or text row to keep the source line and editable transcription aligned while you work.',
  },
  {
    title: 'Review suspicious characters',
    text: 'Use Find Next Suspicious as a queue, then compare each highlighted character with the scan before changing it.',
  },
  {
    title: 'Make a final page pass',
    text: 'Check page order, line order, and remaining highlights before exporting the corrected transcription.',
  },
]
</script>

<template>
  <section id="reviewing-output" class="scroll-mt-6 space-y-5" aria-labelledby="reviewing-output-title">
    <header>
      <p class="text-xs font-semibold uppercase tracking-wide text-brand-500">Tips and tricks</p>
      <h2 id="reviewing-output-title" class="mt-1 text-xl font-semibold text-brand-900">
        Reviewing OCR output efficiently
      </h2>
      <p class="mt-2 max-w-3xl text-sm leading-6 text-brand-600">
        Treat OCR confidence as a guide rather than a verdict. A low-confidence character deserves inspection, but it
        may already be correct.
      </p>
    </header>

    <ol class="grid gap-3 md:grid-flow-col md:grid-cols-2 md:grid-rows-2" aria-label="Reviewing output steps">
      <li v-for="(step, index) in reviewSteps" :key="step.title"
        class="rounded border border-brand-200 bg-white p-4">
        <div class="flex items-start gap-3">
          <span class="text-sm font-bold text-brand-500">{{ index + 1 }}</span>
          <div>
            <h3 class="font-semibold text-brand-900">{{ step.title }}</h3>
            <p class="mt-1 text-sm leading-6 text-brand-600">{{ step.text }}</p>
          </div>
        </div>
      </li>
    </ol>

    <div class="grid gap-4 lg:grid-cols-2">
      <div class="rounded border border-brand-200 bg-brand-50/60 p-4">
        <h3 class="text-sm font-semibold text-brand-900">Overlay geometry</h3>
        <p class="mt-2 text-sm leading-6 text-brand-600">
          Raw polygons show the geometry returned by segmentation. Rectangular overlays can be calmer on sparse pages,
          but they are only approximations.
        </p>
      </div>
      <div class="rounded border border-brand-200 bg-brand-50/60 p-4">
        <h3 class="text-sm font-semibold text-brand-900">Confidence threshold</h3>
        <p class="mt-2 text-sm leading-6 text-brand-600">
          Raise the threshold to inspect more characters; lower it when highlighting becomes too noisy to be useful.
        </p>
      </div>
      <div class="rounded border border-brand-200 bg-brand-50/60 p-4">
        <h3 class="text-sm font-semibold text-brand-900">Undo</h3>
        <p class="mt-2 text-sm leading-6 text-brand-600">
          Use the Undo control or <kbd class="rounded border border-brand-300 bg-white px-1 py-0.5 text-xs">Ctrl/⌘ Z</kbd>
          to reverse the most recent review edit.
        </p>
      </div>
      <div class="rounded border border-brand-200 bg-brand-50/60 p-4">
        <h3 class="text-sm font-semibold text-brand-900">Title Pages</h3>
        <p class="mt-2 text-sm leading-6 text-brand-600">
          Many title pages are printed in a different typeface than the main text. MimirOCR may not be able to recognize these characters, so they may require more manual correction.
        </p>
      </div>
    </div>
  </section>
</template>
