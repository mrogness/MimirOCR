<script setup>
import { useRoute, useRouter } from 'vue-router'

const route = useRoute()
const router = useRouter()
</script>

<template>
    <div class="settings-page h-full min-h-0 space-y-2 overflow-y-auto pr-1">
      <div class="rounded border-b-2 border-brand-200 border-brand-200">
        <header class="pb-2">
            <h1 class="text-2xl font-bold">Info</h1>
            <p class="text-sm text-brand-500">Information and tips for MimirOCR.</p>
        </header>
      </div>
        <section class="rounded p-2 text-brand-600">
            <p class="font-semibold">Table of Contents</p>
            <ul class="mt-2 space-y-1 text-sm">
                <li></li>
                <li></li>
                <li></li>
                <li></li>
            </ul>
        </section>
    </div>
    
</template>