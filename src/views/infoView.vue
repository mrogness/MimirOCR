<script setup>
import { useRoute, useRouter } from 'vue-router';
import FrakturChart from '../components/help/FrakturChart.vue'

const route = useRoute()
const router = useRouter()

</script>

<template>
    <div class="settings-page min-h-0 overflow-y-auto pr-1">
      <div class="rounded border-b-2 border-brand-200">
        <header class="pb-2">
            <h1 class="text-2xl font-bold">Info</h1>
            <p class="text-sm text-brand-500">Information and tips for MimirOCR.</p>
        </header>
      </div>
    </div>
    <section class="rounded p-2 text-5x-l text-brand-600">
        <FrakturChart />
    </section>
    
</template>