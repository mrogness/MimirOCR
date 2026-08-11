<script setup>
import { ref, Transition } from 'vue'
const props = defineProps({
  characterPair: {
    type: Array,
    validator: (value) => Array.isArray(value) && value.length === 2,
    required: true,
  },
})

const confusedCharPairs = [
  ['a', 'o'],
  ['d', 'v'],
  ['e', 'c'],
  ['f', 'ſ'],
  ['h', 'y'],
  ['m', 'w'],
  ['n', 'u'],
  ['r', 'x'],
  ['v', 'y'],
  ['B', 'V'],
  ['M', 'W'],
  ['N', 'R'],
]
const show = ref(true)
</script>

<template>
  <section class="space-y-5 rounded border border-brand-200 bg-white p-5" aria-labelledby="fraktur-guide-title">
    <header class="flex flex-wrap items-start justify-between gap-4">
      <div>
        <h2 id="fraktur-guide-title" class="text-lg font-semibold text-brand-900">
          Commonly Confused Characters
        </h2>
        <p class="mt-1 text-sm text-brand-500">
          Click to toggle between visually similar characters. These characters are easily confused for one another when
          written in Fraktur.
        </p>
      </div>
    </header>

    <ul class="grid grid-cols-3 gap-2 sm:grid-cols-5 md:grid-cols-7 xl:grid-cols-10" aria-label="Fraktur alphabet">
      <li v-for="pair in confusedCharPairs" :key="pair[0]" @click="show = !show"
        class="relative flex min-h-[9rem] flex-col items-center justify-between rounded border border-brand-200 bg-brand-50/50 px-4 pb-4 text-center cursor-pointer select-none">
        <div class="isolate relative w-full h-26 flex items-center justify-center">
          <Transition name="crossfade">
            <span :key="show"
              class="absolute inset-x-0 top-4 flex items-center justify-center font-fraktur text-8xl leading-none text-black">
              {{ pair[show ? 0 : 1] }}
            </span>
          </Transition>
        </div>
        <p v-if="show"
        class="mt-2 font-sans text-base font-medium text-brand-500">
          <strong class="text-black">{{ pair[0] }}</strong> · {{ pair[1] }}
        </p>
        <p v-else
        class="mt-2 font-sans text-base font-medium text-brand-500">
          {{ pair[0] }} · <strong class="text-black">{{ pair[1] }}</strong>
        </p>  
      </li>
    </ul>
  </section>
</template>
