<script setup>
import { useAppVersion } from '../../composables/settings/useAppVersion'

const { appVersion } = useAppVersion()
</script>

<template>
  <section id="acknowledgements" class="scroll-mt-6 space-y-5" aria-labelledby="acknowledgements-title">
    <header>
      <p class="text-xs font-semibold uppercase tracking-wide text-brand-500">About</p>
      <h2 id="acknowledgements-title" class="mt-1 text-xl font-semibold text-brand-900">
        Acknowledgements
      </h2>
    </header>

    <div class="rounded border border-brand-200 bg-white p-5 text-sm leading-6 text-brand-600">
      <p>
        MimirOCR was created by Matthew Rogness as a student research project through the Nordic Studies Department at
        Luther College in 2026. Training material included hand-transcribed Dano-Norwegian Fraktur texts held by Preus Library.
      </p>

      <dl class="mt-5 grid gap-4 sm:grid-cols-2">
        <div>
          <dt class="font-semibold text-brand-900">OCR Engine</dt>
          <dd>OCR is powered by a model trained with <a href="https://github.com/Calamari-OCR/calamari" target="_blank" rel="noopener noreferrer"
            class="font-semibold text-brand-600 underline underline-offset-2 hover:text-brand-600/70">
              Calamari OCR</a> and one of its included 19th-century Fraktur models adapted with Dano-Norwegian training data.</dd>
        </div>
        <div>
          <dt class="font-semibold text-brand-900">Segmentation Engine</dt>
          <dd>Segmentation is powered by <a href="https://github.com/mittagessen/kraken" target="_blank" rel="noopener noreferrer"
            class="font-semibold text-brand-600 underline underline-offset-2 hover:text-brand-600/70">
              Kraken's BLLA model</a>, used to identify text regions, reading order, and individual line images.</dd>
        </div>
        <div>
          <dt class="font-semibold text-brand-900">Reference typeface</dt>
          <dd>
            <a href="https://www.1001fonts.com/breitkopf-fraktur-font.html" target="_blank" rel="noopener noreferrer"
            class="font-semibold text-brand-600 underline underline-offset-2 hover:text-brand-600/70">
              Breitkopf Fraktur</a> 
            by 
            <a href="http://www.steffmann.de" target="_blank" rel="noopener noreferrer" 
            class="font-semibold text-brand-600 underline underline-offset-2 hover:text-brand-600/70">
              Dieter Steffmann,</a> 
            extended by <a href="https://www.peter-wiegel.de/index.html" target="_blank" rel="noopener noreferrer" 
            class="font-semibold text-brand-600 underline underline-offset-2 hover:text-brand-600/70">
              Peter Wiegel,</a>  used for the in-app Fraktur character examples.
          </dd>
        </div>
        <div>
          <dt class="font-semibold text-brand-900">Application</dt>
          <dd>
            MimirOCR<span v-if="appVersion !== 'unknown'"> v{{ appVersion }}</span>.<br>
            Copyright © 2026 Matthew Rogness.<br>
            Distributed under the GNU General Public License v3.
          </dd>
        </div>
      </dl>
    </div>
  </section>
</template>
