<script setup>
const settingsGroups = [
  {
    id: 'application-settings',
    title: 'Application settings',
    description: 'Global performance and appearance options.',
    items: [
      {
        id: 'processing-performance',
        title: 'Processing Performance',
        what: 'Controls how much rasterization, segmentation, and OCR work MimirOCR runs in parallel.',
        when: 'Use Balanced for normal work, Cool when heat use matters or when performance is limited, and Fast on systems with sufficient power and cooling.',
        note: 'Changing profiles restarts the local backend and is disabled while an OCR run is active.',
      },
      {
        id: 'appearance',
        title: 'Appearance',
        what: 'Changes the application color theme.',
        when: 'Choose whichever theme is most comfortable and readable for you.',
        note: 'Appearance has no effect on OCR accuracy or processing performance.',
      },
    ],
  },
  {
    id: 'ocr-settings',
    title: 'OCR settings',
    description: 'Options that affect how the selected PDF is prepared and interpreted.',
    defaultOpen: true,
    items: [
      {
        id: 'processing-dpi',
        title: 'Processing DPI',
        what: 'Sets the resolution used when input PDF pages are rasterized for segmentation and OCR.',
        when: 'Start with the detected recommendation. Increase it only when the source scan contains additional usable detail.',
        note: 'A value above the original scan resolution increases processing time without recovering detail that is not present.',
      },
      {
        id: 'binarization-threshold',
        title: 'Binarization Threshold',
        what: 'Controls which grayscale pixels become black or white in the line images sent to OCR. Must be between 0 and 256.',
        when: 'Use the preview to retain character strokes while excluding paper texture, stains, and other noise.',
        note: 'Binarization is applied to extracted line images during OCR rather than permanently changing the source PDF.',
      },
      {
        id: 'page-layout',
        title: 'Page Layout',
        what: 'Identifies whether each PDF page contains one physical page or a left/right spread.',
        when: 'Select Split Left/Right Spread for scans containing two facing pages; otherwise choose Single Page Per Scan.',
        note: 'This can be corrected after processing because it primarily affects page organization and export layout.',
      },
      {
        id: 'strict-line-sorting',
        title: 'Strict top-to-bottom line sorting',
        what: 'Orders lines by vertical position within each detected text region instead of relying on segmentation ordering.',
        when: 'Try it when the default ordering is visibly inconsistent on a regularly structured page.',
        note: 'For a two-page spread, regions are still processed from the left page to the right page. This setting is most useful when normal ordering has been attempted with limited results.',
      },
      {
        id: 'i-j-disambiguation',
        title: 'Resolve Fraktur I/J from Lexicon',
        what: 'Uses a small Dano-Norwegian lexicon to change likely capital J words that the model initially predicts with I.',
        when: 'Leave it enabled for most documents, then verify names and uncommon words during review.',
        note: 'This is a heuristic. Identical printed I/J forms cannot always be resolved without broader context.',
      },
    ],
  },
  {
    id: 'review-settings',
    title: 'Output review settings',
    description: 'Controls for comparing OCR predictions with the scanned page.',
    items: [
      {
        id: 'polygon-overlay',
        title: 'Use raw polygon overlay',
        what: 'Shows the line shapes returned by the segmentation engine instead of rectangular approximations.',
        when: 'Use polygons for the closest view of detected geometry and rectangles when simpler overlays are easier to follow.',
        note: 'Changing the overlay only affects the review display; it does not rerun OCR.',
      },
      {
        id: 'suspicious-characters',
        title: 'Flag suspicious characters',
        what: 'Highlights predictions whose confidence falls below the selected threshold.',
        when: 'Raise the threshold for a thorough pass or lower it when too many correct characters are being flagged.',
        note: 'Confidence is not certainty. Always compare a flagged character with the source image.',
      },
    ],
  },
  {
    id: 'export-settings',
    title: 'Export settings',
    description: 'Controls for turning corrected text into a new PDF.',
    items: [
      {
        id: 'preserve-line-layout',
        title: 'Preserve line layout',
        what: 'Keeps OCR lines and approximate indentation associated with their source pages.',
        when: 'Choose it for side-by-side verification or when correspondence with the scan matters most.',
        note: 'Automatic text fitting is recommended when every source page must remain on one corresponding output page.',
      },
      {
        id: 'automatic-text-fitting',
        title: 'Automatically fit text to each page',
        what: 'Reduces text size as needed when preserved lines would exceed the available page area.',
        when: 'Leave it enabled for comparison PDFs; the selected size becomes a preferred rather than guaranteed size.',
        note: 'Disabling fitting can cause content beyond the available page area to be omitted from the exported PDF.',
      },
      {
        id: 'reflow-for-reading',
        title: 'Reflow for reading',
        what: 'Combines OCR lines into paragraphs that flow naturally across output pages.',
        when: 'Choose it for casual reading when matching source line breaks is not important.',
        note: 'Reflow is easier to read but harder to compare line by line with the scanned document.',
      },
      {
        id: 'join-split-words',
        title: 'Join words split across lines',
        what: 'Reconnects words divided at historical line breaks using a double oblique hyphen.',
        when: 'Enable it for reading-layout exports after verifying that the marked line breaks represent split words.',
        note: 'Words or sentences split across separate input pages are not automatically reconstructed.',
      },
      {
        id: 'document-formatting',
        title: 'Document formatting',
        what: 'Sets the export font, preferred text size, line spacing, paper size, and margins.',
        when: 'Adjust these for the intended reading environment after choosing an export layout.',
        note: 'In preserve-layout mode, automatic fitting may reduce the chosen text size on crowded pages.',
      },
      {
        id: 'text-modernization',
        title: 'Text modernization',
        what: 'Can convert long s, low double quotes, and double oblique hyphens to modern equivalents.',
        when: 'Enable only the transformations appropriate for the exported copy you want to create.',
        note: 'Modernization is applied during export and does not replace the corrected transcription stored in the project.',
      },
    ],
  },
]
</script>

<template>
  <section id="settings-reference" class="scroll-mt-6 space-y-5" aria-labelledby="settings-reference-title">
    <header>
      <p class="text-xs font-semibold uppercase tracking-wide text-brand-500">Reference</p>
      <h2 id="settings-reference-title" class="mt-1 text-xl font-semibold text-brand-900">
        Settings reference
      </h2>
      <p class="mt-2 max-w-3xl text-sm leading-6 text-brand-600">
        Open a category for a concise explanation of what each setting changes, when to adjust it, and what tradeoff to
        expect.
      </p>
    </header>

    <div class="space-y-3">
      <details v-for="group in settingsGroups" :id="group.id" :key="group.id" :open="group.defaultOpen"
        class="group scroll-mt-6 rounded border border-brand-200 bg-white">
        <summary
          class="flex cursor-pointer list-none items-center justify-between gap-3 px-5 py-4 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-brand-500">
          <span>
            <span class="block font-semibold text-brand-900">{{ group.title }}</span>
            <span class="mt-1 block text-sm font-normal text-brand-500">{{ group.description }}</span>
          </span>
          <span class="text-brand-500 transition-transform group-open:rotate-180" aria-hidden="true">⌄</span>
        </summary>

        <div class="divide-y divide-brand-100 border-t border-brand-200 px-5">
          <article v-for="item in group.items" :id="item.id" :key="item.id" class="scroll-mt-6 py-5">
            <h3 class="font-semibold text-brand-900">{{ item.title }}</h3>
            <dl class="mt-3 grid gap-3 text-sm leading-6 text-brand-600">
              <div>
                <dt class="font-medium text-brand-800">What it changes</dt>
                <dd>{{ item.what }}</dd>
              </div>
              <div>
                <dt class="font-medium text-brand-800">When to adjust it</dt>
                <dd>{{ item.when }}</dd>
              </div>
              <div class="rounded bg-brand-50 px-3 py-2">
                <dt class="font-medium text-brand-800">Keep in mind</dt>
                <dd>{{ item.note }}</dd>
              </div>
            </dl>
          </article>
        </div>
      </details>
    </div>
  </section>
</template>
