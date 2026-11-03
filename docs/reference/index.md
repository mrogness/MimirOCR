# Source code reference

Browse **Backend** for Python modules, classes, models, functions, and methods.
Browse **Frontend** for JavaScript services and composables, Vue components,
their props/events/slots, and named functions inside component scripts.
Pages follow source directories and contain symbol inventories and source links.
Internal helpers and frontend state are grouped in expandable sections.

Every production `.py`, `.js`, and `.vue` file is discovered at build time,
including files without documentation comments. Tests, model assets, caches,
dependencies, and build output are excluded. Missing descriptions are labelled;
signatures remain available while comments are improved. GitHub links point to
the build commit for clean checkouts; modified checkouts show local source paths.

Python reference extraction parses source without importing application or ML
modules. Frontend extraction also parses source without running Vue or Tauri.
The separate [HTTP API summary](../generated/backend-openapi.md) describes the
backend routes rather than the source interfaces documented here.

## Maintain descriptions in the source

- Python: module, class, and function docstrings. Use Google-style `Args`,
  `Returns`, and `Raises` sections where these explain an interface.
- JavaScript: `/** @file ... */` module descriptions and JSDoc comments above
  functions, with dependency fields in `@param`, `@returns`, `@throws`, and
  `@example` when useful. Document ref ownership and teardown for composables.
- Vue: JSDoc inside `<script setup>`, comments above props, and comments describing
  emitted events and slots. Named script functions are included even without
  `@public`; component interface metadata is extracted separately.
  Template-only component modules can use a top-level
  `<!-- @file Component description. -->` comment.

Generated pages and their navigation are recreated on every `yarn docs:build`
or `yarn docs:serve` build. Add or rename a source file and its reference follows
automatically. Edit descriptions in the source, not the generated HTML.

Use the [composable guide](../how-to/change-composable.md) for a concrete dependency,
returned-member, and lifecycle contract. [HTTP behavior](http-behavior.md) explains
how HTTP errors, persistence, and downloads relate to the generated schemas.
