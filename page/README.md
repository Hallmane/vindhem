# Specification Reader

The reader is generated from `spec/`, `openapi/` and `schema/` in the repository
root. [site/](../site/) contains the prepared static files.

## Build And Preview

From the repository root, using Node.js 22 or newer:

```sh
npm ci
npm run page:build
npm run page:preview
```

The build writes `dist/specification/`. The local preview is available at
`http://127.0.0.1:5197/`. `SPEC_PORT` changes the port; `SPEC_BASE_PATH` selects
a directory path, for example:

```sh
SPEC_BASE_PATH=/specification/ npm run page:preview
```

The page uses local CSS and JavaScript, with no backend, remote fonts, CDN or
music server. Rebuild after changing the documents or reader source.

## Prepare Static Files

Commit source changes, then run:

```sh
npm run page:bundle
```

This replaces the generated `site/` tree with a verified build. Commit those
generated files separately; do not edit them by hand. Preparation requires a
clean source tree and canonical documents matching their specification tag.
Changes to generated `site/` are excluded from the source-dirty check.

The output includes HTML, CSS, JavaScript, Markdown, YAML and JSON downloads,
an operation index, edition notes, `LICENSE` and `publication.json`.
The licence is copied from the repository root and linked once in the reader
footer. Keep it with the bundle when hosting or redistributing the reader.

## Verification

```sh
npm run check
npm run page:check
npm run page:verify
```

The first checks the specification documents. The second uses installed Google
Chrome to check the reader on desktop and narrow screens, including versioned
paths, links, downloads and scroll tracking. The third verifies the prepared
file set, sizes, hashes and edition metadata.

The static-file verifier uses only Node's built-in libraries and can run
without installing dependencies:

```sh
node page/verify-site.mjs /path/to/site
```

Checksums verify integrity, not authorship. Obtain the files from a trusted,
pinned repository commit.

## Hosting

Copy the contents of `site/` to a static web host, preserving subdirectories.
All asset and download paths are relative. The same tree works at a site's
root, under `/specification/`, or under `/specification/releases/0.1.2/`.

- Redirect directory addresses to their trailing-slash form.
- Return actual files for downloads and 404 for unknown paths, not an HTML
  application fallback.
- Serve HTML, CSS, JavaScript and Markdown with their appropriate content types;
  use `application/yaml`, `application/json` and `application/schema+json` for
  YAML, JSON and the portable schema respectively.
- Preserve the files byte-for-byte. Rewriting downloads breaks their checksums
  and may break relative schema references.
- Preserve the page's content security policy. It requires only local styles
  and scripts, not remote assets or API connections.

API paths printed in the reader describe a music server. Hosting the reader
does not expose those API operations.

## Edition Metadata

`publication.json` records the edition, specification tag and revision, reader
source revision, release-note path and content-file checksums. It does not
checksum itself; retain its hash alongside a pinned delivery commit if needed.

The specification revision identifies the canonical documents. The reader
revision identifies the code and release notes used to build the page. A later
commit containing generated files will have a different revision. Building a
reader does not move the specification tag.

Release notes are generated from the matching edition in `CHANGELOG.md`.
The static tree describes one edition, not a website's publication history.
Hosts may retain immutable edition directories and maintain a separate index
of the editions they have published. Never overwrite an archived edition with
different bytes.

The `v0.1.2` specification tag predates the reader tooling; use a later commit
containing `page/` or `site/` to build or host that edition.
