import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const SITE_FILES = [
    'index.html', 'reader.css', 'reader.js', 'publication.json',
    'operations.json', 'release-notes.md', 'LICENSE',
    'openapi/vindhem.yaml', 'openapi/vindhem.json',
    'schema/library-v1.schema.json',
    'spec/README.md', 'spec/vindhem.md', 'spec/library-format.md',
];

export function verifyReaderAssets(directory) {
    const html = readFileSync(resolve(directory, 'index.html'), 'utf8');
    // Check only our canonical generated tags; this is not a general HTML sanitizer.
    for (const [name, pattern, tagFor] of [
        ['reader.css', /<link\b[^>]*>/gi, (url) => `<link rel="stylesheet" href="${url}">`],
        ['reader.js', /<script\b[^>]*>/gi, (url) => `<script src="${url}" defer>`],
    ]) {
        const tags = html.match(pattern) ?? [];
        assert.equal(tags.length, 1, `Expected one local ${name} reference`);
        const hash = createHash('sha256').update(readFileSync(resolve(directory, name))).digest('hex');
        const expected = tagFor(`${name}?v=${hash}`);
        assert.equal(tags[0], expected, `Expected exact content-addressed ${name} URL`);
        if (name === 'reader.js') assert(html.includes(`${expected}</script>`), 'Expected an empty external reader script');
    }
}

export function verifySite(directory) {
    const root = resolve(directory);
    assert(lstatSync(root).isDirectory() && !lstatSync(root).isSymbolicLink(), 'Expected a regular site directory');
    const directories = new Set(['openapi', 'schema', 'spec']);
    const found = [];
    function walk(relative = '') {
        for (const entry of readdirSync(resolve(root, relative), { withFileTypes: true })) {
            const path = relative ? `${relative}/${entry.name}` : entry.name;
            if (entry.isDirectory()) {
                assert(directories.has(path), `Unexpected site directory: ${path}`);
                walk(path);
            } else {
                assert(entry.isFile() && SITE_FILES.includes(path), `Unexpected file or symlink: ${path}`);
                assert(lstatSync(resolve(root, path)).size <= 10 * 1024 * 1024, `Oversized site file: ${path}`);
                found.push(path);
            }
        }
    }
    walk();
    assert.deepEqual(found.sort(), [...SITE_FILES].sort(), 'Incomplete site tree');

    const record = JSON.parse(readFileSync(resolve(root, 'publication.json'), 'utf8'));
    assert.equal(record.format, 'vindhem.specification-site');
    assert.equal(record.formatVersion, 1);
    assert.equal(record.title, 'Vindhem Specification');
    assert.match(record.apiVersion, /^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/);
    assert.equal(record.specificationTag, `v${record.apiVersion}`);
    assert.match(record.specificationRevision, /^[a-f0-9]{40,64}$/);
    assert.match(record.readerRevision, /^[a-f0-9]{40,64}$/);
    assert.equal(record.workingTreeDirty, false, 'Prepare the site from committed source');
    assert.equal(record.overview, 'index.html');
    assert.deepEqual(record.openapi, { yaml: 'openapi/vindhem.yaml', json: 'openapi/vindhem.json' });
    assert.equal(record.portableSchema, 'schema/library-v1.schema.json');
    assert.equal(record.operationIndex, 'operations.json');
    assert.equal(record.releaseNotes, 'release-notes.md');
    assert.equal(record.license, 'LICENSE');
    assert(Array.isArray(record.files), 'Expected file checksum list');
    assert.deepEqual(record.files.map((file) => file.path).sort(), SITE_FILES.filter((path) => path !== 'publication.json').sort(), 'Checksum list must cover every content file exactly once');
    for (const file of record.files) {
        const bytes = readFileSync(resolve(root, file.path));
        assert.equal(bytes.length, file.bytes, `Size mismatch: ${file.path}`);
        assert.equal(createHash('sha256').update(bytes).digest('hex'), file.sha256, `Checksum mismatch: ${file.path}`);
    }
    verifyReaderAssets(root);
    const api = JSON.parse(readFileSync(resolve(root, record.openapi.json), 'utf8'));
    assert.deepEqual(api.info.license, { name: 'Apache 2.0', identifier: 'Apache-2.0' });
    assert.match(readFileSync(resolve(root, record.license), 'utf8'), /Apache License\s+Version 2\.0, January 2004/);
    assert.equal(api.info.version, record.apiVersion);
    assert.equal(api.openapi, record.openApiVersion);
    const portable = JSON.parse(readFileSync(resolve(root, record.portableSchema), 'utf8'));
    assert.equal(portable.properties.version.const, record.portableLibraryVersion);
    assert(readFileSync(resolve(root, record.releaseNotes), 'utf8').startsWith(`# Vindhem Specification ${record.apiVersion}\n`));
    return record;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
    const record = verifySite(process.argv[2] ?? resolve(root, 'site'));
    process.stdout.write(`Verified Vindhem ${record.apiVersion}: ${SITE_FILES.length} static files, exact file set and content checksums.\n`);
}
