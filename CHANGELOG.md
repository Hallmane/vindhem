# Release Notes

## 0.1.2

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

## 0.1.1

First independently maintained specification edition. Defines 79 operations
on `/api/v2` and Portable Library v1.

- Define reversible ID addressing and history-bound revisions and continuation.
- Separate library and staged-work concurrency preconditions.
- Define successful retry retention, readable staged manifests and staging
  lifetimes.
- Align portable values and references with the running API.
- Specify import, media, companion data, edits and transaction behavior.

This is incompatible with the earlier development `/api/v1` contract. Requests
must not be silently reinterpreted under the new route namespace.

Portable Library v1 does not carry companion objects. Media resolution does
not guarantee sample-accurate decoding. Accounts, chat, playback control and
external program execution remain outside the specification.
