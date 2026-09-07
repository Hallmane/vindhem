import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { dirname, resolve, sep, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../dist/specification');
const types = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json', '.yaml': 'application/yaml', '.md': 'text/markdown' };

export function createPreviewServer({ basePath = '/', directory = root } = {}) {
    if (!/^\/(?:[a-zA-Z0-9_-][a-zA-Z0-9_.-]*\/)*$/.test(basePath)) throw new Error('SPEC_BASE_PATH must start and end with / and contain only non-hidden path segments');
    const root = resolve(directory);
    statSync(resolve(root, 'index.html'));
    return createServer((request, response) => {
        response.setHeader('X-Content-Type-Options', 'nosniff');
        response.setHeader('Cache-Control', 'no-cache');
        if (!['GET', 'HEAD'].includes(request.method)) {
            response.writeHead(405, { Allow: 'GET, HEAD' }).end();
            return;
        }
        try {
            const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
            if (basePath !== '/' && pathname === basePath.slice(0, -1)) {
                response.writeHead(308, { Location: basePath }).end();
                return;
            }
            if (!pathname.startsWith(basePath)) {
                response.writeHead(404).end('Not found');
                return;
            }
            const path = `/${pathname.slice(basePath.length)}`;
            const file = resolve(root, `.${path === '/' ? '/index.html' : path}`);
            if (!file.startsWith(`${root}${sep}`) || path.includes('\0') || path.split('/').some((part) => part.startsWith('.'))) {
                response.writeHead(404).end('Not found');
                return;
            }
            if (!statSync(file).isFile()) throw new Error('Not a file');
            const body = readFileSync(file);
            const type = path === '/LICENSE' ? 'text/plain' : path === '/schema/library-v1.schema.json' ? 'application/schema+json' : types[extname(file)] ?? 'application/octet-stream';
            response.writeHead(200, { 'Content-Type': `${type}; charset=utf-8`, 'Content-Length': body.length });
            response.end(request.method === 'HEAD' ? undefined : body);
        } catch {
            response.writeHead(404).end('Not found');
        }
    });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const port = Number(process.env.SPEC_PORT ?? 5197);
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('SPEC_PORT must be a valid TCP port');
    const basePath = process.env.SPEC_BASE_PATH ?? '/';
    const server = createPreviewServer({ basePath });
    server.listen(port, '127.0.0.1', () => process.stdout.write(`Vindhem specification: http://127.0.0.1:${port}${basePath}\nLocal static preview only. No music server or Docker required.\n`));
    server.on('error', (error) => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
}
