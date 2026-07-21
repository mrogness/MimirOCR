<script setup>
import { useRouter } from 'vue-router'

import { useDefaultView } from '../composables/views/useDefaultView'
import { backendFetch, getBackendStartupIssue } from '../services/backend'

const router = useRouter()

const {
  projects,
  isLoading,
  isCreating,
  deletingProjectId,
  errorMessage,
  backendStartupIssue,
  isBackendWarmingUp,
  backendWarmupMessage,
  pendingDeleteProjectId,
  isDeleteModalOpen,
  showCreateModal,
  newProjectName,
  createError,
  hasProjects,
  pendingDeleteProjectName,
  formatDate,
  openCreateModal,
  closeCreateModal,
  createProjectAndGo,
  openProject,
  requestDeleteProject,
  closeDeleteModal,
  confirmDeleteProject,
} = useDefaultView({
  router,
  backendFetch,
  getBackendStartupIssue,
})
</script>

<template>
  <div class="default-page space-y-6">
    <section v-if="backendStartupIssue" class="rounded border border-amber-300 bg-amber-50 p-4 text-amber-900">
      <p class="font-semibold">Backend startup warning</p>
      <p class="mt-1 text-sm">{{ backendStartupIssue }}</p>
    </section>

    <section class="flex items-center justify-between">
      <div>
        <h1 class="text-2xl font-bold">Projects Dashboard</h1>
        <p class="text-sm text-brand-500">Create a project, then jump into the OCR workspace.</p>
      </div>

      <button
        class="rounded bg-brand-900 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700"
        @click="openCreateModal"
      >
        Add Project
      </button>
    </section>

    <section v-if="isLoading" class="rounded border border-brand-200 bg-white p-4 text-brand-600">
      <p>Loading projects...</p>
      <p v-if="isBackendWarmingUp" class="mt-2 text-sm text-brand-500">
        {{ backendWarmupMessage || 'Backend is starting up...' }}
      </p>
    </section>

    <section v-else-if="errorMessage" class="rounded border border-red-200 bg-red-50 p-4 text-red-700">
      {{ errorMessage }}
    </section>

    <section v-else-if="!hasProjects" class="rounded border border-brand-200 bg-white p-6 text-brand-600">
      No projects yet. Create your first project to begin OCR processing.
    </section>

    <section v-else class="overflow-hidden rounded border border-brand-200 bg-white">
      <table class="min-w-full divide-y divide-brand-200">
        <thead class="bg-brand-50 text-left text-xs uppercase tracking-wide text-brand-500">
          <tr>
            <th class="px-4 py-3">Project Name</th>
            <th class="px-4 py-3">Created</th>
            <th class="px-4 py-3">Modified</th>
            <th class="px-4 py-3 text-right">Action</th>
          </tr>
        </thead>

        <tbody class="divide-y divide-brand-100 text-sm">
          <tr
            v-for="project in projects"
            :key="project.id"
            class="cursor-pointer hover:bg-brand-50"
            @click="openProject(project.id)"
          >
            <td class="px-4 py-3">{{ project.name }}</td>
            <td class="px-4 py-3">{{ formatDate(project.date_created) }}</td>
            <td class="px-4 py-3">{{ formatDate(project.date_modified) }}</td>
            <td class="px-4 py-3 text-right">
              <div class="inline-flex items-center gap-2">
                <button
                  class="rounded border border-red-300 px-3 py-1 text-xs font-semibold text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
                  :disabled="deletingProjectId === project.id"
                  @click.stop="requestDeleteProject(project.id)"
                >
                  {{ deletingProjectId === project.id ? 'Deleting...' : 'Delete' }}
                </button>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </section>

    <div v-if="showCreateModal" class="fixed inset-0 z-50 flex items-center justify-center bg-brand-900/40 p-4">
      <div class="w-full max-w-md rounded-xl bg-white p-6 shadow-xl">
        <h2 class="text-xl font-semibold">Create New Project</h2>
        <p class="mt-1 text-sm text-brand-500">Name the project before entering the workspace.</p>

        <label class="mt-4 block text-sm font-medium text-brand-700" for="project-name-input">Project Name</label>
        <input
          id="project-name-input"
          v-model="newProjectName"
          type="text"
          class="mt-2 w-full rounded border border-brand-300 px-3 py-2 text-sm"
          placeholder="Example: 1912 Newspaper Batch"
          @keyup.enter="createProjectAndGo"
        />

        <p v-if="createError" class="mt-2 text-sm text-red-600">{{ createError }}</p>

        <div class="mt-6 flex justify-end gap-2">
          <button class="rounded border border-brand-300 px-3 py-2 text-sm" @click="closeCreateModal">Cancel</button>
          <button
            class="rounded bg-brand-900 px-3 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
            :disabled="isCreating"
            @click="createProjectAndGo"
          >
            {{ isCreating ? 'Creating...' : 'Create and Open' }}
          </button>
        </div>
      </div>
    </div>

    <div v-if="isDeleteModalOpen" class="fixed inset-0 z-50 flex items-center justify-center bg-brand-900/40 p-4">
      <div class="w-full max-w-md rounded-xl bg-white p-6 shadow-xl">
        <h2 class="text-xl font-semibold text-red-700">Delete Project</h2>
        <p class="mt-2 text-sm text-brand-700">
          Delete
          <strong v-if="pendingDeleteProjectName">{{ pendingDeleteProjectName }}</strong>
          <span v-else>this project</span>
          and all associated OCR data?
        </p>

        <div class="mt-6 flex justify-end gap-2">
          <button class="rounded border border-brand-300 px-3 py-2 text-sm" @click="closeDeleteModal">Cancel</button>
          <button
            class="rounded bg-red-700 px-3 py-2 text-sm font-semibold text-white hover:bg-red-800 disabled:cursor-not-allowed disabled:opacity-50"
            :disabled="deletingProjectId === pendingDeleteProjectId"
            @click="confirmDeleteProject"
          >
            {{ deletingProjectId === pendingDeleteProjectId ? 'Deleting...' : 'Delete Project' }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
