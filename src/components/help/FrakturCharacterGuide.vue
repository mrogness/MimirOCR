<script setup>
import { ref } from 'vue'
import AppHelp from './AppHelp.vue'

const selectedFont = ref('fraktur')

const fontOptions = [
  { value: 'default', label: 'Latin' },
  { value: 'fraktur', label: 'Fraktur' },
]

const uppercase = [...'ABCDEFGHIJKLMNOPQRSTUVWXYZÆØ,;?']
const lowercase = [...'abcdefghijklmnopqrstuvwxyzæø.:!']

const characterPairs = uppercase.map((upper, index) => ({
  upper,
  lower: lowercase[index],
}))

const historicalForms = [
  {
    character: 'ſ',
    label: 'Long s',
  },
  {
    character: '„',
    label: 'Low double quote',
  },
  {
    character: '⸗',
    label: 'Double oblique hyphen',
    
  },
]
</script>

<template>
  <section class="space-y-5 rounded border border-brand-200 bg-white p-5" aria-labelledby="fraktur-guide-title">
    <header class="flex flex-wrap items-start justify-between gap-4">
      <div>
        <div class="flex items-center gap-2">
          <h2 id="fraktur-guide-title" class="text-lg font-semibold text-brand-900">
            Fraktur character guide

          </h2>
           <AppHelp label="About processing performance" title="Processing performance"
              intro="Note that Fraktur is not one font, but a family of typefaces. The Fraktur characters shown here are an example of common Fraktur forms from the 19th Century.">
            </AppHelp>
        </div>
        <p class="mt-1 text-sm text-brand-500">
          Compare familiar Latin characters with their Fraktur forms.
        </p>
      </div>

      <div class="inline-flex rounded border border-brand-300 bg-brand-50 p-1" role="group"
        aria-label="Character display font">
        <button v-for="option in fontOptions" :key="option.value" type="button"
          class="rounded px-3 py-1.5 text-sm font-medium transition-colors" :class="selectedFont === option.value
              ? 'bg-brand-900 text-white shadow-sm'
              : 'text-brand-600 hover:bg-white hover:text-brand-900'
            " :aria-pressed="selectedFont === option.value" @click="selectedFont = option.value">
          {{ option.label }}
        </button>
      </div>
    </header>

    <ul class="grid grid-cols-3 gap-2 sm:grid-cols-5 md:grid-cols-7 xl:grid-cols-10" aria-label="Fraktur alphabet">
      <li v-for="pair in characterPairs" :key="pair.upper"
        class="rounded border border-brand-200 bg-brand-50/50 px-2 py-3 text-center">
        <div class="flex min-h-6 items-center justify-center gap-2 text-3xl leading-none text-brand-900"
          :class="selectedFont === 'fraktur' ? 'font-fraktur' : 'font-sans'">
          <span>{{ pair.upper }}</span>
          <span>{{ pair.lower }}</span>
          <span v-if="pair.upper === 'S' && selectedFont === 'fraktur'">{{ 'ſ' }}</span>

        </div>

        <p class="mt-2 font-sans text-xs font-medium text-brand-500">
          {{ pair.upper }} · {{ pair.lower }}
        </p>
      </li>
    </ul>

    <div class="border-t border-brand-200 pt-4">
      <h3 class="text-sm font-semibold text-brand-800">
        Historical forms and symbols
      </h3>

      <div class="mt-3 flex flex-wrap gap-2">
        <div v-for="form in historicalForms" :key="form.character"
          class="flex min-w-32 items-center gap-3 rounded border border-brand-200 bg-brand-50/50 px-3 py-2">
          <span class="w-8 text-center text-3xl leading-none text-brand-900"
            :class="selectedFont === 'fraktur' ? 'font-fraktur' : 'font-sans'">
            {{ form.character }}
          </span>

          <span class="font-sans text-xs font-medium text-brand-600">
            {{ form.label }}
          </span>
        </div>
      </div>
    </div>

  </section>
</template>