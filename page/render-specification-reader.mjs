import { readFileSync, writeFileSync, copyFileSync } from 'node:fs';
import { resolve, posix } from 'node:path';
import { Marked } from 'marked';

const escape = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const slug = (value) => String(value).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const methods = new Set(['get', 'post', 'put', 'patch', 'delete', 'head', 'options', 'trace']);
const json = (value) => escape(JSON.stringify(value, null, 2));

export function renderSpecificationReader({ root, output, contract, portable, revision }) {
    const headings = [];
    function markdown(text, prefix = '', source = 'openapi/vindhem.yaml') {
        const usedIds = new Map();
        const parser = new Marked({
            renderer: {
                html: ({ text: html }) => escape(html),
                image: ({ text: alt }) => escape(alt),
                heading({ tokens, depth, text: title }) {
                    if (prefix && depth === 1) return '';
                    const base = `${prefix}-${slug(title)}`;
                    const count = usedIds.get(base) ?? 0;
                    usedIds.set(base, count + 1);
                    const id = count ? `${base}-${count}` : base;
                    const level = Math.min(depth + (prefix ? 1 : 0), 6);
                    if (prefix && depth === 2) headings.push({ prefix, id, title });
                    return `<h${level}${prefix ? ` id="${id}"` : ''}>${this.parser.parseInline(tokens)}</h${level}>`;
                },
                link({ href, tokens }) {
                    if (/^(?:javascript|data|vbscript):/i.test(href)) return this.parser.parseInline(tokens);
                    let url = href;
                    if (!/^(?:[a-z]+:|\/\/|#)/i.test(href)) {
                        url = posix.normalize(posix.join(posix.dirname(source), href));
                        if (url === 'spec/vindhem.md') url = '#rules';
                        if (url === 'spec/library-format.md') url = '#portable';
                    }
                    return `<a href="${escape(url)}">${this.parser.parseInline(tokens)}</a>`;
                },
            },
        });
        return parser.parse(text ?? '');
    }

    function referenceTarget(ref, portableContext = false) {
        const portableSource = '../schema/library-v1.schema.json';
        let fragment = ref;
        if (ref === portableSource || ref.startsWith(`${portableSource}#`)) {
            portableContext = true;
            fragment = ref.slice(portableSource.length);
        } else if (!ref.startsWith('#')) {
            throw new Error(`Reader needs a document for ${ref}`);
        }
        const pointer = decodeURIComponent(fragment.replace(/^#/, ''));
        if (pointer && !pointer.startsWith('/')) throw new Error(`Reader needs a JSON Pointer for ${ref}`);
        const parts = pointer ? pointer.slice(1).split('/').map((part) => part.replace(/~1/g, '/').replace(/~0/g, '~')) : [];
        const target = parts.reduce((node, key) => node !== null && typeof node === 'object' && Object.hasOwn(node, key) ? node[key] : undefined, portableContext ? portable : contract);
        if (target === undefined) throw new Error(`Missing reference: ${ref}`);
        return { target, portableContext, parts };
    }

    function resolveSchema(value, portableContext = false, seen = new Set()) {
        if (!value?.$ref) return { schema: value ?? {}, portableContext };
        const key = `${portableContext}:${value.$ref}`;
        if (seen.has(key)) throw new Error(`Circular schema alias: ${value.$ref}`);
        seen.add(key);
        const reference = referenceTarget(value.$ref, portableContext);
        const resolved = resolveSchema(reference.target, reference.portableContext, seen);
        const { $ref, ...siblings } = value;
        return {
            schema: resolved.schema === false ? false : { ...resolved.schema, ...siblings },
            portableContext: resolved.portableContext,
        };
    }

    function dereference(value) {
        return resolveSchema(value).schema;
    }

    function referenceLink(ref, portableContext = false) {
        const reference = referenceTarget(ref, portableContext);
        const { parts } = reference;
        const label = (name, remaining) => [name, ...remaining.filter((part) => part !== 'properties')].join('.');
        if (!reference.portableContext && parts[0] === 'components' && parts[1] === 'schemas') {
            const name = parts[2];
            return `<a href="#schema-${escape(name)}">${escape(label(name, parts.slice(3)))}</a>`;
        }
        if (reference.portableContext) {
            if (parts[0] === '$defs') {
                const name = parts[1];
                return `<a href="#portable-${escape(name)}">${escape(label(name, parts.slice(2)))}</a>`;
            }
            return `<a href="#portable-schema">${escape(label('Portable Library', parts))}</a>`;
        }
        throw new Error(`Reader needs a link target for ${ref}`);
    }

    function schemaType(schema, portableContext = false) {
        if (schema === true) return 'Any JSON value';
        if (schema === false) return 'No value permitted';
        if (!schema) return 'Unspecified';
        if (schema.$ref) return referenceLink(schema.$ref, portableContext);
        if (schema.const !== undefined) return `<code>${escape(JSON.stringify(schema.const))}</code>`;
        if (schema.oneOf || schema.anyOf) {
            return `${schema.oneOf ? 'Exactly one of' : 'Any of'}<span class="type-alternatives">${(schema.oneOf ?? schema.anyOf).map((s) => schemaType(s, portableContext)).join('<br>')}</span>`;
        }
        if (schema.allOf) return `All of<span class="type-alternatives">${schema.allOf.map((s) => schemaType(s, portableContext)).join('<br>')}</span>`;
        if (schema.type === 'array') return `${schemaType(schema.items, portableContext)}[]`;
        return escape(Array.isArray(schema.type) ? schema.type.join(' or ') : schema.type ?? 'JSON value');
    }

    function constraints(schema = {}) {
        const labels = {
            format: 'Format', minimum: 'Minimum', maximum: 'Maximum', exclusiveMinimum: 'Greater than',
            exclusiveMaximum: 'Less than', minLength: 'Minimum length', maxLength: 'Maximum length',
            minItems: 'Minimum items', maxItems: 'Maximum items', minProperties: 'Minimum properties',
            maxProperties: 'Maximum properties', multipleOf: 'Multiple of', pattern: 'Pattern',
            default: 'Default', uniqueItems: 'Unique items', readOnly: 'Read only', writeOnly: 'Write only',
            deprecated: 'Deprecated', contentEncoding: 'Encoding', contentMediaType: 'Media type',
        };
        const entries = Object.entries(labels).filter(([key]) => schema[key] !== undefined)
            .map(([key, label]) => `<span>${label}: <code>${escape(typeof schema[key] === 'object' ? JSON.stringify(schema[key]) : schema[key])}</code></span>`);
        if (schema.enum) entries.unshift(`<span>Allowed: ${schema.enum.map((v) => `<code>${escape(JSON.stringify(v))}</code>`).join(', ')}</span>`);
        if (schema.additionalProperties === false) entries.push('<span>Additional properties are not allowed.</span>');
        if (schema.additionalProperties === true) entries.push('<span>Additional properties are allowed.</span>');
        return entries.length ? `<div class="constraints">${entries.join('')}</div>` : '';
    }

    function schemaBody(schema, portableContext = false) {
        const resolution = resolveSchema(schema, portableContext);
        const resolved = resolution.schema;
        portableContext = resolution.portableContext;
        if (typeof resolved !== 'object' || resolved === null) return schemaType(resolved, portableContext);
        const properties = Object.entries(resolved.properties ?? {});
        const rows = properties.map(([name, definition]) => `<tr><td><code>${escape(name)}</code>${resolved.required?.includes(name) ? '<small>required</small>' : '<small>optional</small>'}</td><td>${schemaType(definition, portableContext)}</td><td>${markdown(definition.description ?? '')}${constraints(definition)}</td></tr>`).join('');
        return `${markdown(resolved.description ?? '')}${constraints(resolved)}${properties.length ? `<table class="fields"><thead><tr><th>Field</th><th>Type</th><th>Definition</th></tr></thead><tbody>${rows}</tbody></table>` : `<p class="schema-type">${schemaType(resolved, portableContext)}</p>`}
            ${properties.length && (resolved.oneOf || resolved.anyOf || resolved.allOf) ? `<div class="composition">${schemaType(resolved, portableContext)}</div>` : ''}
            ${resolved.not ? `<div class="constraint-rule"><em>Must not match</em><pre>${json(resolved.not)}</pre></div>` : ''}
            ${resolved.discriminator ? `<p class="constraint-rule">Discriminator: <code>${escape(resolved.discriminator.propertyName)}</code></p>` : ''}`;
    }

    const rawSchema = (schema) => `<details class="raw"><summary>Complete JSON Schema</summary><pre>${json(schema)}</pre></details>`;

    function parameters(items) {
        if (!items.length) return '';
        return `<table class="fields parameters"><thead><tr><th>Name</th><th>Type</th><th>Definition</th></tr></thead><tbody>${items.map((p) => `<tr><td><code>${escape(p.name)}</code><small>${escape(p.in)}${p.in === 'response header' ? '' : p.required ? ' (required)' : ' (optional)'}</small></td><td>${schemaType(p.schema)}</td><td>${markdown(p.description ?? '')}${constraints(p.schema)}${p.deprecated ? '<span>Deprecated</span>' : ''}</td></tr>`).join('')}</tbody></table>`;
    }

    function response(status, original) {
        const value = dereference(original);
        const headers = Object.entries(value.headers ?? {}).map(([name, h]) => ({ ...dereference(h), name, in: 'response header' }));
        return `<section class="response"><h5><span>${escape(status)}</span> ${markdown(value.description).replace(/^<p>|<\/p>\n?$/g, '')}</h5>
            ${Object.entries(value.content ?? {}).map(([media, body]) => `<div class="response-type"><span>${escape(media)}</span>${schemaType(body.schema)}</div>${body.schema?.$ref ? '' : schemaBody(body.schema)}${body.example !== undefined ? `<pre>${json(body.example)}</pre>` : ''}`).join('')}
            ${headers.length ? `<details><summary>Response headers (${headers.length})</summary>${parameters(headers)}</details>` : ''}</section>`;
    }

    function requestTemplate(path, method, operation, params) {
        const variableFor = (parameter) => {
            const name = parameter.name.replace(/[A-Z]/g, (c) => `_${c}`).toUpperCase();
            return parameter.schema?.$ref === '#/components/schemas/PathIdToken' ? `${name}_TOKEN` : name;
        };
        const lines = [method === 'head' ? 'curl --head' : `curl --request ${method.toUpperCase()}`];
        const pathname = path.replace(/\{([^}]+)\}/g, (_, name) => `$${variableFor(params.find((p) => p.in === 'path' && p.name === name) ?? { name })}`);
        lines.push(`  "\${VINDHEM_URL}${pathname}"`);
        const requiredQuery = params.filter((p) => p.in === 'query' && p.required);
        if (requiredQuery.length) {
            if (method !== 'get') throw new Error(`Add a non-GET query template for ${operation.operationId}`);
            lines.push('  --get');
            for (const p of requiredQuery) {
                const variable = variableFor(p);
                lines.push(`  --data-urlencode "${p.name}=$${variable}"`);
            }
        }
        if ((operation.security ?? contract.security ?? []).length) lines.push('  --header "Authorization: Bearer $VINDHEM_TOKEN"');
        for (const p of params.filter((p) => p.in === 'header' && p.required)) {
            const variable = { 'If-Match': 'LIBRARY_ETAG', 'If-Library-Match': 'LIBRARY_ETAG', 'If-Draft-Match': 'DRAFT_ETAG', 'Idempotency-Key': 'IDEMPOTENCY_KEY' }[p.name] ?? p.name.toUpperCase().replace(/[^A-Z0-9]/g, '_');
            lines.push(`  --header "${p.name}: $${variable}"`);
        }
        const body = operation.requestBody ? dereference(operation.requestBody) : null;
        if (body) {
            const media = Object.keys(body.content)[0];
            lines.push(`  --header "Content-Type: ${media}"`);
            lines.push(`  --data-binary @${media.includes('json') ? 'request.json' : 'request-body'}`);
        }
        return lines.join(' \\\n');
    }

    const groups = contract.tags.map((tag) => ({ ...tag, operations: [] }));
    for (const [path, item] of Object.entries(contract.paths)) {
        for (const [method, operation] of Object.entries(item)) {
            if (!methods.has(method)) continue;
            groups.find((group) => group.name === operation.tags[0]).operations.push({ path, method, operation, item });
        }
    }
    const operationCount = groups.reduce((n, g) => n + g.operations.length, 0);

    function operationMarkup({ path, method, operation, item }, number) {
        const combined = [...(item.parameters ?? []), ...(operation.parameters ?? [])].map(dereference);
        const params = [...new Map(combined.map((p) => [`${p.in}:${p.name}`, p])).values()];
        const body = operation.requestBody ? dereference(operation.requestBody) : null;
        const successes = Object.entries(operation.responses).filter(([status]) => /^[23]/.test(status));
        const errors = Object.entries(operation.responses).filter(([status]) => !/^[23]/.test(status));
        const endpoint = escape(path).replace(/\//g, '/<wbr>');
        return `<article class="operation" id="op-${escape(operation.operationId)}" data-operation="${escape(operation.operationId)}">
            <header class="operation-heading"><h4><span class="section-number">${number}</span>${escape(operation.summary)}</h4></header>
            <div class="endpoint"><div class="endpoint-address"><span>${method.toUpperCase()}</span><code>${endpoint}</code></div><div class="operation-meta"><span>Operation ID</span><a class="operation-id" href="#op-${escape(operation.operationId)}">${escape(operation.operationId)}</a></div></div>
            ${operation.description ? `<div class="operation-description prose">${markdown(operation.description)}</div>` : ''}
            <div class="operation-spread"><div><p class="auth-note">Authentication: ${(operation.security ?? contract.security ?? []).length ? 'Bearer token' : 'None'}</p>
                ${params.length ? `<h5>Parameters</h5>${parameters(params)}` : '<p class="secondary">No parameters.</p>'}
                ${body ? `<h5>Request body <span class="requirement">(${body.required ? 'required' : 'optional'})</span></h5>${markdown(body.description ?? '')}${Object.entries(body.content).map(([media, entry]) => `<p class="media-label"><code>${escape(media)}</code><span>${schemaType(entry.schema)}</span></p>${schemaBody(entry.schema)}${rawSchema(entry.schema)}`).join('')}` : ''}
            </div><aside class="examples"><div class="example-title"><span>Request template</span><span>cURL</span></div><pre>${escape(requestTemplate(path, method, operation, params))}</pre>
                <h5>Response</h5>${successes.map(([status, value]) => response(status, value)).join('')}
                ${errors.length ? `<details class="errors"><summary>Errors (${errors.length})</summary>${errors.map(([status, value]) => response(status, value)).join('')}</details>` : ''}
            </aside></div></article>`;
    }

    const rules = markdown(readFileSync(resolve(root, 'spec/vindhem.md'), 'utf8'), 'rule', 'spec/vindhem.md');
    const portableRules = markdown(readFileSync(resolve(root, 'spec/library-format.md'), 'utf8'), 'format', 'spec/library-format.md');
    const sectionNav = (prefix) => headings.filter((h) => h.prefix === prefix).map((h) => `<a href="#${h.id}">${escape(h.title.replace(/^\d+\.\s*/, ''))}</a>`).join('');
    const groupIndex = groups.map((g, i) => `<a href="#group-${slug(g.name)}"><span>${String(i + 1).padStart(2, '0')}</span>${escape(g.name)}<small>${g.operations.length}</small></a>`).join('');
    const groupMarkup = groups.map((g, i) => `<section class="api-group" id="group-${slug(g.name)}" data-section><header class="group-heading"><span class="section-number">${String(i + 1).padStart(2, '0')}</span><div><h3>${escape(g.name)}</h3><p>${escape(g.description)}</p></div></header>${g.operations.map((o, j) => operationMarkup(o, `${i + 1}.${j + 1}`)).join('')}</section>`).join('');
    const schemas = Object.entries(contract.components.schemas);
    const schemaMarkup = schemas.map(([name, schema]) => `<article class="schema" id="schema-${escape(name)}" data-schema="${escape(name)}"><h3><a href="#schema-${escape(name)}">${escape(name)}</a></h3>${schema.$ref ? `<p class="schema-type">Defined by ${schemaType(schema)}</p>` : ''}${schemaBody(schema)}${rawSchema(schema)}</article>`).join('');
    const portableMarkup = [['schema', portable], ...Object.entries(portable.$defs ?? {})].map(([name, schema]) => `<article class="schema" id="portable-${escape(name)}"><h3>${name === 'schema' ? 'Portable Library schema' : escape(name)}</h3>${schemaBody(schema, true)}${rawSchema(schema)}</article>`).join('');

    const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="dark"><meta name="description" content="The Vindhem music-library specification: complete API reference, schemas, system rules and portable library format."><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'none'; connect-src 'none'"><title>Vindhem Specification</title><link rel="stylesheet" href="reader.css"><script src="reader.js" defer></script></head>
<body><a class="skip-link" href="#rules">Skip to specification</a><div class="book">
<header class="masthead" id="top"><div class="running-head"><a class="repository-link" href="https://github.com/Hallmane/vindhem">GitHub repository ↗</a><span>Specification / ${escape(contract.info.version)}${contract.info.version.startsWith('0.') ? ' · Development release' : ''}</span></div><div class="title-spread"><h1>Vindhem</h1><div class="edition">OpenAPI ${escape(contract.openapi)} · JSON Schema</div></div>
<div class="download-line"><a href="openapi/vindhem.yaml" download>OpenAPI YAML ↓</a><a href="openapi/vindhem.json" download>JSON ↓</a><a href="schema/library-v1.schema.json" download>Portable schema ↓</a></div></header>
<div class="document-layout"><nav class="contents" aria-label="Contents"><a class="contents-title" href="#top">Contents</a><details open><summary><a href="#rules">I. The specification</a></summary>${sectionNav('rule')}</details><details open><summary><a href="#api">II. API reference</a></summary>${groups.map((g) => `<a href="#group-${slug(g.name)}">${escape(g.name)}</a>`).join('')}</details><details><summary><a href="#types">III. Definitions</a></summary>${schemas.map(([name]) => `<a href="#schema-${escape(name)}">${escape(name)}</a>`).join('')}</details><details><summary><a href="#portable">IV. Portable Library</a></summary>${sectionNav('format')}<a href="#portable-schema">JSON Schema</a></details><a class="back-top" href="#top">Back to beginning ↑</a></nav>
<main><section class="chapter" id="rules" data-section><div class="chapter-label">I / The specification</div><h2>Vindhem Specification</h2><div class="prose rules">${rules}</div></section>
<section class="chapter" id="api" data-section><div class="chapter-label">II / API reference</div><h2>API reference</h2><div class="group-index">${groupIndex}</div><div class="api-conventions"><h3>Authentication</h3>${markdown(contract.components.securitySchemes.CoreBearer.description)}<p>Request templates require <code>VINDHEM_URL</code>, <code>VINDHEM_TOKEN</code>, resource IDs and body files matching the request schema. This page makes no API calls.</p>${contract.components.schemas.PathIdToken ? '<p>Resource variables such as <code>TRACK_ID_TOKEN</code> contain encoded <a href="#schema-PathIdToken">URI tokens</a>; JSON bodies retain raw IDs. Set <code>LIBRARY_ETAG</code> from <code>X-Library-ETag</code> and <code>DRAFT_ETAG</code> from <code>X-Draft-ETag</code>.</p>' : ''}<details><summary>OpenAPI preamble and common rules</summary><div class="prose">${markdown(contract.info.description)}</div></details></div>${groupMarkup}</section>
<section class="chapter" id="types" data-section><div class="chapter-label">III / Definitions</div><h2>Definitions</h2><details class="type-index"><summary>All definitions</summary><div>${schemas.map(([name]) => `<a href="#schema-${escape(name)}">${escape(name)}</a>`).join('')}</div></details>${schemaMarkup}</section>
<section class="chapter" id="portable" data-section><div class="chapter-label">IV / Portable Library</div><h2>Portable Library</h2><div class="prose">${portableRules}</div>${portableMarkup}</section>
<footer class="colophon"><p>Vindhem Specification ${escape(contract.info.version)}</p><p>${revision ? `Specification revision <code>${escape(revision.slice(0, 12))}</code>. ` : ''}<a href="publication.json">Publication record</a> · <a href="release-notes.md">Release notes</a> · <a href="spec/vindhem.md">Written rules</a> · <a href="spec/library-format.md">Portable format</a> · <a href="LICENSE">Licence</a></p></footer></main></div></div></body></html>`;
    writeFileSync(resolve(output, 'index.html'), html.replace(/^[\t ]+$/gm, ''));
    for (const name of ['reader.css', 'reader.js']) copyFileSync(resolve(root, 'page', name), resolve(output, name));
    return { files: ['index.html', 'reader.css', 'reader.js'], operationCount, schemaCount: schemas.length };
}
