import { readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Used only inside the disposable Docker build stage, before Vite scans imports.
export async function selectLocales(localesDir, additionalLanguages = '') {
    const requested = [...new Set(additionalLanguages.split(',')
        .map(language => language.trim().toLowerCase())
        .filter(Boolean))];
    const files = (await readdir(localesDir)).filter(file => file.endsWith('.js'));
    const included = new Set(['en', ...requested]);

    // Validate everything before removing any files. Never accept path fragments.
    for (const language of included) {
        if (!/^[a-z]{2,3}$/.test(language)) {
            throw new Error(`Invalid build language code: ${language}`);
        }
        if (!files.includes(`${language}.js`)) {
            throw new Error(`Missing locale catalog for build language: ${language}`);
        }
    }

    for (const file of files) {
        if (!included.has(file.slice(0, -3))) await rm(path.join(localesDir, file));
    }
    return [...included];
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    const localesDir = fileURLToPath(new URL('../src/i18n/locales/', import.meta.url));
    const included = await selectLocales(localesDir, process.env.CADDY_UI_ADDITIONAL_LANGUAGES);
    console.log(`Frontend build languages: ${included.join(', ')}`);
}
