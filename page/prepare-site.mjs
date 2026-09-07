import { cpSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifySite } from './verify-site.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const input = resolve(root, 'dist/specification');
const output = resolve(root, 'site');
const record = verifySite(input);
// This directory is generated, never a source of specification edits.
rmSync(output, { recursive: true, force: true });
cpSync(input, output, { recursive: true });
verifySite(output);
process.stdout.write(`Prepared site/ for Vindhem ${record.apiVersion}. Commit this generated tree; nothing has been deployed.\n`);
