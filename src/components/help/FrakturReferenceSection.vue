<script setup>
import CompareCharacters from './CompareCharacters.vue'
import FrakturCharacterGuide from './FrakturCharacterGuide.vue'
</script>

<template>
  <section id="fraktur-reference" class="scroll-mt-6 space-y-5" aria-labelledby="fraktur-reference-title">
    <header>
      <p class="text-xs font-semibold uppercase tracking-wide text-brand-500">Fraktur reference</p>
      <h2 id="fraktur-reference-title" class="mt-1 text-xl font-semibold text-brand-900">
        Dano-Norwegian Fraktur 101
      </h2>
      <p class="mt-2 max-w-3xl text-sm leading-6 text-brand-600">
        Fraktur is a blackletter family whose flourishes and letterforms can look very different from modern Latin
        type. It was used for German and other European languages, including historical Dano-Norwegian printing.
      </p>
    </header>

    <div class="rounded border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-900">
      Capital I and J are identical in the Fraktur material targeted by MimirOCR. All I and J instances are thus predicted as I, though MimirOCR has a small stored lexicon that can be enabled to resolve some of this confusion for common J words such as Ja or Jeg.
    </div>

    <CompareCharacters />

    <div class="rounded border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-900">
      Fraktur, along with many other historical typefaces, uses the long s 'ſ' rather than 's' in certain contexts. MimirOCR includes an export setting to automatically convert long s to s in exported text, but for machine learning purposes, it does distinguish between the two forms in its transcriptions.
    </div>

    <details class="group rounded border border-brand-200 bg-white">
      <summary
        class="flex cursor-pointer list-none items-center justify-between gap-3 px-5 py-4 font-semibold text-brand-900 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-brand-500">
        <span>Open full character chart</span>
        <span class="text-brand-500 transition-transform group-open:rotate-180" aria-hidden="true">⌄</span>
      </summary>
      <div class="border-t border-brand-200 p-4">
        <FrakturCharacterGuide />
      </div>
    </details>
  </section>
</template>
