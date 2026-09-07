import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { parseDocument } from 'yaml';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path) => readFileSync(resolve(root, path), 'utf8');
const apiDocument = parseDocument(read('openapi/vindhem.yaml'), { uniqueKeys: true });
assert.equal(apiDocument.errors.length, 0, 'OpenAPI must parse without duplicate keys');
const api = apiDocument.toJS();
const portable = JSON.parse(read('schema/library-v1.schema.json'));
const metadata = JSON.parse(read('package.json'));
assert.equal(api.info.title, 'Vindhem Specification');
assert.equal(api.info.version, '0.1.2');
assert.equal(metadata.version, api.info.version);

const ajv = new Ajv2020({ strict: false, allErrors: true });
addFormats(ajv);
ajv.addFormat('binary', true);
const apiId = 'https://vindhem.invalid/openapi/vindhem.yaml';
const portableId = 'https://vindhem.invalid/schema/library-v1.schema.json';
ajv.addSchema(portable, portableId);
ajv.addSchema(api, apiId);
for (const name of Object.keys(api.components.schemas)) {
    const pointer = name.replace(/~/g, '~0').replace(/\//g, '~1');
    ajv.compile({ $ref: `${apiId}#/components/schemas/${pointer}` });
}
const validateLibrary = ajv.getSchema(portableId);
assert(validateLibrary, 'Portable schema is available');
const example = JSON.parse(read('examples/minimal-library/vindhem.library.json'));
assert(validateLibrary(example), JSON.stringify(validateLibrary.errors));

const documents = [
    'README.md', 'CHANGELOG.md', 'AGENTS.md',
    'spec/README.md', 'spec/vindhem.md', 'spec/library-format.md',
    'page/README.md',
];
let jsonExamples = 0;
let localLinks = 0;
for (const file of documents) {
    const source = read(file);
    for (const match of source.matchAll(/```json\s*\n([\s\S]*?)\n```/g)) {
        const value = JSON.parse(match[1]);
        if (value?.format === 'vindhem.music-library') {
            assert(validateLibrary(value), `${file}: ${JSON.stringify(validateLibrary.errors)}`);
        }
        jsonExamples++;
    }
    const prose = source.replace(/```[\s\S]*?```/g, '');
    for (const match of prose.matchAll(/\]\(([^\s)]+)\)/g)) {
        const target = match[1];
        if (/^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith('#')) continue;
        const path = resolve(root, dirname(file), decodeURIComponent(target.split('#')[0]));
        assert(existsSync(path), `${file}: missing link ${target}`);
        localLinks++;
    }
}

const rules = read('spec/vindhem.md');
assert(rules.includes('version `0.1.2`'));
assert(rules.includes('patch and minor releases may both break compatibility'));
assert(!rules.includes('0.2.0') && !read('spec/README.md').includes('0.2.0'));
assert(!read('openapi/vindhem.yaml').includes('music-library-core.yaml'));
process.stdout.write(`Documents: ${Object.keys(api.components.schemas).length} schemas compiled, minimal library and ${jsonExamples} JSON examples checked, ${localLinks} local links resolved. No runtime or website was tested.\n`);
