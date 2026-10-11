import { describe, expect, it } from 'vitest';
import { createPreviewI18n, flattenCatalog, placeholders, readValue } from '../playground/model.js';
import { scenarios } from '../playground/registry.jsx';
import en from '../src/i18n/locales/en.js';
import de from '../src/i18n/locales/de.js';

const catalogs = { en, de };

describe('localization playground', () => {
    it('indexes canonical leaves and recognizes missing saved values', () => {
        expect(flattenCatalog({ a: { b: 'value' } })).toEqual([['a.b', 'value']]);
        expect(readValue({}, 'a.b')).toBeUndefined();
    });
    it('keeps overrides isolated from source catalogs and other previews', async () => {
        const first = await createPreviewI18n(catalogs, 'de', { 'common.delete': 'preview value' });
        const second = await createPreviewI18n(catalogs, 'de');
        expect(first.t('common.delete')).toBe('preview value');
        expect(second.t('common.delete')).toBe(en.common.delete);
        expect(readValue(de, 'common.delete')).toBeUndefined();
        expect(first.options.react.bindI18nStore).toContain('added');
    });
    it('falls back and interpolates, then restores missing keys after reset', async () => {
        const preview = await createPreviewI18n(catalogs, 'de');
        expect(
            preview.t('tls.deleteConfirm', { status: 'expired', domain: 'example.home.arpa' }),
        ).toContain('example.home.arpa');
        preview.addResource('de', 'translation', 'common.delete', 'temporary');
        preview.removeResourceBundle('de', 'translation');
        preview.addResourceBundle('de', 'translation', structuredClone(de));
        expect(preview.t('common.delete')).toBe(en.common.delete);
    });
    it('detects removed or renamed interpolation tokens', () => {
        expect(placeholders('For {{domain}}: {{ status }}')).toEqual(['domain', 'status']);
        expect(placeholders('{{domain}}')).not.toEqual(placeholders('{{host}}'));
    });
    it('registers unique states with valid canonical keys', () => {
        expect(new Set(scenarios.map((s) => s.id)).size).toBe(scenarios.length);
        for (const scenario of scenarios) {
            for (const key of scenario.keys) expect(typeof readValue(en, key)).toBe('string');
        }
    });
});
