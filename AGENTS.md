# Repository Guidelines

This repository contains the Vindhem specification and its static reader, not
a music-server implementation.

- Canonical documents live in `spec/`, `openapi/`, and `schema/`.
- Preserve released specification tags. Reader changes do not change the API
  edition or imply that an implementation supports it.
- Keep operation, schema and wire-format identifiers stable unless deliberately
  revising the contract.
- `page/` contains reader source and generic build/verification tools.
- `site/` is generated. Commit source changes before running
  `npm run page:bundle`, then commit the generated files separately.
- Use `npm run check` for document checks, `npm run page:check` for reader checks
  in Google Chrome, and `npm run page:verify` for the prepared static files.
- Keep documentation relevant to users and contributors. Do not add personal
  deployment details, coordination notes, task handoffs or local workspace paths.
- Keep credentials, application data and local settings out of version control.
- Publishing, changing repository visibility, moving release tags or choosing
  a license requires explicit maintainer approval.
