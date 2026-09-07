# Vindhem Specification

Status: development specification, version `0.1.2`. The requirements below
apply to this release.
Before `1.0.0`, patch and minor releases may both break compatibility.

The key words **MUST**, **MUST NOT**, **SHOULD**, **SHOULD NOT**, and **MAY**
describe required behavior.

The exact HTTP paths, methods, inputs, outputs, errors, and schemas are defined
by [`openapi/vindhem.yaml`](../openapi/vindhem.yaml). This document defines the
system rules that apply across operations.

## 1. Scope

Vindhem specifies a portable music-library format and the API for working with
a running library. In the API rules below, "the server" means any implementation
of this contract, not a particular program.

A server manages:

- libraries;
- tracks, artists, albums, and ordered collections;
- managed audio and artwork attached to those objects;
- durable import staging;
- immutable typed companion data that refers to music;
- one revision and committed-change history per library.

Every permitted interface uses the same API. A browser, command-line tool,
application server, or agent adapter is a client of the music-library server,
not another music database.

The server does not own users, Harbors, rooms, messages, permissions, playback
queues, external catalog search, downloaders, external programs, or AI agents.
Those systems may call the server and store its stable references.

## 2. The Two Public Forms

Vindhem defines two complementary things:

```text
Portable Music Library       Vindhem API
folder + JSON manifest       running API
carry a library              use a library
```

[`spec/library-format.md`](library-format.md) defines the portable form. The
OpenAPI document defines the running form. Import and export translate between
them without changing semantic identity.

The server's database tables, indexes, queues, caches, and storage paths are
private. No public identifier may depend on them.

## 3. Identity, Transport, And Hosted History

A library has one stable UUID. A semantic object is identified by
`(library ID, object kind, object ID)`. The kinds are `track`, `artist`, `album`,
`collection`, and `collection-entry`. A companion uses kind `companion`.
Each playlist occurrence has its own ID. Attachment IDs address managed bytes
and are not music identity. Names, paths, URLs, checksums, fingerprints,
external identifiers and private storage keys MUST NOT become semantic identity
or silently merge records.

A producer MUST NOT assign an existing semantic or companion tuple to a different
entity, including after deletion. Metadata edits, replacing media, moving bytes,
and restoring the same entity preserve its tuple. Metadata or byte equality
cannot prove or disprove that an entity is the same.

The server MUST reserve every canonical semantic/companion ID it has observed during
one continuously hosted library lifetime. Reservations survive deletion, restart,
change-history pruning and same-ID snapshot replacement. Ordinary creation,
including server-generated IDs, MUST NOT reuse an observed ID; return
`409 identity_conflict` with `details.reason: retired_identity` for a deleted ID.
Preparation alone does not permanently reserve a canonical ID. A collision at
commit fails without silently reallocating an ID already exposed in a draft.

`replace-same-library` is an explicit producer assertion that each reused ID
denotes the same entity; it may restore reserved portable objects. It preserves
reservations for omitted objects and existing historical companions. The server MUST
NOT replace that assertion with name/checksum heuristics. No restored-ID diff is
required. Portable v1 carries no retirement ledger, so a fresh host cannot know
IDs deleted before the imported snapshot. The producer obligation remains, but
server enforcement covers observed history only. Whole-library deletion ends
that hosting scope; recreating it does not restore erased reservation knowledge.

An independent fork receives a deliberately new logical library UUID. A fork
import target must contain no music/companions and have no previously observed
semantic/companion IDs; current zero counts alone do not establish freshness.
Pre-import library-title edits do not disqualify an otherwise fresh target.

The shared portable semantic domains apply throughout API music requests,
results, references and exports. Native text is not trimmed or normalized.
Distinct NFC/NFD values remain distinct. Optional values cleared by `null` in
patches are absent from canonical portable values. Every changed write MUST
leave a graph conforming to portable v1, including cumulative graph and array
limits, safe integers, real dates, reference resolution and ordering. A library
may be untitled; `null` clears its title.

Operational admission limits do not redefine native validity. The server MAY reject
work exceeding its advertised effective limits before accepting it, with a
location and applicable limit; it MUST NOT truncate, rename or discard values.
Every admitted ID must be addressable through all applicable routes. Reducing
admission limits later MUST NOT make accepted state unreadable or unexportable.

Raw IDs in JSON are never URI path syntax. Every opaque local-ID path parameter,
exact local-ID query filter, and exact external-identifier-value and
producer/activity-ID filter uses the specified token: `~` followed by canonical
unpadded base64url of the raw string's UTF-16 code units, two octets per unit in
most-significant-first order, without BOM. Non-BMP scalars use their surrogate
pair; isolated escaped surrogate units are preserved. This is code-unit
serialization, not a claim that isolated units are Unicode scalar values. Decode
once. Reject padding, noncanonical unused bits, odd decoded byte counts, and
empty decoded strings. Do not normalize or decode again. Examples: `a/b` →
`~AGEALwBi`; `..` → `~AC4ALg`; NUL → `~AAA`. Library UUIDs, constrained
companion type names/versions, free search text and other operational parameters
retain their separately defined forms. An empty parent filter selects the root;
a nonempty parent filter is a token. JSON carries the unencoded ID, even when
that string resembles a token.

Each hosted library has an opaque `historyId`, distinct from its logical UUID.
Generate a fresh history on creation/rehosting or recovery that cannot preserve
revision-history continuity. It MUST NOT collide with an earlier history at the
same service. Revisions increase only within that history. The Library object,
applicable read results and `X-Library-History-ID` expose it. Snapshot includes
it through its Library object. Query cursors bind history as well as revision.
Music references do not acquire this operational history field.

`X-Library-ETag` is an opaque concurrency token bound to history and revision;
`If-Library-Match` compares it. `X-Draft-ETag` is bound to a unique batch instance
and its draft revision; `If-Draft-Match` compares it. These custom headers are
not HTTP representation validators. An implementation MAY additionally provide
ordinary `ETag` only when it correctly validates the actual representation.

## 4. The Music Graph

The server uses the same semantic graph as Portable Music Library v1:

```text
Artist <--- explicit credit --- Track --- explicit link ---> Album
                                 |
                                 +--- occurrence ---> Collection entry ---> Playlist

Collection --- parent of ---> Collection
```

The following rules are invariant:

- artist credits are ordered and may contain several distinct artists;
- artist and album navigation uses explicit IDs only;
- unlinked artist or album text remains text and is not guessed into a link;
- a track remains valid with no audio attachment;
- a playlist is ordered and may contain repeated tracks;
- a folder contains child collections and no track entries;
- a playlist may contain both direct track entries and child collections;
- collection parent links are acyclic;
- at most one playlist has the `liked` role;
- all-songs order, collection sibling order, and playlist-entry order are
  separate orders.

Artists and albums are first-class mutable records. Deleting one while it is
explicitly referenced MUST fail. The caller must decide how to edit the links;
the server does not guess.

Deleting a track removes every collection entry that contains it in the same
atomic mutation. Its artist and album records remain. Companion references are
historical and do not cascade.

An explicit duplicate cleanup can retarget existing collection entries to a
surviving track while preserving entry IDs and order, move compatible
attachments, then delete the redundant track in one transaction. The server does
not initiate that consolidation itself.

## 5. Reading Music

The API exposes three read shapes:

```text
search          lightweight grouped results for discovery
list/query      bounded pages for browsing and relationships
get/lookup      authoritative complete objects by stable ID
```

Search is local to one library. Global metadata catalogs are separate systems.
Query filters use explicit relationships and exact identifier pairs; name
normalization is a search aid, never a stored relationship.

Text search covers track titles and displayed credits/albums, artist names and
sort names, album titles and displayed credits, and collection names and
descriptions. Implementations may improve matching and ranking, but cannot
change a returned object's identity or fabricate a relationship.

The server preserves explicit order for tracks, artists, albums, collection
siblings, playlist entries, and attachments. Creating an object appends it to
its relevant order unless the request names an existing object before which to
insert it. `null` means append. Moving a collection to another parent appends it
there unless a destination sibling is named. Replacing an order requires every
current member of that exact order once and only once.

A page cursor binds the query, ordering, and library revision used by its first
page. The server MUST NOT continue that cursor against a different revision as if
nothing changed. It either serves the bound revision or returns `cursor_stale`.

The complete snapshot operation returns every music object and all canonical
orders from exactly one revision. It exists for bootstrap, export, and recovery;
ordinary interfaces SHOULD use bounded queries.

## 6. Changing Music And Retrying Intents

Every canonical mutation validates the current `If-Library-Match`, applies all
effects atomically, increments the library revision once when changed, records
one typed ChangeRecord, and returns the committed result. A valid no-op returns
`changed: false`, increments nothing and records no change. Library creation
starts revision zero in a new history; deletion removes the hosted library and
its history, while retained idempotent receipts have their independent lifetime.
Explicit whole-library deletion overrides staging leases and record-retention
promises and removes those records/bytes. It MUST serialize with admitted commits
and processing that owns those bytes; it may wait boundedly or reject with
`409 invalid_state` while an admitted commit outcome is unresolved. A successful
deletion cannot remove resources from underneath an unresolved admitted commit.
Unknown request properties and malformed/invalid values are rejected, never
silently ignored or coerced.

Direct operations cover single changes. Typed transactions cover several related
metadata, relation, collection, ordering and companion edits atomically. They
cannot upload media or execute external software. Edit batches hold the same
operations durably for preparation and review. Draft changes do not change music.
An edit preparation names `historyId` with `baseRevision`. Each import/edit batch
captures an immutable `historyId`; creation/rebase reject a history mismatch with
`history_unavailable`, and no retained draft may commit into another history.
A ready batch whose library base and both concurrency preconditions match can
commit. Commit returns one ordered result per submitted operation and makes the
batch terminal. Cancellation changes no canonical music.

Preparation creates draft revision zero. Subsequent operation replacement,
rebase, cancellation and explicit expiry each advance the draft once when they
change staging. Unrelated library edits make an active batch effectively stale
without changing its draft revision. Invalid or
stale batches have issues and no partial predicted effects; ready/committed
batches expose the complete atomic prediction. Operation-specific issues use a
zero-based operation index; batch-level issues omit it. Rebase must name the
current library revision and revalidates without resolving conflicts.

Omitted generated IDs are allocated once for an accepted transaction or prepared
operation-list version. Batch GET exposes fully populated operations. Prediction,
rebase, commit and replay reuse those IDs. Resubmitting the unchanged populated
list is a no-op; rebasing to the already selected current base is a no-op. A new
replacement request containing omitted IDs is a fresh allocation intent, even
if it resembles an earlier sparse request; exact idempotent replay is separate.
Clients preserve reviewed identities by resubmitting the populated operations.

Every mutation requires a high-entropy Idempotency-Key unique to one new intent.
Its scope is authenticated principal, operation ID and decoded semantic target.
The scope does not change to the target's current hosted history. Authenticate
and authorize every attempt before revealing a replay; revocation still applies.
Check an existing key before evaluating current preconditions or current resource
existence, so a lost successful delete can replay after deletion.

Relevant request equality includes decoded path/query values, supplied library
and draft preconditions, normalized content type, and the logical body. JSON
member order, insignificant whitespace and number spelling do not matter; strings
and array order do. Multipart equality compares logical fields and exact file
octets, not boundary spelling. Trace and authentication headers are excluded.
Changed input with a pending or retained key fails `idempotency_conflict`.

The server MUST retain every durable successful (2xx) result for at least its advertised
idempotency retention starting at completion: canonical changes, no-ops, staged
changes, and accepted item/audit receipts whose processing result is failed.
Persist the intended effect and its replayable receipt with crash-safe coupling.
Replay original status, body and semantic headers, including original request ID,
history and revision metadata. Transport dates may differ. Receipt retention
survives target deletion and is independent of staging record retention.

A definitive non-2xx result does not consume a fresh key and certifies that the
requested canonical change or intended staging result did not commit. Explicit
failed-commit bookkeeping may still transition `committing` back to an inspectable
active/failed state and record failure diagnostics; each changed draft transition
advances its revision. Independent expiry and background processing may also
change staging. This exception permits neither partial canonical edits nor
unreported adoption of the requested staging result. Clients reread the draft
before forming a corrected intent with a fresh key and current preconditions.

Only one executor may act on a pending key. An identical concurrent request may
wait boundedly or receive `409 idempotency_in_progress` with Retry-After. These
coordination responses do not replace the eventual result. A crash, timeout or
unknown storage outcome MUST NOT release the key for blind reexecution; reconcile
the durable outcome first. The server releases a rejected key only after proving
the intended effect did not commit. Clients treat transport failure, any 5xx and
in-progress responses as indeterminate and retry the identical request with the
same key. They MUST NOT infer rollback from a 5xx or start a replacement intent
until the outcome is known. After retention expiry keys may be treated as new.

## 7. Importing And Retaining Staged Work

New audio/artwork enter through durable staging: upload, inspect, correct, then
explicitly commit. Uploading does not add canonical music. Filenames, declared
types, metadata and manifests are untrusted. Items retain source filename, size,
detected type/digest evidence, processing/proposal/duplicate state and stable
machine-readable failure. Private staging paths are never exposed. Extracted
metadata is a proposal; exact bytes are duplicate evidence, not a merge command.

Each batch has an independent draft revision/token. Manifest replacement, accepted
upload, proposal replacement, discard, processing completion, each commit-state
transition and cancellation advance the draft once when staging changes. Client
authored changes require `If-Draft-Match`. Stale changes fail. Invalid JSON or
structurally invalid manifest replacement is rejected without replacing the old
proposal. A structurally accepted but semantically invalid proposal, if retained,
is inspectable in failed staging and cannot commit until corrected.

GET on a portable batch's manifest path returns its stored submitted semantic JSON
and the same-snapshot draft metadata. It preserves values/order and is not the
committed graph or a rewritten fork destination. Its structural response schema
does not certify semantic validity/readiness. An audio-files batch gives
`409 invalid_state`; no retained manifest gives `404 not_found`. A client may
read batch state and manifest separately, compare draft tokens, retry inconsistent
reads, then commit using the reviewed token. Retained terminal batches remain
inspectable until their stated record deadline. No review/diff engine is required.

For each selected loose-file item the caller accepts its proposal, explicitly
uses an existing track, or skips it. `use-existing-track` changes neither existing
metadata nor attachments and does not require exact-byte duplicate evidence; it
uses that track for optional playlist placement. To attach bytes, accept an
explicit attachment proposal. At a selected reuse/skip commit, release that item's
staging-byte reference immediately; private deduplicated bytes remain while another
accepted attachment/staging reference needs them. Omitted eligible items stay
ready/duplicate for later commits. Accepted/reused items become committed; skipped
items become skipped. Append selected track results to the target playlist in
item order, with independent entry IDs. If eligible work remains the batch is
partially-committed; when all items are terminal it is committed.

Discard marks an uncommitted item discarded and removes its staging-byte reference
while retaining its record; the same package path can then be uploaded again.
Cancellation cancels only remaining uncommitted work and releases its bytes. It
never rolls back an earlier partial commit. Failed batches may return to an
active state after correction; committed/cancelled states are terminal.

Portable commit requires no item decisions and applies the entire manifest plus
received valid attachments atomically. Absent bytes remain unavailable. Use
same-ID replacement or a fresh independent fork as defined in section 3; never
heuristically merge snapshots. Replacement preserves companion history, so links
to omitted music can become unresolved. At commit, check both library and draft
tokens, revalidate selected work, secure media, then atomically commit canonical
effects, one revision/change if changed, and the terminal/partial staging result.
Failures leave canonical state unchanged and sufficient staging to inspect/retry.

Imports and edit batches capture `stagingPolicy` at creation. `leaseSeconds: null`
and `expiresAt: null` explicitly promise no automatic expiry; operators may bound
occupancy and storage instead. A finite lease creates a deadline from server
acceptance time. A successful client-authored staging mutation that changes
state and leaves the batch active renews the deadline to no earlier than its
durable completion time plus the captured lease, never shortening it. State
and renewal advance the draft once together.
Reads, no-ops, replays, failures and background processing do not renew. Configuration
changes MUST NOT shorten an existing promise.

Finite expiry applies to all nonterminal noncommitting import states and all active
edit states, including stale/invalid drafts. At `now >= expiresAt`, new staging
work and commit are ineligible. Reconcile due expiry before serving state or
accepting work; cleanup scheduling does not extend eligibility. Expiry atomically
sets cancelled with `cancellationReason: expired`, advances the draft once,
cancels uncommitted items, and releases only uncommitted bytes. Explicit cancellation
uses reason explicit. Completion of processing/receiving after cancellation cannot
resurrect work. Reads can observe the reconciled cancellation without renewing it.

Commit acceptance and expiry serialize against the same durable batch state. A
commit admitted before the deadline owns its required resources until its durable
success/rollback is known. An import transition to committing advances its draft;
expiry cannot delete its inputs. An edit commit is similarly protected while its
atomic execution is pending. A later commit loses to expiry. Proven rollback after
the deadline expires remaining work. A successful partial commit admitted before
the deadline renews the remaining active staging from its durable completion time,
even if completion is after the previous deadline; it preserves committed effects
and returns partially-committed. A complete successful commit is committed.
Every changed recovery/terminal transition advances the draft exactly once.

On terminal transition set `retainedUntil` at least the captured record-retention
interval into the future. Keep batch/item metadata, normalized edit operations,
issues and staged manifests until then; unadopted bytes have their earlier release
rules. After that deadline records may return 404. Retained idempotent receipts
remain independently replayable even if their referenced staging record is gone.

Discovery advertises effective server request-body, file-payload, manifest, encoded
ID-token, item-count, active-batch and staging-policy limits. File limits count
payload octets excluding multipart framing; request limits count all request-body
octets; manifest limits count UTF-8 JSON octets after HTTP content decoding.
Omitted optional limits mean undisclosed, null means no configured bound. Limits
cannot promise the capacity of a separate gateway. A rejection identifies limit,
value, actual when known and location; it reveals no private paths or credentials.

## 8. Managed Media And Exact Resolution

Runtime attachments expose availability and verified type/size/digest facts.
Available attachments have verified media type and size; missing/quarantined
records remain addressable without fabricated evidence. Only available bytes
have a media URL. No descriptor exposes disk paths, object-store keys, credentials
or upstream URLs. Imported mediaType/size/digest/dimension claims do not become
verified facts automatically. Staged manifest inspection retains original claims.
Portable export preserves the semantic graph, attachment roles/order and known
unavailable records; repackaging may change paths and byte evidence as the portable
format permits. It does not silently change music identity.

Audio/artwork support bodyless HEAD, full GET and one byte-range GET. Ignore Range
on HEAD/non-GET, unsupported range units and syntactically valid multiple ranges;
return the ordinary complete response. Malformed/unsatisfiable single byte ranges
return 416 with the known total length. Serve media
as passive content with validated types; never execute uploads on a trusted origin.
Detach does not delete the owner. Deduplicated bytes are removed only when no
attachment/staging reference still needs them. Attachments may be reordered or
moved preserving IDs/bytes: audio only among tracks, artwork among tracks/artists/
albums. A destination position is an existing compatible attachment or null to
append. Portable ZIP export takes one coherent revision and cannot mix its manifest
with bytes selected from another revision.

Media resolution validates a track-only selector: safe nonnegative integer
milliseconds, point or half-open range with end greater than start. Time is elapsed
presentation time from the chosen audio's beginning. Validation is structural;
`durationMs` is a hint and MUST NOT reject a structurally valid selector. Resolution
does not prove decodability, the presence of that timestamp, clipping, sample-accurate
alignment, or equivalent decoder delay behavior.

Resolve the existing track (`404 not_found` if missing). If both valid digest
fields disagree, return `422 validation_failed`. Attachment ID, digest and accepted
media types are hard constraints. The MIME whitelist contains concrete parameter-
free type/subtype values with no wildcards; malformed entries return
`400 invalid_input`. Compare type/subtype ASCII case-insensitively, ignoring
parameters in the attachment descriptor. Empty whitelist matches nothing. Unknown
digest evidence cannot satisfy a digest constraint. Select the first available
audio attachment in canonical order satisfying all constraints; no match returns
`409 unavailable_media`. Never silently fall back to other bytes.

Return the selected attachment, unchanged reference/selector and actual history/
revision. An unpinned reference follows the current selected representation; a
byte-pinned reference may become unavailable. Later retrieval can fail as state
changes; reproducible clients verify returned bytes/digest. Resolution never plays,
queues, transforms or acquires music.

## 9. Companion Data

Companions describe, analyze, or annotate music without adding arbitrary track fields.
A stable type identity is `(typeId, typeVersion)`. Identical registration is safe;
a different descriptor under that identity is an identity conflict. Bodies are
JSON. Type schemas use JSON Schema 2020-12, only resolvable fragment-local references,
no external/dynamic references and no network fetches. A schema URI identifies
the schema; it does not authorize retrieval.

For registered companion bodies, `format` is annotation-only for every name,
known or unknown. The server MUST NOT reject a body because of `format` or
reject a schema merely for an unknown format name. Unsupported required
vocabularies/dialects are rejected; schemas cannot opt into Format-Assertion.
Other supported assertion keywords still validate bodies. The envelope's
UUID/date/URI and music-reference rules retain their separate normative
semantics. This policy deliberately differs from the earlier internal contract;
implementations must audit old descriptors/data and MUST NOT claim their former
validator policy was identical. Type authors requiring assertions use actual
assertion keywords or explicit producer/consumer validation.

An immutable companion has type/version, one or more ordered targets, ordered
inputs, optional inline body, ordered artifacts with stable artifact IDs, and
optional producer/version/activity metadata. At least a body or one artifact is
required. Track links alone may carry time selectors/digests. Validate envelope,
registered body assertions and reference rules at creation. Corrections create a
new object or delete the old one; historical links do not cascade or rewrite.
Unknown registered types round-trip opaquely without pretending to understand them.
Large results use artifacts rather than unbounded inline JSON. Queries cover type,
target, input, producer and activity. Portable v1 deliberately excludes companions;
it is not a complete archive of historical server results or type registrations.

## 10. Changes And Recovery

Every changed canonical mutation appends one typed ChangeRecord in its history.
Records contain cause and complete typed object/order/media effects, never driver
results or arbitrary implementation summaries. Notifications are refetch hints,
not a second authority. Failure to notify after commit neither rolls back music
nor makes its committed transaction fail.

Bootstrap with a coherent snapshot, retaining its Library historyId and revision R.
Change-list and SSE requests require that historyId and afterRevision R. Wrong
history or unavailable retained history returns history_unavailable and requires a
fresh snapshot. Cursors bind history, query, order and revision; they cannot
silently continue across rehosting or different revisions.

SSE first replays retained changes then sends live records without a replay/live
gap. Each change has event type change and ID `historyId:revision`. A supplied
Last-Event-ID must name the same required history; the greater revision takes
precedence over afterRevision. Malformed event IDs are invalid input; a different
history is history_unavailable. Heartbeats have type heartbeat and no event ID.
Once stream content begins, errors terminate the stream; no JSON envelope is
appended. Reconnect uses the last received event ID and required history.

## 11. HTTP Errors, Security, And Evolution

Errors before response content begins use ErrorEnvelope with stable code, message,
request ID and optional structured details. HEAD never has content on success or
failure; use its status and X-Request-ID. A response cannot claim success before
its relevant durable result commits. After binary/SSE content begins, terminate a
failed response instead of appending JSON. Every 401 includes a Bearer
WWW-Authenticate challenge. The server requires Content-Range `bytes */N` on a known-size
416; this deliberately strengthens HTTP's recommendation. Explicit 429 responses
identify temporary admission failures; Retry-After, when supplied, guides retry.
Default errors remain available for unexpected failures.

The server accepts revocable bearer credentials. Issuance, end-user login,
authorization policy, and user/library permissions remain the deployment's
responsibilities. The server SHOULD run behind that boundary or on a private
network. A shared infrastructure credential MUST NOT be exposed to browsers.
Untrusted filenames, metadata, JSON, schemas, archives and artifacts never
confer authority or cause automatic execution or network fetching.

This specification is development release 0.1.2 with /api/v2 routes. The route
prefix is an incompatible wire namespace, independent of the contract's SemVer
major. It avoids reinterpreting old raw IDs as encoded addresses: for example,
an old raw ID ~AGEALwBi must not silently select a/b after an upgrade. An operator
may separately support /api/v1; dual support is not required by this specification.
Retired /api/v1 routes MUST NOT redirect or alias into the new token-decoding routes.
Root/default discovery reports the selected exact contract in apiVersion, which
MUST equal the served OpenAPI info.version and be a valid SemVer 2.0.0 string.
The route prefix, portable format and software versions remain independent.
An implementation MUST identify the contract version it implements. Publishing
a specification does not establish conformance of an existing implementation.

Requests and semantic response objects/unions remain closed as specified.
Service discovery and operational-limit containers explicitly permit unknown
members; clients MUST ignore unknown members only in those designated
containers. Adding operations or optional discovery metadata can be compatible.
Changing existing semantics, narrowing accepted inputs, or adding semantic
response members/enum meanings is incompatible unless explicit representation
negotiation is adopted. Apply the release rules in section 14: pre-1.0 patch and
minor releases may both break compatibility; from 1.0.0 a breaking change
requires a major release. Do not describe additions to today's closed outputs as
automatically compatible. A client MUST inspect the exact contract version
before using its wire contract, and MUST NOT assume every future release sharing
a route prefix is compatible. Future contract releases cannot silently change
the meaning of an already registered immutable companion type.

## 12. Outside Scope

The following are not objects or operations defined by this specification:

- people, profiles, friends, Harbors, and administrators;
- chat rooms and messages;
- playback state, queues, volume, and mixer control;
- external metadata catalogs and recommendations;
- YouTube, Soulseek, and other acquisition sources;
- program discovery, scheduling, progress, cancellation, or execution;
- AI and MCP protocols;
- storage-provider configuration.

## 13. Contract Documents

The normative contract consists of:

- this invariant specification;
- [`openapi/vindhem.yaml`](../openapi/vindhem.yaml);
- [`spec/library-format.md`](library-format.md) for portable-library rules;
- [`schema/library-v1.schema.json`](../schema/library-v1.schema.json) for the
  portable form.

An implementation conforms only when every normative OpenAPI operation and
schema behaves as specified, including revision preconditions, idempotent
retries, coherent pagination, staged-import failure recovery, byte ranges,
typed change effects, restart persistence, and Portable Library round trips.

## 14. Versioning

The API contract follows [Semantic Versioning 2.0.0](https://semver.org/).
Before `1.0.0`, the contract is under development. Patch and minor releases may
both change behavior incompatibly; sharing `0.x` is not a compatibility promise.
Clients MUST target an exact contract release and review its change notes before
upgrading. From `1.0.0`, breaking changes require a major release, compatible
additions a minor release, and compatible corrections a patch release. Published
versions are immutable, including development releases. New labels do not
rewrite earlier released documents.

`info.version` in OpenAPI and `apiVersion` in service responses identify the
same contract version. OpenAPI's format version, the portable manifest's
integer version, and software-package versions are separate. This specification
uses `/api/v2` to isolate changed address decoding. Route namespace numbering
is independent of this pre-1.0 contract release.
