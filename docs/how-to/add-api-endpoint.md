# Add or change an API endpoint

Use this guide when a UI feature needs a new local HTTP operation. Start by finding
the owning package in [backend organization](../architecture/backend-organization.md).
For example, a project metadata read belongs in `backend/api/routes/projects.py`.

## Define the boundary before the handler

Add request and response Pydantic models to `backend/api/schemas.py`. Document field
meaning, units, defaults, nullability, and constraints with docstrings and
`Field(description=...)` where useful. An HTTP response model is distinct from a
SQLAlchemy row and from a `Page`/`Line` serialized to a worker.

For example, a project metadata read should reuse the existing project ID and
return a named response model. Decide whether a missing project is 404 and which
fields the frontend actually needs. Avoid returning the complete ORM object when
only a small public contract is required.

## Keep ownership clear

Put HTTP validation and error translation in the route. Reuse `Depends(get_db)`
for database sessions, repository functions for persistence, and services for
job orchestration. Keep Kraken and Calamari imports inside their worker packages.
An endpoint should not load a model in the API process.

For a new route module, register its router in `backend/api/router.py`; adding a
function to an existing registered router needs no additional registration.
Supply `response_model`, success `status_code`, a meaningful summary/docstring,
and `responses={...}` metadata for known runtime errors. FastAPI automatically
documents validation errors but does not discover every raised `HTTPException`.

## Connect and verify

Call the route through `backendFetch` in `src/shared/services/backend.js`.
Check `response.ok` before consuming success data: this helper returns HTTP error
responses and retries transport failures, rather than converting all errors to
exceptions. Put the workflow in the owning composable.

Extend the matching `backend/tests/test_*_routes.py` suite. Verify the successful
response, missing IDs, invalid bodies, and relevant persistence or job side effects
using the existing isolated database fixtures. Add a frontend workflow test when
the UI behavior changes. For project routes:

```sh
python scripts/setup_backend.py --role backend --dev --docs
node scripts/run_backend.mjs -m pytest backend/tests/test_project_routes.py
yarn docs:generate
yarn docs:build
```

Review the generated HTTP page and raw OpenAPI diff, then commit `docs/generated/`
changes with the source. Source-reference pages update during the build. If you
change an existing error contract, update [HTTP behavior](../reference/http-behavior.md)
and the affected client tests as well.
