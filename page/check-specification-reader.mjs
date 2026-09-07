import assert from 'node:assert/strict';
import { once } from 'node:events';
import { readFileSync, mkdirSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { parse } from 'yaml';
import { JSDOM } from 'jsdom';
import { chromium } from '@playwright/test';
import { createPreviewServer } from './serve-specification.mjs';

const output = resolve('dist/specification');
const document = new JSDOM(readFileSync(resolve(output, 'index.html'), 'utf8')).window.document;
const api = parse(readFileSync('openapi/vindhem.yaml', 'utf8'));
assert.deepEqual(JSON.parse(readFileSync(resolve(output, 'openapi/vindhem.json'), 'utf8')), api);
const publication = JSON.parse(readFileSync(resolve(output, 'publication.json'), 'utf8'));
for (const file of publication.files) {
    const bytes = readFileSync(resolve(output, file.path));
    assert.equal(bytes.length, file.bytes);
    assert.equal(createHash('sha256').update(bytes).digest('hex'), file.sha256);
    if ((/^(spec|openapi|schema)\//.test(file.path) && file.path !== 'openapi/vindhem.json') || file.path === 'LICENSE') {
        assert.deepEqual(bytes, readFileSync(file.path), `Changed source download: ${file.path}`);
    }
}
assert.equal(document.querySelectorAll('a[href="LICENSE"]').length, 1, 'Keep one licence link');
assert.equal(document.querySelectorAll('.masthead .repository-link[href="https://github.com/Hallmane/vindhem"]').length, 1, 'Keep one top repository link');
assert.equal(publication.license, 'LICENSE');
const operations = Object.values(api.paths).flatMap((item) => Object.values(item).filter((value) => value?.operationId).map((op) => op.operationId));
assert.deepEqual([...document.querySelectorAll('[data-operation]')].map((e) => e.dataset.operation).sort(), operations.sort());
assert.deepEqual([...document.querySelectorAll('[data-schema]')].map((e) => e.dataset.schema).sort(), Object.keys(api.components.schemas).sort());
const ids = [...document.querySelectorAll('[id]')].map((e) => e.id);
assert.equal(new Set(ids).size, ids.length, 'Duplicate anchors');
for (const anchor of document.querySelectorAll('a[href]')) {
    const href = anchor.getAttribute('href');
    if (href.startsWith('#')) assert(ids.includes(href.slice(1)), `Missing anchor: ${href}`);
    else if (!/^(https?:|mailto:)/.test(href)) assert(existsSync(resolve(output, href.split('#')[0])), `Missing download: ${href}`);
}
assert.match(document.querySelector('#op-searchLibrary pre').textContent, /--data-urlencode "q=\$Q"/);
assert.match(document.querySelector('#op-streamLibraryChanges pre').textContent, /afterRevision=\$AFTER_REVISION/);
assert.match(document.querySelector('#op-headAttachment pre').textContent, /curl --head/);

const basePath = `/vindhem/specification/releases/${api.info.version}/`;
const server = process.env.SPEC_PREVIEW_URL ? null : createPreviewServer({ basePath });
if (server) {
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
}
const base = (process.env.SPEC_PREVIEW_URL ?? `http://127.0.0.1:${server.address().port}${basePath}`).replace(/\/$/, '');
const screenshots = resolve('dist/specification-checks');
mkdirSync(screenshots, { recursive: true });
let browser;
try {
    browser = await chromium.launch({ channel: 'chrome', headless: true });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('requestfailed', (request) => errors.push(`${request.url()}: ${request.failure()?.errorText}`));
    page.on('response', (response) => { if (response.status() >= 400) errors.push(`${response.status()}: ${response.url()}`); });
    await page.goto(`${base}/`, { waitUntil: 'networkidle' });
    assert.equal(await page.title(), 'Vindhem Specification');
    assert.match(await page.locator('.running-head').innerText(), /0\.1\.2/);
    assert.equal(await page.locator('html').evaluate((e) => getComputedStyle(e).backgroundColor), 'rgb(0, 0, 0)');
    await page.screenshot({ path: resolve(screenshots, 'desktop.png') });
    await page.locator('.contents a[href="#group-tracks"]').click();
    await page.locator('#op-getTrack').scrollIntoViewIfNeeded();
    await page.screenshot({ path: resolve(screenshots, 'track.png') });
    await page.locator('#op-getTrack .errors > summary').click();
    assert(await page.locator('#op-getTrack .errors').evaluate((e) => e.open));

    const currentSection = async (href) => page.waitForFunction(
        (expected) => document.querySelector('.contents [aria-current="location"]')?.getAttribute('href') === expected,
        href,
        { timeout: 3000 },
    );
    await page.goto(`${base}/#group-artists`);
    await page.locator('#group-albums').evaluate((e) => window.scrollTo(0, e.getBoundingClientRect().top + window.scrollY - 400));
    await currentSection('#group-artists');
    const navigationBeforeScroll = await page.evaluate(() => ({ url: location.href, history: history.length }));
    await page.mouse.move(1000, 500);
    await page.mouse.wheel(0, 450);
    await currentSection('#group-albums');
    await page.mouse.wheel(0, -450);
    await currentSection('#group-artists');
    assert.deepEqual(await page.evaluate(() => ({ url: location.href, history: history.length })), navigationBeforeScroll);
    await page.goto(`${base}/#op-getTrack`);
    await currentSection('#group-tracks');
    assert.equal(await page.locator('.contents [aria-current="location"]').evaluate((e) => getComputedStyle(e, '::before').content), 'none', 'Keep the line marker without a dot');
    assert.equal(await page.locator('.operation-id').first().evaluate((e) => getComputedStyle(e).fontStyle), 'normal');

    await page.goto(`${base}/#schema-Track`);
    assert(await page.locator('#schema-Track').isVisible());
    await currentSection('#types');
    await page.locator('.contents a[href="#types"]').evaluate((e) => { e.closest('details').open = true; });
    await currentSection('#schema-Track');
    assert(await page.locator('.contents a[href="#schema-Track"]').evaluate((e) => {
        const bounds = e.closest('nav').getBoundingClientRect();
        const link = e.getBoundingClientRect();
        return link.top >= bounds.top && link.bottom <= bounds.bottom;
    }));
    await page.screenshot({ path: resolve(screenshots, 'schema.png') });
    await page.setViewportSize({ width: 360, height: 1000 });
    await page.locator('#schema-Track').evaluate((e) => e.scrollIntoView());
    await currentSection('#types');
    for (const width of [1024, 736, 360]) {
        await page.setViewportSize({ width, height: 1000 });
        for (const hash of ['', '#op-getTrack', '#schema-Track', '#portable']) {
            await page.goto(`${base}/${hash}`);
            assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `Overflow at ${width}, ${hash}`);
        }
    }
    await page.goto(`${base}/`);
    await page.screenshot({ path: resolve(screenshots, 'mobile.png') });
    assert.deepEqual(errors, []);
    const yaml = await page.request.get(`${base}/openapi/vindhem.yaml`);
    assert.equal(yaml.status(), 200);
    assert.match(yaml.headers()['content-type'], /application\/yaml/);
    assert.equal(await yaml.text(), readFileSync('openapi/vindhem.yaml', 'utf8'));
    const schema = await page.request.get(`${base}/schema/library-v1.schema.json`);
    assert.equal(schema.status(), 200);
    assert.match(schema.headers()['content-type'], /application\/schema\+json/);
    assert.deepEqual(await schema.body(), readFileSync('schema/library-v1.schema.json'));
    const license = await page.request.get(`${base}/LICENSE`);
    assert.equal(license.status(), 200);
    assert.match(license.headers()['content-type'], /text\/plain/);
    assert.deepEqual(await license.body(), readFileSync('LICENSE'));
    assert.equal((await page.request.get(`${base}/.env`)).status(), 404);
    assert.equal((await page.request.post(base)).status(), 405);
    console.log(`Reader checked: ${operations.length} operations, ${Object.keys(api.components.schemas).length} definitions, links/downloads, scroll tracking without history changes, Chrome desktop/mobile, no runtime errors.`);
    console.log(`Screenshots: ${screenshots}`);
} finally {
    await browser?.close();
    if (server) await new Promise((resolve) => server.close(resolve));
}
