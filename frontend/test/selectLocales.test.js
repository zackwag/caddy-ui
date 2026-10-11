import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { selectLocales } from '../scripts/select-locales.mjs';

const temporaryDirectories = [];

async function fixture(files = ['en.js', 'de.js', 'fr.js']) {
    const directory = await mkdtemp(path.join(tmpdir(), 'caddy-ui-locales-'));
    temporaryDirectories.push(directory);
    for (const file of files) await writeFile(path.join(directory, file), 'export default {};');
    return directory;
}

afterEach(async () => {
    for (const directory of temporaryDirectories.splice(0)) {
        await rm(directory, { recursive: true, force: true });
    }
});

describe('Docker build locale selection', () => {
    it('keeps only English by default and preserves unrelated files', async () => {
        const directory = await fixture(['en.js', 'de.js', 'README.md']);
        expect(await selectLocales(directory)).toEqual(['en']);
        expect((await readdir(directory)).sort()).toEqual(['README.md', 'en.js']);
    });

    it('normalizes and deduplicates explicitly selected catalogs', async () => {
        const directory = await fixture();
        expect(await selectLocales(directory, ' DE, en, de, , fr ')).toEqual(['en', 'de', 'fr']);
        expect((await readdir(directory)).sort()).toEqual(['de.js', 'en.js', 'fr.js']);
    });

    it('removes unselected catalogs while preserving English', async () => {
        const directory = await fixture();
        await selectLocales(directory, 'de');
        expect((await readdir(directory)).sort()).toEqual(['de.js', 'en.js']);
    });

    it.each(['zz', '../de', 'de-DE'])('rejects unavailable or invalid code %s before modifying files', async code => {
        const directory = await fixture();
        await expect(selectLocales(directory, code)).rejects.toThrow();
        expect((await readdir(directory)).sort()).toEqual(['de.js', 'en.js', 'fr.js']);
    });

    it('requires the English fallback', async () => {
        const directory = await fixture(['de.js']);
        await expect(selectLocales(directory, 'de')).rejects.toThrow('Missing locale catalog');
        expect(await readdir(directory)).toEqual(['de.js']);
    });
});
