# Vindhem Specification

Specification `0.1.2` · `/api/v2` · Portable Library v1

Vindhem defines the music objects, references, and operations that applications can
share. The API describes how to read and change a running library. The portable
format describes how to carry that library between systems.

## Read The Contract

- [API reference data: OpenAPI YAML](../openapi/vindhem.yaml):
  paths, methods, inputs, outputs, errors, and schemas.
- [Library rules](vindhem.md): identity, ordering, consistent reads,
  atomic edits, imports, media, and change notifications.
- [Portable Library](library-format.md): the folder and JSON manifest format.
- [Portable Library JSON Schema](../schema/library-v1.schema.json): the
  machine-readable manifest shape; the written rules also apply.

These documents work together. The rendered API reference is a view of the
OpenAPI document, not another contract to maintain.

## What You Work With

A library contains tracks, artists, albums, and ordered collections. Collections
can organize other collections or contain playlist entries. Each occurrence of
a track in a playlist has its own identity and position.

Music is identified by library ID, object kind, and object ID, not its name or
filename. An application can retain that reference, including an exact track
time or range, while the music's metadata or storage location changes.

Audio and artwork are attachments. A track can exist without audio. Separately
typed companion objects carry notes, analysis, or other data referring to music
without changing the track's shape.

## How To Use The API

**Read.** Discover the service, list its permitted libraries, then search or
browse one library. Results carry IDs; exact lookups retrieve the complete
objects. Lists are paginated.

**Change.** Read the current revision before editing. Library edits use
`If-Library-Match` and `Idempotency-Key`, so concurrent changes and repeated
requests do not silently overwrite or repeat work. Transactions apply several typed
edits together. Edit batches let a client prepare and inspect work before
committing it.

**Import.** Stage files or a portable manifest, inspect the proposed music,
then commit or cancel. Uploading a file does not by itself add a track to the
library. Draft changes have their own revision preconditions. A second client
can read the staged portable manifest using its draft token. Batch responses disclose
expiry and record retention; null expiry explicitly means no automatic expiry.

**Read media.** Resolve a track's available audio and request its bytes,
including byte ranges. Your application decides how to play them; the server
does not control a player or queue.

**Stay current.** Observe committed changes and refetch the affected state.
After missed or replaced history, recover from a fresh snapshot. Retain its
`historyId` as well as revision; continuation cannot silently cross rehosting.

**Move the library.** Export its portable manifest or a package with available
media. Portable Library v1 carries the music graph and attachments, not
companion objects, accounts, or chat.

## Where It Runs

The specification is a set of documents, not a hosted music service. An
implementation runs the API and manages library data. A client uses the URL
and credentials for that implementation, not this documentation website.

For example, against a server that implements this edition, using a credential
supplied by its operator:

```sh
curl --fail-with-body "$VINDHEM_URL/api/v2/service" \
  -H "Authorization: Bearer $VINDHEM_TOKEN"

curl --fail-with-body "$VINDHEM_URL/api/v2/libraries" \
  -H "Authorization: Bearer $VINDHEM_TOKEN"
```

`VINDHEM_URL` is the API origin without a trailing slash. Do not paste private
credentials into the public documentation page or use a shared server
infrastructure credential in a browser application.

## What Is Separate

Vindhem's music contract does not define accounts, chat, player controls,
music acquisition, or the execution of external programs. Applications can
combine those systems with the music API without making them part of it.

MCP lets an agent call music operations. It is an adapter to the API, not a
required route for other applications. Douglas combines a music-server
implementation with its own interface, access rules, and Matrix chat. Another
application can use the same contract without adopting Douglas or its MCP
implementation.

## Version And Scope

The current API contract is development release `0.1.2`. Before `1.0.0`, patch
and minor releases may both break compatibility. Clients target an exact
release. See [Versioning](vindhem.md#14-versioning).

The OpenAPI document declares its exact contract release in `info.version`;
service discovery `apiVersion` identifies that same release. The route prefix is
a separate wire namespace. `openapi` declares the OpenAPI format version. The
portable manifest has a separate `version` field. Those versions describe
different things.

The published specification files define the contract. A server's actual
availability, access policy, limits, and release are properties of that
server, not promises made by this documentation site.
