<script setup>
import { ref } from 'vue'

const isCollapsed = ref(true)
const toggleSidebar = () => {
  isCollapsed.value = !isCollapsed.value
}
</script> 

<template>
  <div class="flex h-screen h-dvh w-full overflow-hidden bg-gray-100">
    <!-- Sidebar Container -->
    <aside 
      :class="isCollapsed ? 'w-20' : 'w-64'" 
      class="bg-brand-900 text-white transition-all duration-300 ease-in-out flex flex-col"
    >
      <!-- Header / Toggle -->
      <div class="p-4 flex justify-between items-center border-b border-brand-700">
        <!-- <span v-if="!isCollapsed" class="font-bold text-lg">Mimir</span> -->
        <button @click="toggleSidebar" class="p-1 hover:bg-brand-800 rounded">
          <img v-if="isCollapsed" src="/images/Mimir-dark-no-text.svg" alt="Expand" class="w-12 h-8">
          <img v-else src="/images/Mimir-dark.svg" alt="Collapse" class="w-12 h-8">
        </button>
      </div>

      <!-- Navigation Links -->
      <nav class="flex-1 p-2 space-y-2">
        <router-link to="/" class="flex items-center space-x-4 p-3 rounded hover:bg-brand-800">
          <span>🏠</span>
          <span v-if="!isCollapsed">Dashboard</span>
        </router-link>
        <router-link to="/settings" class="flex items-center space-x-4 p-3 rounded hover:bg-brand-800">
          <span>⚙️</span>
          <span v-if="!isCollapsed">Settings</span>
        </router-link>
      </nav>
    </aside>

    <!-- Main Content Area -->
    <main class="flex-1 min-h-0 overflow-hidden p-8">
      <router-view />
    </main>
  </div>
</template>
