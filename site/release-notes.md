# Vindhem Specification 0.1.2

Editorial update to 0.1.1. API behavior, operation identifiers and data shapes
are unchanged.

- Standardize the name Vindhem Specification and distinguish the specification
  from a server implementation.
- Clarify that Portable Library v1 and Portable Music Library version 1 name
  the same format. Its JSON Schema is unchanged.
- Clarify ID encoding, schema URIs, error status/code presentation and
  cross-document references.
- Preserve the exact identifiers `CoreBearer`, `CoreError` and
  `vindhem-music-library-core`; descriptive labels do not rename contract values.
- Distinguish specification downloads from a running server's discovery routes.
- Declare Apache-2.0 licensing in the OpenAPI metadata and include the licence
  in the specification reader bundle.

The contract retains 79 operations on `/api/v2` and 188 schema definitions.
