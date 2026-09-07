import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import { validateOpenApi } from '../scripts/validate-openapi.mjs';
import { renderSpecificationReader } from './render-specification-reader.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUTPUT = resolve(ROOT, 'dist/specification');
const OPENAPI = 'openapi/vindhem.yaml';
const SCHEMA = 'schema/library-v1.schema.json';
const SOURCES = [
    OPENAPI,
    SCHEMA,
    'spec/README.md',
    'spec/vindhem.md',
    'spec/library-format.md',
];
const DISTRIBUTION_FILES = [...SOURCES, 'LICENSE'];
const METHODS = new Set(['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace']);

function validate(path) {
    const result = validateOpenApi(path);
    if (result.findings.length) {
        throw new Error(result.findings.map(({ rule, message }) => `[${rule}] ${message}`).join('\n'));
    }
    return result;
}

function writeJson(path, value) {
    const destination = resolve(OUTPUT, path);
    mkdirSync(dirname(destination), { recursive: true });
    writeFileSync(destination, `${JSON.stringify(value, null, 2)}\n`);
}

function git(...args) {
    try {
        return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    } catch {
        return null;
    }
}

const source = validate(resolve(ROOT, OPENAPI));
const contract = parse(readFileSync(resolve(ROOT, OPENAPI), 'utf8'));
const portable = JSON.parse(readFileSync(resolve(ROOT, SCHEMA), 'utf8'));
const tag = `v${contract.info.version}`;
// The reader can change independently of the immutable specification edition.
const taggedRevision = git('rev-parse', '--verify', `refs/tags/${tag}^{commit}`);
const sourceMatchesTag = taggedRevision !== null && SOURCES.every((path) => {
    const taggedSource = execFileSync('git', ['show', `${taggedRevision}:${path}`], { cwd: ROOT });
    return taggedSource.equals(readFileSync(resolve(ROOT, path)));
});
const specificationRevision = sourceMatchesTag ? taggedRevision : null;
const workingTreeStatus = git('status', '--porcelain', '--', '.', ':(exclude)site');
const changelog = readFileSync(resolve(ROOT, 'CHANGELOG.md'), 'utf8');
const releaseSection = changelog.split(/^## /m).find((section) => section.split('\n')[0].trim() === contract.info.version);
if (!releaseSection) throw new Error(`Missing release notes for ${contract.info.version}`);

// Preserve relative schema and prose links; never copy the repository wholesale.
rmSync(OUTPUT, { recursive: true, force: true });
for (const path of DISTRIBUTION_FILES) {
    const destination = resolve(OUTPUT, path);
    mkdirSync(dirname(destination), { recursive: true });
    copyFileSync(resolve(ROOT, path), destination);
}
writeJson('openapi/vindhem.json', contract);
writeFileSync(resolve(OUTPUT, 'release-notes.md'), `# Vindhem Specification ${releaseSection.trim()}\n`);

const groups = contract.tags.map(({ name, description }) => ({ name, description, operations: [] }));
for (const [path, pathItem] of Object.entries(contract.paths)) {
    for (const [method, operation] of Object.entries(pathItem)) {
        if (!METHODS.has(method)) continue;
        for (const tag of operation.tags ?? []) {
            const group = groups.find(({ name }) => name === tag);
            if (!group) throw new Error(`Undeclared operation tag: ${tag}`);
            group.operations.push({
                operationId: operation.operationId,
                method: method.toUpperCase(),
                path,
                summary: operation.summary,
            });
        }
    }
}
writeJson('operations.json', { operationCount: source.operationCount, groups });

// Validate the published paths too, not just the source checkout.
validate(resolve(OUTPUT, OPENAPI));
validate(resolve(OUTPUT, 'openapi/vindhem.json'));

const reader = renderSpecificationReader({ root: ROOT, output: OUTPUT, contract, portable, revision: specificationRevision });
const files = [...DISTRIBUTION_FILES, 'openapi/vindhem.json', 'operations.json', 'release-notes.md', ...reader.files].map((path) => {
    const bytes = readFileSync(resolve(OUTPUT, path));
    return { path, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
});
writeJson('publication.json', {
    format: 'vindhem.specification-site',
    formatVersion: 1,
    title: 'Vindhem Specification',
    apiVersion: contract.info.version,
    openApiVersion: contract.openapi,
    portableLibraryVersion: portable.properties.version.const,
    specificationTag: sourceMatchesTag ? tag : null,
    specificationRevision,
    readerRevision: git('rev-parse', 'HEAD'),
    workingTreeDirty: workingTreeStatus === null ? null : workingTreeStatus.length > 0,
    overview: 'index.html',
    openapi: { yaml: OPENAPI, json: 'openapi/vindhem.json' },
    portableSchema: SCHEMA,
    operationIndex: 'operations.json',
    releaseNotes: 'release-notes.md',
    license: 'LICENSE',
    files,
});

process.stdout.write(`Prepared ${files.length + 1} static files: ${OUTPUT}\n`);
process.stdout.write(`${source.operationCount} operations; YAML, JSON, and local references validated. Nothing published.\n`);
process.stdout.write(`${reader.schemaCount} definitions; full written rules and portable format rendered.\n`);
