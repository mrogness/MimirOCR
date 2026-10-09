<script setup>
const quickstartSteps = [
  'Select Add Project, choose a project name, and open the new workspace.',
  'Select the PDF you want MimirOCR to process.',
  'Review the detected DPI, binarization preview, and page layout before submitting.',
  'Select Submit and Process, then wait for rasterization, segmentation, and OCR to finish.',
  'Open Output Review and correct line order, unwanted lines, and transcription errors.',
  'Review the export options and create either a comparison-friendly or reading-friendly PDF.',
]
</script>

<template>
  <section id="getting-started" class="scroll-mt-6 space-y-5" aria-labelledby="getting-started-title">
    <header>
      <p class="text-xs font-semibold uppercase tracking-wide text-brand-500">Start here</p>
      <h2 id="getting-started-title" class="mt-1 text-xl font-semibold text-brand-900">
        From scanned Fraktur to editable text
      </h2>
      <p class="mt-2 max-w-3xl text-sm leading-6 text-brand-600">
        MimirOCR is a desktop application for transcribing printed Dano-Norwegian Fraktur into Latin-script text.
        All processing happens locally, and resulting predictions can be reviewed alongside the source text.
      </p>
    </header>

    <div class="rounded border border-brand-200 bg-white p-5">
      <h3 class="text-base font-semibold text-brand-900">Quickstart</h3>
      <ol class="mt-4 grid gap-3 md:grid-flow-col md:grid-cols-2 md:grid-rows-3">
        <li v-for="(step, index) in quickstartSteps" :key="step" class="flex gap-3 text-sm leading-6 text-brand-700">
          <span
            class="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand-900 text-xs font-bold text-white">
            {{ index + 1 }}
          </span>
          <span>{{ step }}</span>
        </li>
      </ol>
    </div>
  </section>
</template>
