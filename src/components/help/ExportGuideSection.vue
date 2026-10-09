<template>
  <section id="exporting" class="scroll-mt-6 space-y-5" aria-labelledby="exporting-title">
    <header>
      <p class="text-xs font-semibold uppercase tracking-wide text-brand-500">Finishing a project</p>
      <h2 id="exporting-title" class="mt-1 text-xl font-semibold text-brand-900">
        Choose an export for its intended use
      </h2>
      <p class="mt-2 max-w-3xl text-sm leading-6 text-brand-600">
        Export settings do not change the corrected transcription stored in the project, so you can create more than one
        version for different audiences.
      </p>
    </header>

    <div class="grid gap-4 md:grid-cols-2">
      <div class="rounded border border-brand-200 bg-white p-5">
        <h3 class="font-semibold text-brand-900">For verification</h3>
        <p class="mt-2 text-sm leading-6 text-brand-600">
          Use Preserve line layout with automatic fitting when you need to compare the scan and transcription page by
          page and line by line.
        </p>
        <RouterLink :to="{ name: 'info', hash: '#preserve-line-layout' }"
          class="mt-3 inline-block text-sm font-medium text-brand-700 underline underline-offset-2 hover:text-brand-900">
          Preserve-layout details
        </RouterLink>
      </div>

      <div class="rounded border border-brand-200 bg-white p-5">
        <h3 class="font-semibold text-brand-900">For reading</h3>
        <p class="mt-2 text-sm leading-6 text-brand-600">
          Use Reflow for reading when natural paragraphs matter more than preserving historical line breaks and page
          correspondence.
        </p>
        <RouterLink :to="{ name: 'info', hash: '#reflow-for-reading' }"
          class="mt-3 inline-block text-sm font-medium text-brand-700 underline underline-offset-2 hover:text-brand-900">
          Reading-layout details
        </RouterLink>
      </div>
    </div>

    <div class="rounded border border-brand-200 bg-brand-50/60 p-5">
      <h3 class="font-semibold text-brand-900">Before selecting Export PDF</h3>
      <ul class="mt-3 grid gap-2 text-sm leading-6 text-brand-700 sm:grid-cols-2">
        <li>• Check page and line order.</li>
        <li>• Review remaining suspicious characters.</li>
        <li>• Choose a layout for verification or reading.</li>
        <li>• Confirm modernization and paper settings.</li>
      </ul>
    </div>
  </section>
</template>
