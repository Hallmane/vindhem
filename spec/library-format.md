# Vindhem Portable Music Library v1

Status: normative specification for Portable Music Library version 1, called
Portable Library v1 for short.

The key words **MUST**, **MUST NOT**, **SHOULD**, **SHOULD NOT**, and **MAY** in
this document are normative requirements.

## 1. Purpose

This format carries a music library between systems.

A library may arrive as a folder on a USB drive, a directory dropped into a
browser, or a native export from another system. A conforming reader can recover
the tracks, artist and album links, playlists, liked songs, folder hierarchy,
and any media files included in that export.

The format describes the library. It does not prescribe where an importing
system stores it or what interface that system builds around it.

## 2. Scope

Version 1 describes four semantic object kinds:

- `track`: one musical item in this library;
- `artist`: an explicitly identified artist used for navigation and grouping;
- `album`: an explicitly identified release-like grouping;
- `collection`: an ordered playlist or an organizational folder.

The package may also contain file attachments for audio and artwork. Attachments
belong to one export; they are not music identity.

Version 1 does not define a universal work, recording, edition, or asset
ontology. It also does not define people, profiles, ownership, sharing,
permissions, synchronization, playback APIs, acquisition, storage backends,
analysis, chat, or Harbor behavior.

## 3. Native package

A native package is a directory containing this file at its root:

```text
vindhem.library.json
```

Audio and image files may be present below that directory. The manifest may
also stand alone as a metadata-only library.

The manifest MUST be UTF-8 JSON as defined by RFC 8259. It MUST NOT contain
duplicate object keys. All integers MUST be in the interoperable range
`-(2^53 - 1)` through `2^53 - 1`.

The root object has this shape:

```json
{
  "format": "vindhem.music-library",
  "version": 1,
  "id": "c8c542ed-6b0e-42cb-89ed-f0453adc3d59",
  "title": "My music",
  "tracks": [],
  "artists": [],
  "albums": [],
  "collections": []
}
```

`format`, `version`, `id`, `tracks`, `artists`, `albums`, and `collections` are
required. `title` is optional.

A version 1 reader MUST reject an unsupported `format` or `version`. It MUST NOT
guess that an unknown document is compatible.

Array order has these meanings:

- `tracks` is the library's default all-songs order;
- artist credits preserve credit order;
- track files are ordered from most to least preferred for this export;
- collection entries preserve playlist order;
- `collections` preserves the display order of top-level collections and of
  siblings with the same parent.

Other array order MUST survive a native read-write round trip but has no
additional semantic meaning in version 1.

## 4. Identity

The library `id` is a lowercase canonical RFC 9562 UUID. It is generated when a
native library is created and remains stable when that library is moved,
hosted, copied, or re-exported.

A deliberate independent fork MUST receive a new library ID. A byte-for-byte
copy, storage migration, or repackaging of the same library MUST retain the
existing library ID.

Every track, artist, album, collection, and collection entry has an opaque
non-empty local ID.

- Track, artist, album, and collection IDs are unique within their own kind in
  one library.
- Entry IDs are unique across all collections in one library.
- IDs MUST remain stable when metadata is edited, attached files move or are
  replaced, or the library is re-exported.
- Meaning MUST NOT be inferred from an ID's spelling.
- A producer MUST NOT reassign an existing object tuple to a different entity,
  including after deletion. Restoration of that same entity retains its ID.
  Version 1 carries no retirement ledger; an importing host cannot reconstruct
  deleted identities absent from this snapshot. Copies retain the producer
  obligation; an independent fork uses a new library UUID.
- A local ID is not a path, URL, catalog ID, provider ID, content checksum,
  fingerprint, title, or normalized metadata key.

A reference outside the manifest identifies an object with the tuple:

```text
(library ID, object kind, object ID)
```

Two records MUST NOT be merged only because their metadata, external
identifiers, paths, fingerprints, or checksums match. An implementation MAY
deduplicate identical bytes in its private storage, but that MUST NOT merge or
rewrite library records or collection entries.

The same library ID declares the same logical library. Version 1 carries no
revision, timestamp, or merge history. If an importer already has that library
ID and receives different content, it MUST NOT guess which snapshot is newer or
merge them heuristically. The host applies an explicit policy: replace its
snapshot, reject the import, or create a deliberate fork with a new library ID.

## 5. Tracks

A track is one musical item as represented by this library. It is deliberately
library-local; version 1 does not claim that it is a globally canonical
recording.

```json
{
  "id": "track-fireflies",
  "title": "Fireflies",
  "artistText": "Owl City",
  "artists": [
    { "artistId": "artist-owl-city", "name": "Owl City" }
  ],
  "albumId": "album-ocean-eyes",
  "discNumber": 1,
  "trackNumber": 1,
  "durationMs": 228000,
  "identifiers": [
    { "scheme": "isrc", "value": "USUM70972064" }
  ],
  "files": [
    {
      "path": "Music/Owl City/Ocean Eyes/01 Fireflies.flac",
      "mediaType": "audio/flac",
      "sizeBytes": 28910432
    }
  ]
}
```

Required fields:

- `id`: stable local track ID;
- `title`: best available display title; a filename fallback is valid;
- `artists`: ordered structured artist credits, possibly empty;
- `identifiers`: external identifiers, possibly empty;
- `files`: audio files attached to this export, possibly empty.

Optional fields:

- `artistText`: the original or preferred display credit;
- `albumId`: reference to an album in `albums`;
- `albumTitle`: unlinked album text when no trustworthy album record exists;
- `discNumber` and `trackNumber`: positive integers;
- `durationMs`: non-negative duration hint in milliseconds;
- `artwork`: image files attached to this export.

`albumId` and `albumTitle` MUST NOT both appear. When `albumId` is present it
MUST resolve to an album. When neither appears, the album is unknown or absent.

Each artist credit has a required `name` and optional `artistId`. A present
`artistId` MUST resolve to an artist. Credit order is meaningful. Several
artists MUST remain separate when the source data distinguishes them.

`artistText`, when present, is the authoritative display string. The structured
credits support navigation and grouping; readers MUST NOT invent a claim about
punctuation or joining words that the manifest did not provide.

Unknown artist and album values are represented by absence. Writers MUST NOT
invent records named `Unknown Artist`, `Unknown Album`, or similar placeholders.

A metadata edit preserves the track ID. Metadata enrichment MUST NOT silently
overwrite a user's existing value merely because an external catalog disagrees.

## 6. Artists and albums

Artist and album records provide explicit objects for interfaces to navigate
and group. Their arrays may be empty. Tracks remain valid without linked artist
or album records.

Artist:

```json
{
  "id": "artist-owl-city",
  "name": "Owl City",
  "sortName": "Owl City",
  "identifiers": [
    { "scheme": "spotify-artist", "value": "07QEuhtrNmmZ0zEcqE9SF6" }
  ]
}
```

Album:

```json
{
  "id": "album-ocean-eyes",
  "title": "Ocean Eyes",
  "artistText": "Owl City",
  "artists": [
    { "artistId": "artist-owl-city", "name": "Owl City" }
  ],
  "releaseDate": "2009-07-14",
  "identifiers": [],
  "artwork": [
    {
      "path": "Artwork/ocean-eyes.jpg",
      "mediaType": "image/jpeg",
      "role": "front"
    }
  ]
}
```

Artist records require `id`, `name`, and `identifiers`. Album records require
`id`, `title`, `artists`, and `identifiers`. Other shown fields are optional.

An album is a library-local release-like grouping. It does not claim to model
every edition or release relationship used by an external catalog.

`releaseDate` is a real ISO 8601 calendar date at its available precision:
`YYYY`, `YYYY-MM`, or `YYYY-MM-DD`.

Readers group by explicit `artistId` and `albumId` links when those links exist.
Grouping unlinked records by normalized names is an interface heuristic, not a
fact stored by this format.

## 7. External identifiers

An external identifier has two required strings:

```json
{ "scheme": "musicbrainz-recording", "value": "..." }
```

`scheme` uses lowercase ASCII letters, digits, dots, and hyphens and begins
with a letter. Known version 1 scheme names include:

- `isrc`;
- `musicbrainz-recording`, `musicbrainz-track`, `musicbrainz-release`,
  `musicbrainz-release-group`, and `musicbrainz-artist`;
- `spotify-track`, `spotify-album`, `spotify-artist`, and `spotify-playlist`.

A private scheme SHOULD use a reverse-domain prefix, for example
`org.example.catalog-track`.

External identifiers help adapters and catalogs propose links. They are not
local IDs and do not by themselves prove that two records are the same.
Repeated identifiers are allowed when source data contains them.

## 8. Package files

`files` and `artwork` describe optional files included in this exported folder.
They do not describe the importing system's storage.

Audio attachment:

```json
{
  "path": "Music/example.flac",
  "mediaType": "audio/flac",
  "sizeBytes": 123456,
  "sha256": "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
}
```

`path` is required. `mediaType`, `sizeBytes`, and `sha256` are optional.

Artwork uses the same fields and may additionally contain positive integer
`width` and `height` and a non-empty `role`, such as `front` or `artist`.

An attachment path:

- is a literal UTF-8 string relative to the package root;
- uses `/` between segments and is never URL-decoded;
- MUST NOT be absolute, begin with a Windows drive designator, contain `\\`,
  contain an empty, `.` or `..` segment, end in `/`, or contain control
  characters;
- MUST NOT contain `<`, `>`, `:`, `"`, `|`, `?`, or `*`;
- MUST NOT contain a segment ending in a dot or space or a Windows-reserved
  device name;
- MUST refer only to a regular file below the package root when that file is
  present. Readers MUST NOT follow symbolic links.

Writers MUST NOT emit two distinct paths that compare equal after Unicode NFC
normalization and case folding. This prevents one portable package from naming
different files that collapse on another common filesystem.

The same exact path may be referenced more than once. When it is, all supplied
`mediaType`, `sizeBytes`, `sha256`, `width`, and `height` values MUST agree.
Omitted values do not conflict. `role` is contextual and may differ.

`sha256` is a lowercase hexadecimal checksum of one attached file. It verifies
transfer integrity only. It is not the track ID, and matching checksums do not
require records to merge.

A missing, unreadable, unsafe, or checksum-mismatched attachment is unavailable.
The track and the rest of the library remain valid and readable. A reader SHOULD
report the unavailable attachment and continue.

All attachments are untrusted input. Filenames, extensions, `mediaType`, size,
dimensions, and checksums are claims, not proof of safe content. An importer
MUST NOT execute attached content or trust its declared type without validation.
A hosted implementation MUST validate, transform, or isolate uploaded media
before serving it; it MUST NOT expose arbitrary uploaded bytes as active content
on the application's trusted origin.

Version 1 does not store remote media URLs, object-store keys, WebDAV paths,
browser handles, signed URLs, credentials, stream endpoints, or caches. A host
privately maps `(library ID, track ID)` to whatever storage it uses. On export it
may copy available bytes into the package and write new relative paths, or emit a
metadata-only library. Repackaging files never changes semantic object IDs.

## 9. Collections

A collection is an ordered playlist or an organizational folder.

```json
{
  "id": "playlist-party",
  "kind": "playlist",
  "name": "Party",
  "description": "Tracks for the kitchen",
  "parentId": "folder-sets",
  "entries": [
    { "id": "entry-1", "trackId": "track-fireflies" },
    { "id": "entry-2", "trackId": "track-cave-in" },
    { "id": "entry-3", "trackId": "track-fireflies" }
  ]
}
```

Required fields:

- `id`: stable local collection ID;
- `kind`: `playlist` or `folder`;
- `name`: display name;
- `entries`: ordered direct membership; it is empty for folders.

Optional fields:

- `description`: user-authored collection text;
- `role`: `liked` for a playlist representing liked songs;
- `parentId`: another collection containing this collection.

A parent may be a folder or a playlist. A playlist may therefore contain direct
track entries and child collections. Descendant aggregation is presentation
behavior; `entries` always means direct membership only. Parent references MUST
NOT form a cycle.

Each playlist entry has a stable `id` and a `trackId` that MUST resolve to a
track. The same track may occur more than once; every occurrence has a different
entry ID. Moving or removing one occurrence addresses the entry ID, not every
entry with that track ID.

`tracks` is the all-songs list. Liked songs are an ordinary playlist with
`role: "liked"`. A library contains at most one collection with that role.

## 10. Validity and errors

A manifest is conforming only when it passes both:

1. structural validation against `schema/library-v1.schema.json`;
2. semantic validation of all cross-record and package rules in this document.

Semantic validation includes:

- no duplicate JSON object keys;
- IDs unique in every defined scope;
- all artist, album, track, and parent references resolve to the required kind;
- entry IDs unique across all collections;
- no collection-parent cycle;
- no simultaneous `albumId` and `albumTitle`;
- real calendar dates at their stated precision;
- safe package paths and no cross-filesystem path collisions.

A reader MUST report validation failures with enough location information to
identify the field. It MUST NOT silently repair an invalid native manifest.
Software MAY offer an explicit repair operation, but its result is a newly
written manifest.

Manifest conformance and package completeness are separate outcomes. A package
check additionally verifies that each referenced attachment exists below the
package root, is a regular non-symbolic-link file, matches declared `sizeBytes`
and `sha256`, and does not conflict with another descriptor for the same path.
Traversal and verification MUST use no-follow handles; checking a pathname and
then reopening it later is not sufficient because a path component may change.

A conforming manifest can belong to an incomplete package. Missing or corrupt
media is not a manifest validation failure; it is attachment availability state.

## 11. Native reading and writing

When a directory is opened:

1. Look for `vindhem.library.json` at its root.
2. If present, parse and validate it before trusting paths.
3. Treat the manifest as the sole normative description of the native library.
   Embedded file tags MUST NOT silently alter its records.
4. Resolve package attachments relative to the manifest without following
   links outside the package.
5. Report unavailable attachments per track and continue loading.

A native writer MUST preserve all IDs, references, values, JSON value types,
and meaningful array ordering. Object-key order, whitespace, and insignificant
number spelling need not survive.

## 12. Foreign adapter guidance

This section is non-normative. Foreign adapter behavior is not part of version 1
conformance.

When `vindhem.library.json` is absent, a separate adapter may inspect embedded
tags, paths, M3U/XSPF files, DJ databases, or service exports and produce a
native snapshot.

Good adapters:

- read foreign input non-destructively;
- preserve known playlist order and duplicate occurrences;
- preserve missing referenced tracks as metadata-only records;
- preserve distinct artist credits and preferred display text when available;
- avoid silent record merges based on metadata, path, ISRC, fingerprint, or
  checksum;
- generate stable IDs and reuse its prior explicit mapping on re-import;
- represent absent artist or album metadata as absence, not invented values.

Heuristic matches should remain suggestions instead of silently becoming
identity.

An adapter should report recognized foreign data it could not represent. A
machine-readable loss report is useful, but its format is not part of version 1
and is not stored inside the library manifest.

Foreign import is snapshot conversion, not synchronization. Version 1 does not
promise round-trip editing of a vendor database.

## 13. Evolution

Version 1 has no generic `extensions` field. A catch-all object would mix
unrelated meanings into the portable library without giving them a contract.

New shared library meanings require a later format version. Independent systems
may store their own data separately and refer to music objects by
`(library ID, object kind, object ID)`. This permits analysis, cues, chat,
generation, recommendations, or new interfaces without changing what a version
1 library means. Version 1 does not specify those companion documents.

## 14. Version 1 invariants

The alpha is centered on these facts:

1. Library and object identity are independent of names, catalogs, locations,
   and bytes.
2. Tracks remain visible when no playable file is attached or available.
3. Multi-artist credits remain separate when known.
4. Artist and album grouping uses explicit links, not normalized-name guesses.
5. Playlist entries are ordered, independently identified, and may repeat a
   track.
6. Included files are optional export attachments, not a storage protocol.
7. Importers disclose ambiguity or loss instead of inventing certainty.

## 15. Deliberately deferred

Version 1 does not define:

- people, profiles, Ships, Harbors, Harbingers, membership, or visibility;
- ownership, sharing permission, current reachability, or availability indexes;
- remote synchronization, editing operations, merge policy, or conflict rules;
- streaming, transcoding, acquisition, fulfillment, or storage APIs;
- ratings, play history, cues, beat grids, waveforms, or analysis;
- chat, contextual packets, automations, recommendation, or music generation;
- a universal catalog or global recording identity;
- any particular user interface.

These are separate systems that may consume or produce version 1 libraries.

## 16. Design precedents

The format borrows narrow, tested ideas rather than adopting another system's
whole model:

- [XSPF](https://www.xspf.org/spec): ordered occurrences, identity separate
  from location, and graceful handling of unavailable tracks;
- [MusicBrainz](https://musicbrainz.org/doc/MusicBrainz_Entity): external music
  identities are typed and are not file identity;
- [ID3v2.4](https://github.com/id3/ID3v2.4) and
  [Vorbis comments](https://xiph.org/vorbis/doc/v-comment.html): file metadata
  may contain repeated artist values and imperfect source text;
- [BagIt, RFC 8493](https://www.rfc-editor.org/rfc/rfc8493.html): portable
  package paths and checksums require explicit containment and interoperability
  rules;
- Rekordbox, Traktor, Serato, Engine DJ, Mixxx, and Apple library exports:
  catalog records and ordered playlist references must remain separate, while
  vendor analysis and storage details should not become universal library fields.
