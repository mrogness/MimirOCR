<script setup>
import { ref } from 'vue'

const confusionGroups = [
  {
    id: 'reader',
    title: 'Often confused by readers',
    description: 'These printed forms can look alike when learning to read Fraktur.',
    pairs: [
      ['d', 'v'],
      ['f', 'ſ'],
      ['h', 'y'],
      ['i', 'j'],
      ['k', 'l'],
      ['m', 'w'],
      ['r', 'x'],
      ['v', 'y'],
      ['B', 'V'],
      ['C', 'E'],
      ['N', 'R'],
    ],
  },
  {
    id: 'ocr',
    title: 'Frequently confused by MimirOCR',
    description: 'Prediction issues around these characters often arise due to printing and scanning artifacts (ink bleed or paper damage, etc.), that distort distinguishing features.',
    pairs: [
      ['a', 'o'],
      ['e', 'c'],
      ['n', 'u'],
    ],
  },
]

const showingSecondCharacter = ref({})

function pairKey(groupId, pair) {
  return `${groupId}-${pair[0]}-${pair[1]}`
}

function isShowingSecond(groupId, pair) {
  return Boolean(showingSecondCharacter.value[pairKey(groupId, pair)])
}

function togglePair(groupId, pair) {
  const key = pairKey(groupId, pair)
  showingSecondCharacter.value = {
    ...showingSecondCharacter.value,
    [key]: !showingSecondCharacter.value[key],
  }
}
</script>

<template>
  <section class="space-y-5 rounded border border-brand-200 bg-white p-5"
    aria-labelledby="fraktur-confusables-title">
    <header>
      <h3 id="fraktur-confusables-title" class="text-lg font-semibold text-brand-900">
        Commonly Confused Characters
      </h3>
      <p class="mt-1 text-sm text-brand-500">
        Select a card to switch between two visually similar Fraktur characters.
      </p>
    </header>

    <div v-for="group in confusionGroups" :key="group.id" class="space-y-3">
      <div>
        <h4 class="text-sm font-semibold text-brand-800">{{ group.title }}</h4>
        <p class="mt-1 text-xs text-brand-500">{{ group.description }}</p>
      </div>

      <ul class="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-6" :aria-label="group.title">
        <li v-for="pair in group.pairs" :key="pairKey(group.id, pair)">
          <button type="button"
            class="relative flex min-h-36 w-full cursor-pointer select-none flex-col items-center justify-between rounded border border-brand-200 bg-brand-50/50 px-4 pb-4 text-center transition-colors hover:border-brand-400 hover:bg-brand-50 focus:outline-none focus:ring-2 focus:ring-brand-500"
            :aria-label="`Showing ${isShowingSecond(group.id, pair) ? pair[1] : pair[0]}. Select to show ${isShowingSecond(group.id, pair) ? pair[0] : pair[1]}.`"
            :aria-pressed="isShowingSecond(group.id, pair)" @click="togglePair(group.id, pair)">
            <span class="isolate relative flex h-26 w-full items-center justify-center">
              <Transition name="crossfade">
                <span :key="isShowingSecond(group.id, pair)"
                  class="absolute inset-x-0 top-4 flex items-center justify-center font-fraktur text-8xl leading-none text-brand-900">
                  {{ pair[isShowingSecond(group.id, pair) ? 1 : 0] }}
                </span>
              </Transition>
            </span>

            <span class="mt-2 font-sans text-base font-medium text-brand-500">
              <strong v-if="!isShowingSecond(group.id, pair)" class="text-brand-900">{{ pair[0] }}</strong>
              <template v-else>{{ pair[0] }}</template>
              ·
              <strong v-if="isShowingSecond(group.id, pair)" class="text-brand-900">{{ pair[1] }}</strong>
              <template v-else>{{ pair[1] }}</template>
            </span>
          </button>
        </li>
      </ul>
    </div>
  </section>
</template>
