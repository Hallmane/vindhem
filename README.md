# Vindhem Specification

Vindhem lets a music library exist independently of the application used to work
with it. It specifies music objects, a portable library format, and an API for
reading and changing a running library.

**Current edition: 0.1.2.** Before 1.0.0, patch and minor releases may both break
compatibility. Clients target an exact edition; released tags are immutable.

## Specification

- [Introduction](spec/README.md)
- [Specification](spec/vindhem.md)
- [OpenAPI YAML](openapi/vindhem.yaml)
- [Portable Library](spec/library-format.md) and [JSON Schema](schema/library-v1.schema.json)
- [Minimal library](examples/minimal-library/vindhem.library.json)
- [Release notes](CHANGELOG.md)

This repository defines the contract. It does not run a music server.

## Reader

[site/](site/) contains the complete static specification reader and raw
downloads. Serve that directory with any static web host; no application
backend or runtime dependencies are required.

[page/](page/README.md) contains its source, build and verification tools.
The reader is generated from the canonical documents, not maintained separately.

## Development

Requires Node.js 22 or newer.

```sh
npm ci
npm run check
npm run page:build
npm run page:preview
```

The preview opens at `http://127.0.0.1:5197/` and serves the generated
`dist/specification/` directory. See [reader documentation](page/README.md) for
building the distributable files, checking them and hosting the reader.

Document validation does not establish runtime conformance. Each implementation
must identify the contract it actually supports.

## License

First-party content in this repository, including the specification, schemas,
and reader, is licensed under the [Apache License 2.0](LICENSE). Third-party
materials remain subject to their own terms. Contributions are licensed under
Apache 2.0 unless explicitly stated otherwise.
