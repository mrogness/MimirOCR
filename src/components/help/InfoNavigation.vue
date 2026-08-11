<script setup>
const sections = [
  { hash: '#getting-started', label: 'Start Here' },
  { hash: '#reviewing-output', label: 'Reviewing Output' },
  { hash: '#fraktur-reference', label: 'Fraktur Reference' },
  { hash: '#settings-reference', label: 'Settings Reference' },
  { hash: '#exporting', label: 'Exporting' },
  { hash: '#acknowledgements', label: 'Acknowledgements' },
]
</script>

<template>
  <aside class="rounded border border-brand-200 bg-white p-4">
    <p class="text-xs font-semibold uppercase tracking-wide text-brand-500">
      On this page
    </p>
    <nav class="mt-3 grid grid-cols-2 gap-1 sm:grid-cols-3 xl:grid-cols-1" aria-label="Help sections">
      <RouterLink v-for="section in sections" :key="section.hash" :to="{ name: 'info', hash: section.hash }"
        class="rounded px-3 py-2 text-sm font-medium text-brand-700 hover:bg-brand-100 hover:text-brand-900 focus:outline-none focus:ring-2 focus:ring-brand-500">
        {{ section.label }}
      </RouterLink>
    </nav>
  </aside>
</template>
