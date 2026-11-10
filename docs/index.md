# MimirOCR Contributor Documentation

This is meant to serve as documentation about the technical specifications that make up MimirOCR. 

## Documentation goals

- Provide clarity on structure for backend, frontend, and Tauri contributors.
- Explain process-boundary behavior explicitly.
- Keep docs updated through CI generation + validation where possible.

## Where to start

- Follow [one document through the app](tutorials/first-ocr-run.md), from upload
  through workers and persistence to correction/export.
- Make a focused change with the [API](how-to/add-api-endpoint.md),
  [composable](how-to/change-composable.md), or [worker](how-to/change-worker-payload.md) guide.
- Resolve setup/runtime problems with [Troubleshooting](how-to/troubleshooting.md).

- Browse functions, classes, and Vue components in the automatically generated
  [source code reference](reference/index.md).
- New contributors: see [Contributing](contributing.md).
- Runtime model and process boundaries: see
  [Architecture](architecture/system-overview.md).
- Worker payload and behavior requirements: see [Contracts](contracts/ocr-worker-contract.md).
- Frontend feature ownership and source paths: see
  [Frontend Code Organization](architecture/frontend-organization.md).
- Test strategy and quality gates: see [Testing Guide](testing.md).

The [HTTP reference](generated/backend-openapi.md) lists request/response schemas;
[HTTP behavior and errors](reference/http-behavior.md) explains application failures
and downloads. The build label below identifies the source used for this site.
