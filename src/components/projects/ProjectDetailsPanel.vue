<script setup>
defineProps({
  project: { type: Object, default: null },
  renameInput: { type: String, default: '' },
  renameError: { type: String, default: '' },
  isRenaming: { type: Boolean, default: false },
  selectedPdf: { type: Object, default: null },
  activePdfDisplayName: { type: String, default: '' },
})

const emit = defineEmits([
  'update:rename-input',
  'pdf-selected',
])

const selectedPdfInputId = 'project-upload-pdf-input'

function onRenameInput(event) {
  emit('update:rename-input', event.target.value)
}

function onPdfSelected(event) {
  emit('pdf-selected', event)
}
</script>

<template>
  <div>
    <h2 class="text-lg font-semibold">Project Details</h2>

    <div class="mt-4 flex flex-col gap-2 sm:flex-row sm:items-end">
      <div class="flex-1">
        <label class="block text-sm font-medium text-brand-700">Project Name</label>
        <input
          :value="renameInput"
          type="text"
          class="mt-1 w-full rounded border border-brand-300 px-3 py-2 text-sm"
          @input="onRenameInput"
        />
      </div>
    </div>
    <p v-if="isRenaming" class="mt-2 text-xs text-brand-500">Saving name...</p>
    <p v-if="renameError" class="mt-2 text-sm text-red-600">{{ renameError }}</p>

    <div class="mt-5 border-t border-brand-100 pt-4">
      <label
        :for="selectedPdfInputId"
        class="block cursor-pointer rounded border border-dashed border-brand-300 bg-brand-50/50 px-3 py-3 hover:bg-brand-100/50"
      >
        <div class="min-w-0">
          <p class="text-xs font-medium uppercase tracking-wide text-brand-500">PDF File</p>
          <p class="mt-1 truncate text-sm text-brand-800">
            {{ activePdfDisplayName || 'Click to select a PDF file' }}
          </p>
        </div>
      </label>

      <input
        :id="selectedPdfInputId"
        type="file"
        accept=".pdf, application/pdf"
        class="hidden"
        @change="onPdfSelected"
      />

      <p v-if="project?.source_pdf_name && !selectedPdf" class="mt-2 text-xs text-brand-500">
        Showing previously uploaded file for this project.
      </p>
    </div>
  </div>
</template>
