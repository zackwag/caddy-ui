import { readdir, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const frontendDir = path.resolve(scriptDir, '..');
const repoDir = path.resolve(frontendDir, '..');
const localesDir = path.join(frontendDir, 'src', 'i18n', 'locales');
const coveragePath = path.join(repoDir, 'docs', 'src', 'assets', 'localization-coverage.svg');

function isObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function leafCount(node) {
    if (!isObject(node)) return 1;
    return Object.values(node).reduce((sum, value) => sum + leafCount(value), 0);
}

// i18next resolves plurals by suffixing the key with the target language's
// CLDR categories, so a locale may need forms English never uses (Polish
// `_few`/`_many`, Arabic `_zero`/`_two`, ...).
const PLURAL_KEY = /^(.+?)(_ordinal)?_(zero|one|two|few|many|other)$/;

function pluralBase(key) {
    const match = key.match(PLURAL_KEY);
    return match ? `${match[1]}${match[2] || ''}` : null;
}

function isPluralVariant(reference, key) {
    const base = pluralBase(key);
    return base !== null && typeof reference[`${base}_other`] === 'string';
}

// Counts English leaves the candidate covers. A plural group counts as
// translated when the candidate supplies any of its forms, since languages
// don't share the same set of plural categories.
export function translatedCount(reference, candidate) {
    if (!isObject(candidate)) return 0;

    const candidatePluralBases = new Set(
        Object.keys(candidate)
            .filter(key => isPluralVariant(reference, key))
            .map(pluralBase),
    );

    return Object.entries(reference).reduce((sum, [key, value]) => {
        if (isObject(value)) return sum + translatedCount(value, candidate[key]);
        if (typeof candidate[key] === 'string') return sum + 1;
        const base = pluralBase(key);
        return sum + (base !== null && candidatePluralBases.has(base) ? 1 : 0);
    }, 0);
}

function requireProbe(locale, catalog) {
    if (typeof catalog?.test?.languageLoaded !== 'string' || catalog.test.languageLoaded.trim() === '') {
        throw new Error(`${locale}.js must define a non-empty test.languageLoaded string`);
    }
}

function validateReference(node, currentPath = 'en') {
    if (!isObject(node)) {
        if (typeof node !== 'string') {
            throw new Error(`${currentPath} must be a string translation leaf`);
        }
        return;
    }

    for (const [key, value] of Object.entries(node)) {
        validateReference(value, `${currentPath}.${key}`);
    }
}

export function validateSubset(reference, candidate, locale, currentPath = '') {
    if (!isObject(candidate)) {
        throw new Error(`${locale}.js must export an object`);
    }

    for (const [key, value] of Object.entries(candidate)) {
        const keyPath = currentPath ? `${currentPath}.${key}` : key;

        if (!Object.hasOwn(reference, key)) {
            if (isPluralVariant(reference, key) && typeof value === 'string') continue;
            throw new Error(`${locale}.js contains unknown key "${keyPath}"`);
        }

        const referenceValue = reference[key];
        const referenceIsObject = isObject(referenceValue);
        const candidateIsObject = isObject(value);

        if (referenceIsObject !== candidateIsObject) {
            throw new Error(`${locale}.js changes the key-tree shape at "${keyPath}"`);
        }

        if (candidateIsObject) {
            validateSubset(referenceValue, value, locale, keyPath);
        } else if (typeof value !== 'string') {
            throw new Error(`${locale}.js key "${keyPath}" must be a string`);
        }
    }
}

async function loadCatalogs() {
    const files = (await readdir(localesDir))
        .filter(file => file.endsWith('.js'))
        .sort();

    if (!files.includes('en.js')) {
        throw new Error('frontend/src/i18n/locales/en.js is required');
    }

    const catalogs = new Map();

    for (const file of files) {
        const locale = file.slice(0, -3);

        if (!/^[a-z]{2,3}$/.test(locale)) {
            throw new Error(`locale filename "${file}" must use a lowercase 2-3 letter language code`);
        }

        const module = await import(pathToFileURL(path.join(localesDir, file)).href);
        catalogs.set(locale, module.default);
    }

    const english = catalogs.get('en');
    validateReference(english);
    requireProbe('en', english);

    for (const [locale, catalog] of catalogs) {
        requireProbe(locale, catalog);
        if (locale !== 'en') validateSubset(english, catalog, locale);
    }

    return { catalogs, english };
}

function coverageStats(catalogs, english) {
    const total = leafCount(english);

    return [...catalogs.entries()]
        .sort(([a], [b]) => a === 'en' ? -1 : b === 'en' ? 1 : a.localeCompare(b))
        .map(([locale, catalog]) => {
            const translated = translatedCount(english, catalog);
            return {
                locale,
                translated,
                total,
                percent: (translated / total) * 100,
            };
        });
}

function escapeXml(value) {
    return String(value)
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;');
}

function renderSvg(stats) {
    const width = 620;
    const barX = 72;
    const barWidth = 420;
    const rowHeight = 32;
    const firstRowY = 54;
    const height = firstRowY + stats.length * rowHeight + 18;

    const rows = stats.map((entry, index) => {
        const y = firstRowY + index * rowHeight;
        const fillWidth = entry.percent === 0
            ? 0
            : Math.max(1, Math.round(barWidth * entry.percent / 100));

        return [
            `<text x="16" y="${y + 14}" class="label">${escapeXml(entry.locale)}</text>`,
            `<rect x="${barX}" y="${y}" width="${barWidth}" height="18" rx="4" class="track"/>`,
            `<rect x="${barX}" y="${y}" width="${fillWidth}" height="18" rx="4" class="fill"/>`,
            `<text x="604" y="${y + 14}" text-anchor="end" class="value">${entry.percent.toFixed(1)}% · ${entry.translated}/${entry.total}</text>`,
        ].join('\n');
    }).join('\n');

    return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="Localization coverage">
<style>
    .bg { fill: #ffffff; }
    .title, .label, .value { font-family: ui-sans-serif, system-ui, sans-serif; fill: #24292f; }
    .title { font-size: 15px; font-weight: 600; }
    .label { font-size: 13px; font-weight: 600; }
    .value { font-size: 12px; }
    .track { fill: #d8dee4; }
    .fill { fill: #2da44e; }
    @media (prefers-color-scheme: dark) {
        .bg { fill: #0d1117; }
        .title, .label, .value { fill: #e6edf3; }
        .track { fill: #30363d; }
        .fill { fill: #3fb950; }
    }
</style>
<rect width="100%" height="100%" rx="6" class="bg"/>
<text x="16" y="26" class="title">Localization coverage</text>
${rows}
</svg>
`;
}

async function main() {
    const command = process.argv[2] || 'check';
    const { catalogs, english } = await loadCatalogs();
    const stats = coverageStats(catalogs, english);

    if (command === 'check') {
        for (const entry of stats) {
            console.log(`${entry.locale}: ${entry.translated}/${entry.total} (${entry.percent.toFixed(1)}%)`);
        }
        return;
    }

    if (command === 'coverage') {
        await mkdir(path.dirname(coveragePath), { recursive: true });
        await writeFile(coveragePath, renderSvg(stats), 'utf8');
        console.log(`wrote ${path.relative(repoDir, coveragePath)}`);
        return;
    }

    throw new Error(`unknown localization command "${command}"`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    await main();
}
