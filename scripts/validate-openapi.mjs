import { readFileSync } from 'node:fs';
import { dirname, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseDocument } from 'yaml';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const CANONICAL_OPENAPI_PATH = resolve(ROOT, 'openapi/vindhem.yaml');

const HTTP_METHODS = new Set(['get', 'post', 'put', 'patch', 'delete', 'head']);
const READ_LIKE_POSTS = new Set(['lookupLibraryObjects', 'resolveTrackMedia']);
const CONTRACT_PROFILES = [
    {
        version: /^0\.1\.2$/, count: 79, prefix: '/api/v2',
        libraryMatch: 'If-Library-Match', draftHeader: 'X-Draft-ETag', current: true,
    },
];

const CANONICAL_LIBRARY_MUTATIONS = new Set([
    'updateLibrary',
    'deleteLibrary',
    'createTrack',
    'replaceTrackOrder',
    'updateTrack',
    'deleteTrack',
    'createArtist',
    'updateArtist',
    'deleteArtist',
    'createAlbum',
    'updateAlbum',
    'deleteAlbum',
    'createCollection',
    'replaceCollectionSiblingOrder',
    'updateCollection',
    'deleteCollection',
    'appendCollectionEntries',
    'replaceCollectionEntryOrder',
    'moveCollectionEntries',
    'updateCollectionEntry',
    'deleteCollectionEntry',
    'commitImportBatch',
    'createCompanionObject',
    'deleteCompanionObject',
    'deleteAttachment',
    'replaceAttachmentOrder',
    'moveAttachment',
    'commitEditBatch',
    'commitLibraryTransaction',
]);

const DRAFT_MUTATIONS = new Set([
    'putImportManifest',
    'uploadImportItem',
    'discardImportItem',
    'replaceImportProposal',
    'commitImportBatch',
    'cancelImportBatch',
    'replaceEditBatchOperations',
    'rebaseEditBatch',
    'commitEditBatch',
    'cancelEditBatch',
]);

const DRAFT_READS = new Set(['getImportBatch', 'getEditBatch']);
const DRAFT_CREATORS = new Set(['createImportBatch', 'createEditBatch']);

const RULES = {
    document: 'document',
    operations: 'operations',
    references: 'references',
    schemas: 'schemas',
    mutations: 'mutations',
    errors: 'errors',
    companion: 'companion',
    attachment: 'attachment',
    title: 'title',
    drafts: 'drafts',
    history: 'history',
};

function isObject(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function finding(rule, message) {
    return { rule, message };
}

function pointerPart(value) {
    return decodeURIComponent(value).replace(/~1/g, '/').replace(/~0/g, '~');
}

function loadDocument(filePath, cache) {
    const absolutePath = resolve(filePath);
    const cached = cache.get(absolutePath);
    if (cached) return cached;

    const raw = readFileSync(absolutePath, 'utf8');
    let value;
    if (extname(absolutePath) === '.json') {
        value = JSON.parse(raw);
    } else {
        const parsed = parseDocument(raw, { prettyErrors: true, uniqueKeys: true });
        if (parsed.errors.length > 0) {
            throw new Error(parsed.errors.map((error) => error.message).join('\n'));
        }
        value = parsed.toJS();
    }
    if (!isObject(value)) throw new Error(`${absolutePath} must contain an object document`);

    const loaded = { filePath: absolutePath, raw, value };
    cache.set(absolutePath, loaded);
    return loaded;
}

function resolveReference(reference, fromFile, cache) {
    const hashIndex = reference.indexOf('#');
    const filePart = hashIndex === -1 ? reference : reference.slice(0, hashIndex);
    const fragment = hashIndex === -1 ? '' : reference.slice(hashIndex + 1);
    if (/^[a-z][a-z0-9+.-]*:/i.test(filePart)) {
        throw new Error(`remote reference is not resolvable locally: ${reference}`);
    }

    const targetFile = filePart.length > 0
        ? resolve(dirname(fromFile), decodeURIComponent(filePart))
        : fromFile;
    const targetDocument = loadDocument(targetFile, cache);
    let target = targetDocument.value;
    if (fragment.length > 0) {
        if (!fragment.startsWith('/')) throw new Error(`unsupported fragment in ${reference}`);
        for (const part of fragment.slice(1).split('/').map(pointerPart)) {
            if (!isObject(target) && !Array.isArray(target)) {
                throw new Error(`unresolved reference ${reference}`);
            }
            target = target[part];
            if (target === undefined) throw new Error(`unresolved reference ${reference}`);
        }
    }
    return { filePath: targetFile, fragment, value: target };
}

function resolvedObject(value, fromFile, cache, label) {
    let current = value;
    let currentFile = fromFile;
    const seen = new Set();
    while (isObject(current) && typeof current.$ref === 'string') {
        const key = `${currentFile}\u0000${current.$ref}`;
        if (seen.has(key)) throw new Error(`${label} contains a reference cycle`);
        seen.add(key);
        const resolved = resolveReference(current.$ref, currentFile, cache);
        current = resolved.value;
        currentFile = resolved.filePath;
    }
    if (!isObject(current)) throw new Error(`${label} must resolve to an object`);
    return { filePath: currentFile, value: current };
}

function collectOperations(document, findings, profile) {
    if (!isObject(document.paths)) {
        findings.push(finding(RULES.document, 'paths must be an object'));
        return [];
    }

    const operations = [];
    const ids = new Map();
    const normalizedRoutes = new Map();
    for (const [path, pathItem] of Object.entries(document.paths)) {
        if (!path.startsWith('/')) {
            findings.push(finding(RULES.operations, `path must start with /: ${path}`));
        }
        if (path.startsWith('/api/') && !path.startsWith(`${profile.prefix}/`)) {
            findings.push(finding(RULES.operations, `contract ${document.info.version} must use ${profile.prefix} routes: ${path}`));
        }
        if (!isObject(pathItem)) continue;
        for (const [method, operation] of Object.entries(pathItem)) {
            if (!HTTP_METHODS.has(method)) continue;
            if (!isObject(operation) || typeof operation.operationId !== 'string') {
                findings.push(finding(RULES.operations, `${method.toUpperCase()} ${path} has no operationId`));
                continue;
            }
            const record = { method, path, pathItem, operation, operationId: operation.operationId };
            operations.push(record);

            const previousId = ids.get(record.operationId);
            if (previousId) {
                findings.push(finding(
                    RULES.operations,
                    `duplicate operationId ${record.operationId}: ${previousId.method.toUpperCase()} ${previousId.path} and ${method.toUpperCase()} ${path}`,
                ));
            } else {
                ids.set(record.operationId, record);
            }

            const normalizedPath = path.replace(/\{[^}]+\}/g, '{}');
            const routeKey = `${method.toUpperCase()} ${normalizedPath}`;
            const previousRoute = normalizedRoutes.get(routeKey);
            if (previousRoute) {
                findings.push(finding(
                    RULES.operations,
                    `ambiguous operation path ${method.toUpperCase()} ${path} overlaps ${previousRoute.path}`,
                ));
            } else {
                normalizedRoutes.set(routeKey, record);
            }
        }
    }

    if (operations.length !== profile.count) {
        findings.push(finding(RULES.operations, `expected exactly ${profile.count} operations, found ${operations.length}`));
    }
    if (ids.size !== profile.count) {
        findings.push(finding(RULES.operations, `expected exactly ${profile.count} unique operationIds, found ${ids.size}`));
    }
    return operations;
}

function walkReferences(value, filePath, cache, findings, visited, location = '$') {
    if (Array.isArray(value)) {
        value.forEach((child, index) => walkReferences(
            child,
            filePath,
            cache,
            findings,
            visited,
            `${location}[${index}]`,
        ));
        return;
    }
    if (!isObject(value)) return;

    if (typeof value.$ref === 'string') {
        try {
            const resolved = resolveReference(value.$ref, filePath, cache);
            const key = `${resolved.filePath}#${resolved.fragment}`;
            if (!visited.has(key)) {
                visited.add(key);
                walkReferences(
                    resolved.value,
                    resolved.filePath,
                    cache,
                    findings,
                    visited,
                    `${location} -> ${value.$ref}`,
                );
            }
        } catch (error) {
            findings.push(finding(RULES.references, `${location}: ${error.message}`));
        }
    }

    for (const [key, child] of Object.entries(value)) {
        if (key === '$ref') continue;
        walkReferences(child, filePath, cache, findings, visited, `${location}.${key}`);
    }
}

function operationParameters(record, filePath, cache, findings) {
    const parameters = [];
    for (const source of [record.pathItem.parameters, record.operation.parameters]) {
        if (source === undefined) continue;
        if (!Array.isArray(source)) {
            findings.push(finding(RULES.schemas, `${record.operationId} parameters must be an array`));
            continue;
        }
        for (const rawParameter of source) {
            try {
                parameters.push(resolvedObject(
                    rawParameter,
                    filePath,
                    cache,
                    `${record.operationId} parameter`,
                ).value);
            } catch (error) {
                findings.push(finding(RULES.references, `${record.operationId}: ${error.message}`));
            }
        }
    }
    return parameters;
}

function parameterNamed(parameters, location, name) {
    return parameters.find((parameter) => (
        parameter.in === location
        && typeof parameter.name === 'string'
        && parameter.name.toLowerCase() === name.toLowerCase()
    ));
}

function validatePathParameters(record, parameters, findings) {
    const placeholders = [...record.path.matchAll(/\{([^}]+)\}/g)].map((match) => match[1]);
    const pathParameters = parameters.filter((parameter) => parameter.in === 'path');
    for (const placeholder of placeholders) {
        const parameter = parameterNamed(pathParameters, 'path', placeholder);
        if (!parameter) {
            findings.push(finding(RULES.operations, `${record.operationId} has no path parameter for {${placeholder}}`));
        } else if (parameter.required !== true) {
            findings.push(finding(RULES.operations, `${record.operationId} path parameter ${placeholder} is not required`));
        }
    }
    for (const parameter of pathParameters) {
        if (typeof parameter.name === 'string' && !placeholders.includes(parameter.name)) {
            findings.push(finding(
                RULES.operations,
                `${record.operationId} declares unused path parameter ${parameter.name}`,
            ));
        }
    }
}

function validateOperationSchemas(record, filePath, cache, findings, profile) {
    if (record.operation.requestBody !== undefined) {
        try {
            const requestBody = resolvedObject(
                record.operation.requestBody,
                filePath,
                cache,
                `${record.operationId} requestBody`,
            ).value;
            if (!isObject(requestBody.content) || Object.keys(requestBody.content).length === 0) {
                findings.push(finding(RULES.schemas, `${record.operationId} requestBody has no content`));
            } else {
                for (const [mediaType, media] of Object.entries(requestBody.content)) {
                    if (!isObject(media) || !isObject(media.schema)) {
                        findings.push(finding(
                            RULES.schemas,
                            `${record.operationId} request media ${mediaType} has no schema`,
                        ));
                    }
                }
            }
        } catch (error) {
            findings.push(finding(RULES.references, `${record.operationId}: ${error.message}`));
        }
    }

    if (!isObject(record.operation.responses) || Object.keys(record.operation.responses).length === 0) {
        findings.push(finding(RULES.schemas, `${record.operationId} has no responses`));
        return;
    }
    for (const [status, rawResponse] of Object.entries(record.operation.responses)) {
        try {
            const response = resolvedObject(
                rawResponse,
                filePath,
                cache,
                `${record.operationId} response ${status}`,
            ).value;
            if (profile.current && record.method === 'head' && response.content !== undefined) {
                findings.push(finding(RULES.errors, `${record.operationId} response ${status} must be bodyless`));
            }
            if (response.content === undefined) continue;
            if (!isObject(response.content)) {
                findings.push(finding(RULES.schemas, `${record.operationId} response ${status} content is not an object`));
                continue;
            }
            for (const [mediaType, media] of Object.entries(response.content)) {
                if (!isObject(media) || !isObject(media.schema)) {
                    findings.push(finding(
                        RULES.schemas,
                        `${record.operationId} response ${status} media ${mediaType} has no schema`,
                    ));
                }
            }
        } catch (error) {
            findings.push(finding(RULES.references, `${record.operationId}: ${error.message}`));
        }
    }
}

function requireHeader(record, parameters, headerName, findings) {
    const parameter = parameterNamed(parameters, 'header', headerName);
    if (!parameter) {
        findings.push(finding(RULES.mutations, `${record.operationId} must require ${headerName}`));
    } else if (parameter.required !== true) {
        findings.push(finding(RULES.mutations, `${record.operationId} ${headerName} must be required`));
    }
}

function isPublicOperation(document, operation) {
    const security = operation.security ?? document.security;
    return Array.isArray(security) && security.length === 0;
}

function requireError(record, status, filePath, cache, findings, profile) {
    const responses = isObject(record.operation.responses) ? record.operation.responses : {};
    if (!(status in responses)) {
        findings.push(finding(RULES.errors, `${record.operationId} must explicitly document ${status}`));
        return;
    }
    try {
        const response = resolvedObject(
            responses[status],
            filePath,
            cache,
            `${record.operationId} response ${status}`,
        ).value;
        // The pinned 0.1 document retains its historical response shapes. New
        // HEAD responses are checked for bodylessness, never a JSON envelope.
        if (profile.current && record.method === 'head') return;
        const json = isObject(response.content) ? response.content['application/json'] : undefined;
        const rawSchema = isObject(json) ? json.schema : undefined;
        const errorSchema = resolvedObject(
            rawSchema,
            filePath,
            cache,
            `${record.operationId} response ${status} schema`,
        ).value;
        if (!requiredProperties(errorSchema).includes('error')
            || !('error' in properties(errorSchema))) {
            findings.push(finding(
                RULES.errors,
                `${record.operationId} response ${status} must use ErrorEnvelope`,
            ));
        }
    } catch {
        findings.push(finding(
            RULES.errors,
            `${record.operationId} response ${status} must use the JSON ErrorEnvelope`,
        ));
    }
}

function hasResponseHeader(response, name) {
    return isObject(response.headers)
        && Object.keys(response.headers).some((key) => key.toLowerCase() === name.toLowerCase());
}

function requireResponseHeader(record, status, name, filePath, cache, findings) {
    try {
        const response = resolvedObject(record.operation.responses?.[status], filePath, cache, `${record.operationId} ${status}`).value;
        if (hasResponseHeader(response, name)) return;
    } catch {
        // Missing responses/references are also reported by their focused checks.
    }
    findings.push(finding(RULES.errors, `${record.operationId} response ${status} must document ${name}`));
}

function validateErrors(document, record, parameters, filePath, cache, findings, profile) {
    requireError(record, 'default', filePath, cache, findings, profile);
    if (!isPublicOperation(document, record.operation)) {
        requireError(record, '401', filePath, cache, findings, profile);
    }

    const hasPrecondition = parameters.some((parameter) => (
        parameter.in === 'header'
        && typeof parameter.name === 'string'
        && /^if-(?:match|library-match|draft-match|batch-match)$/i.test(parameter.name)
    ));
    if (hasPrecondition) {
        requireError(record, '412', filePath, cache, findings, profile);
        requireError(record, '428', filePath, cache, findings, profile);
    }
    if (parameterNamed(parameters, 'header', 'Idempotency-Key')
        || parameterNamed(parameters, 'query', 'cursor')) {
        requireError(record, '409', filePath, cache, findings, profile);
    }
    if (parameterNamed(parameters, 'header', 'Range')) {
        requireError(record, '416', filePath, cache, findings, profile);
        if (profile.current) requireResponseHeader(record, '416', 'Content-Range', filePath, cache, findings);
    }
    if (record.operationId === 'uploadImportItem') {
        requireError(record, '413', filePath, cache, findings, profile);
    }
    if (profile.current) {
        if (record.operation.responses?.['401']) {
            requireResponseHeader(record, '401', 'WWW-Authenticate', filePath, cache, findings);
        }
        if (record.operationId !== 'getReadiness') {
            requireError(record, '429', filePath, cache, findings, profile);
            requireResponseHeader(record, '429', 'Retry-After', filePath, cache, findings);
        }
    }
}

function schema(document, name, findings) {
    const schemas = isObject(document.components) && isObject(document.components.schemas)
        ? document.components.schemas
        : {};
    const value = schemas[name];
    if (!isObject(value)) {
        findings.push(finding(RULES.schemas, `missing component schema ${name}`));
        return {};
    }
    return value;
}

function requiredProperties(value) {
    return Array.isArray(value.required) ? value.required : [];
}

function properties(value) {
    return isObject(value.properties) ? value.properties : {};
}

function schemaAllowsNull(value, document, filePath, cache) {
    if (!isObject(value)) return false;
    let current = value;
    try {
        current = resolvedObject(current, filePath, cache, 'nullable schema').value;
    } catch {
        return false;
    }
    if (current.type === 'null') return true;
    if (Array.isArray(current.type) && current.type.includes('null')) return true;
    for (const keyword of ['anyOf', 'oneOf']) {
        if (Array.isArray(current[keyword])
            && current[keyword].some((candidate) => schemaAllowsNull(candidate, document, filePath, cache))) {
            return true;
        }
    }
    return false;
}

function validateTitleInvariant(document, filePath, cache, findings) {
    for (const name of ['Library', 'CreateLibraryInput']) {
        const value = schema(document, name, findings);
        const title = properties(value).title;
        const optional = !requiredProperties(value).includes('title');
        if (!optional && !schemaAllowsNull(title, document, filePath, cache)) {
            findings.push(finding(
                RULES.title,
                `${name}.title must be optional or nullable because Portable Library title is optional`,
            ));
        }
    }

    const update = schema(document, 'UpdateLibraryInput', findings);
    if (!schemaAllowsNull(properties(update).title, document, filePath, cache)) {
        findings.push(finding(RULES.title, 'UpdateLibraryInput.title must accept null to clear a title'));
    }
}

function validateAttachmentInvariant(document, findings) {
    const attachment = schema(document, 'Attachment', findings);
    const required = requiredProperties(attachment);
    for (const field of ['mediaType', 'sizeBytes']) {
        if (required.includes(field)) {
            findings.push(finding(
                RULES.attachment,
                `Attachment.${field} cannot be globally required because missing attachments may not know it`,
            ));
        }
    }

    const conditionalAvailability = Array.isArray(attachment.allOf)
        && attachment.allOf.some((condition) => {
            if (!isObject(condition) || !isObject(condition.if) || !isObject(condition.then)) {
                return false;
            }
            const availability = properties(condition.if).availability;
            const availableOnly = isObject(availability)
                && (availability.const === 'available'
                    || (Array.isArray(availability.enum)
                        && availability.enum.length === 1
                        && availability.enum[0] === 'available'));
            const required = requiredProperties(condition.then);
            return availableOnly && required.includes('mediaType') && required.includes('sizeBytes');
        });
    if (!conditionalAvailability) {
        findings.push(finding(
            RULES.attachment,
            'Attachment must conditionally require mediaType and sizeBytes when availability is available',
        ));
    }
}

function hasBodyOrArtifactConstraint(value) {
    for (const keyword of ['oneOf', 'anyOf']) {
        const alternatives = value[keyword];
        if (!Array.isArray(alternatives)) continue;
        let body = false;
        let artifact = false;
        for (const alternative of alternatives) {
            if (!isObject(alternative)) continue;
            const required = requiredProperties(alternative);
            if (required.includes('body')) body = true;
            const artifactSchema = properties(alternative).artifacts;
            if (required.includes('artifacts')
                && isObject(artifactSchema)
                && Number(artifactSchema.minItems) >= 1) {
                artifact = true;
            }
        }
        if (body && artifact) return true;
    }
    return false;
}

function validateCompanionInvariant(document, filePath, cache, findings) {
    for (const name of ['CompanionObject', 'CreateCompanionObjectInput']) {
        const value = schema(document, name, findings);
        const objectProperties = properties(value);
        if ('target' in objectProperties || !isObject(objectProperties.targets)) {
            findings.push(finding(RULES.companion, `${name} must use ordered targets[], not singular target`));
        } else if (objectProperties.targets.type !== 'array' || Number(objectProperties.targets.minItems) < 1) {
            findings.push(finding(RULES.companion, `${name}.targets must be a non-empty array`));
        }
        if (!isObject(objectProperties.artifacts)) {
            findings.push(finding(RULES.companion, `${name} must preserve companion artifacts`));
        }
        if (!('producedBy' in objectProperties)) {
            findings.push(finding(RULES.companion, `${name} must preserve producedBy identity`));
        }
        if (!hasBodyOrArtifactConstraint(value)) {
            findings.push(finding(
                RULES.companion,
                `${name} must require at least an inline body or one artifact without requiring both`,
            ));
        }
    }

    const artifact = schema(document, 'CompanionArtifact', findings);
    if (!requiredProperties(artifact).includes('id') || !('id' in properties(artifact))) {
        findings.push(finding(RULES.companion, 'CompanionArtifact must preserve a stable id'));
    }

    const producer = schema(document, 'CompanionProducer', findings);
    const producerRequired = requiredProperties(producer);
    if (!producerRequired.includes('kind') || !producerRequired.includes('id')) {
        findings.push(finding(RULES.companion, 'CompanionProducer must preserve required kind and id'));
    }

    const registration = schema(document, 'RegisterCompanionTypeInput', findings);
    const bodySchema = properties(registration).bodySchema;
    let resolvedBodySchema = bodySchema;
    try {
        resolvedBodySchema = resolvedObject(
            bodySchema,
            filePath,
            cache,
            'RegisterCompanionTypeInput.bodySchema',
        ).value;
    } catch {
        // Reference resolution is reported separately; keep this rule focused.
    }
    const registrationProperties = properties(registration);
    const bodyMediaType = registrationProperties.bodyMediaType;
    const policyText = `${registration.description ?? ''} ${isObject(resolvedBodySchema) ? resolvedBodySchema.description ?? '' : ''}`.toLowerCase();
    const dialectRepresented = 'bodySchemaDialect' in properties(registration)
        || policyText.includes('2020-12');
    const refsRepresented = 'allowExternalReferences' in properties(registration)
        || (policyText.includes('external') && policyText.includes('$ref'));
    const mediaTypeRepresented = (isObject(bodyMediaType)
        && (bodyMediaType.const === 'application/json'
            || (Array.isArray(bodyMediaType.enum) && bodyMediaType.enum.includes('application/json'))))
        || policyText.includes('application/json');
    if (!dialectRepresented || !refsRepresented || !mediaTypeRepresented) {
        findings.push(finding(
            RULES.companion,
            'RegisterCompanionTypeInput must define bodySchema dialect, external $ref policy, and JSON media-type relationship',
        ));
    }
}

function hasRequiredDraftRevision(value) {
    const valueProperties = properties(value);
    return ['revision', 'draftRevision'].some((name) => (
        requiredProperties(value).includes(name) && isObject(valueProperties[name])
    ));
}

function successResponses(record, filePath, cache) {
    if (!isObject(record.operation.responses)) return [];
    return Object.entries(record.operation.responses).flatMap(([status, rawResponse]) => {
        if (!/^2\d\d$/.test(status)) return [];
        try {
            return [resolvedObject(rawResponse, filePath, cache, `${record.operationId} ${status}`).value];
        } catch {
            return [];
        }
    });
}

function hasSuccessHeader(record, header, filePath, cache) {
    return successResponses(record, filePath, cache).some((response) => (
        hasResponseHeader(response, header)
    ));
}

function validateDraftInvariant(document, operations, parameterMap, filePath, cache, findings, profile) {
    for (const name of ['ImportBatch', 'EditBatch', 'EditBatchSummary']) {
        if (!hasRequiredDraftRevision(schema(document, name, findings))) {
            findings.push(finding(RULES.drafts, `${name} must expose a required draft revision`));
        }
    }

    for (const record of operations) {
        if (!DRAFT_MUTATIONS.has(record.operationId)) continue;
        const parameters = parameterMap.get(record.operationId) ?? [];
        const conditional = parameterNamed(parameters, 'header', 'If-Draft-Match');
        if (!conditional) {
            findings.push(finding(
                RULES.drafts,
                `${record.operationId} must require If-Draft-Match`,
            ));
        } else if (conditional.required !== true) {
            findings.push(finding(RULES.drafts, `${record.operationId} If-Draft-Match must be required`));
        }
        if (!hasSuccessHeader(record, profile.draftHeader, filePath, cache)) {
            findings.push(finding(RULES.drafts, `${record.operationId} must return the resulting ${profile.draftHeader}`));
        }
    }

    for (const record of operations) {
        const draftRead = DRAFT_READS.has(record.operationId)
            || (profile.current && record.operationId === 'getImportManifest');
        if (draftRead && !hasSuccessHeader(record, profile.draftHeader, filePath, cache)) {
            findings.push(finding(RULES.drafts, `${record.operationId} must return the current ${profile.draftHeader}`));
        }
        if (DRAFT_CREATORS.has(record.operationId) && !hasSuccessHeader(record, profile.draftHeader, filePath, cache)) {
            findings.push(finding(RULES.drafts, `${record.operationId} must return the initial ${profile.draftHeader}`));
        }
    }
}

function validateHistoryInvariant(document, operations, parameterMap, filePath, cache, findings) {
    for (const name of ['Library', 'ImportBatch', 'EditBatch', 'EditBatchSummary', 'CreateEditBatchInput', 'RebaseEditBatchInput']) {
        const value = schema(document, name, findings);
        if (!requiredProperties(value).includes('historyId') || !isObject(properties(value).historyId)) {
            findings.push(finding(RULES.history, `${name} must expose a required historyId`));
        }
    }
    const snapshot = schema(document, 'LibrarySnapshot', findings);
    try {
        const library = resolvedObject(properties(snapshot).library, filePath, cache, 'LibrarySnapshot.library').value;
        if (!requiredProperties(snapshot).includes('library') || !requiredProperties(library).includes('historyId')) {
            findings.push(finding(RULES.history, 'LibrarySnapshot must include its library and hosted history'));
        }
    } catch {
        findings.push(finding(RULES.history, 'LibrarySnapshot must include its library and hosted history'));
    }
    for (const operationId of ['listLibraryChanges', 'streamLibraryChanges']) {
        const parameter = parameterNamed(parameterMap.get(operationId) ?? [], 'query', 'historyId');
        if (parameter?.required !== true) {
            findings.push(finding(RULES.history, `${operationId} must require the historyId query parameter`));
        }
    }
    for (const record of operations) {
        for (const response of successResponses(record, filePath, cache)) {
            if (hasResponseHeader(response, 'X-Library-Revision') && !hasResponseHeader(response, 'X-Library-History-ID')) {
                findings.push(finding(RULES.history, `${record.operationId} must return X-Library-History-ID with X-Library-Revision`));
            }
        }
    }
    if (!parameterMap.has('getImportManifest')) {
        findings.push(finding(RULES.operations, 'missing staged-manifest read getImportManifest'));
    }
}

export function validateOpenApi(filePath = CANONICAL_OPENAPI_PATH) {
    const cache = new Map();
    const findings = [];
    let loaded;
    try {
        loaded = loadDocument(filePath, cache);
    } catch (error) {
        return {
            filePath: resolve(filePath),
            operationCount: 0,
            findings: [finding(RULES.document, error.message)],
        };
    }

    const document = loaded.value;
    const profile = CONTRACT_PROFILES.find(({ version }) => version.test(document.info?.version ?? ''));
    if (!profile) {
        return {
            filePath: loaded.filePath,
            operationCount: 0,
            findings: [finding(RULES.document, `no static validation profile for contract ${document.info?.version ?? 'without info.version'}`)],
        };
    }
    if (typeof document.openapi !== 'string' || !/^3\.1\.\d+$/.test(document.openapi)) {
        findings.push(finding(
            RULES.document,
            `openapi must use the 3.1 line, found ${document.openapi ?? 'nothing'}`,
        ));
    }
    const operations = collectOperations(document, findings, profile);
    walkReferences(document, loaded.filePath, cache, findings, new Set());

    const parameterMap = new Map();
    for (const record of operations) {
        const parameters = operationParameters(record, loaded.filePath, cache, findings);
        parameterMap.set(record.operationId, parameters);
        validatePathParameters(record, parameters, findings);
        validateOperationSchemas(record, loaded.filePath, cache, findings, profile);

        if (CANONICAL_LIBRARY_MUTATIONS.has(record.operationId)) {
            requireHeader(record, parameters, profile.libraryMatch, findings);
            requireHeader(record, parameters, 'Idempotency-Key', findings);
        }
        if (!CANONICAL_LIBRARY_MUTATIONS.has(record.operationId)
            && !['get', 'head'].includes(record.method)
            && !READ_LIKE_POSTS.has(record.operationId)) {
            requireHeader(record, parameters, 'Idempotency-Key', findings);
        }
        validateErrors(document, record, parameters, loaded.filePath, cache, findings, profile);
    }

    for (const operationId of CANONICAL_LIBRARY_MUTATIONS) {
        if (!parameterMap.has(operationId)) {
            findings.push(finding(RULES.mutations, `missing canonical mutation ${operationId}`));
        }
    }

    validateTitleInvariant(document, loaded.filePath, cache, findings);
    validateAttachmentInvariant(document, findings);
    validateCompanionInvariant(document, loaded.filePath, cache, findings);
    validateDraftInvariant(
        document,
        operations,
        parameterMap,
        loaded.filePath,
        cache,
        findings,
        profile,
    );
    if (profile.current) validateHistoryInvariant(document, operations, parameterMap, loaded.filePath, cache, findings);

    return {
        filePath: loaded.filePath,
        operationCount: operations.length,
        findings,
    };
}

export function findingsFor(result, ...rules) {
    const selected = new Set(rules);
    return result.findings.filter(({ rule }) => selected.has(rule));
}

export { RULES };

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : '';
if (invokedPath === fileURLToPath(import.meta.url)) {
    const result = validateOpenApi(process.argv[2] ?? CANONICAL_OPENAPI_PATH);
    if (result.findings.length > 0) {
        process.stderr.write(`Vindhem OpenAPI failed ${result.findings.length} contract checks:\n`);
        const displayLimit = 80;
        for (const issue of result.findings.slice(0, displayLimit)) {
            process.stderr.write(`- [${issue.rule}] ${issue.message}\n`);
        }
        if (result.findings.length > displayLimit) {
            process.stderr.write(`- ... ${result.findings.length - displayLimit} more findings omitted\n`);
        }
        process.exitCode = 1;
    } else {
        process.stdout.write(`Vindhem OpenAPI: ${result.operationCount} operations, static specification checks passed; runtime conformance was not tested.\n`);
    }
}
