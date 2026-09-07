const contents = document.querySelector('.contents');
const main = document.querySelector('main');
const entries = [...contents.querySelectorAll('a[href^="#"]')]
    .map((link) => ({ link, target: document.getElementById(link.hash.slice(1)) }))
    .filter(({ target }) => target && main.contains(target));
let positions = [];
let measureNeeded = true;
let frame = 0;
let activeLink = null;

function scheduleUpdate(measure = false) {
    measureNeeded ||= measure;
    if (!frame) frame = requestAnimationFrame(updateLocation);
}

function updateLocation() {
    frame = 0;
    // Only layout changes invalidate the document-space positions.
    if (measureNeeded) {
        positions = entries.map((entry) => ({
            ...entry,
            top: entry.target.getBoundingClientRect().top + window.scrollY,
        })).sort((a, b) => a.top - b.top);
        measureNeeded = false;
    }
    const readingLine = window.scrollY + Math.min(120, window.innerHeight * 0.2);
    let start = 0;
    let end = positions.length;
    while (start < end) {
        const middle = (start + end) >>> 1;
        if (positions[middle].top <= readingLine) start = middle + 1;
        else end = middle;
    }
    let link = positions[start - 1]?.link ?? null;
    const group = link?.closest('details');
    if (link && ((!group.open && !link.closest('summary')) || !link.getClientRects().length)) {
        link = group.querySelector('summary > a');
    }
    if (link === activeLink) return;
    activeLink?.removeAttribute('aria-current');
    activeLink = link;
    if (!link) return;
    link.setAttribute('aria-current', 'location');

    // Keep the marker visible by scrolling only the contents, never the page.
    if (contents.scrollHeight > contents.clientHeight) {
        const bounds = contents.getBoundingClientRect();
        const marker = link.getBoundingClientRect();
        const padding = 14;
        if (marker.top < bounds.top + padding) contents.scrollTop += marker.top - bounds.top - padding;
        else if (marker.bottom > bounds.bottom - padding) contents.scrollTop += marker.bottom - bounds.bottom + padding;
    }
}

function revealTarget() {
    let id;
    try { id = decodeURIComponent(location.hash.slice(1)); }
    catch { return; }
    const target = document.getElementById(id);
    for (let parent = target?.parentElement; parent; parent = parent.parentElement) {
        if (parent instanceof HTMLDetailsElement) parent.open = true;
    }
    scheduleUpdate(true);
}
window.addEventListener('scroll', () => scheduleUpdate(), { passive: true });
window.addEventListener('resize', () => scheduleUpdate(true));
window.addEventListener('pageshow', () => scheduleUpdate(true));
window.addEventListener('hashchange', revealTarget);
document.addEventListener('toggle', () => scheduleUpdate(true), true);
new ResizeObserver(() => scheduleUpdate(true)).observe(document.querySelector('.book'));
document.fonts.ready.then(() => scheduleUpdate(true));
revealTarget();
