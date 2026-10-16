import { describe, expect, it } from 'vitest';
import { createPreviewI18n, flattenCatalog, placeholders, readValue } from '../../../dev/playground/model.js';
import { capture, scenarios } from '../../../dev/playground/registry.jsx';
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
    it('adds 27 distinct onboarding and appearance keys without invented API records', () => {
        const added = scenarios.filter(scenario => ['login', 'theme-welcome', 'appearance-controls'].includes(scenario.kind));
        const existing = new Set(scenarios.filter(scenario => !added.includes(scenario)).flatMap(scenario => scenario.keys));
        const keys = new Set(added.flatMap(scenario => scenario.keys));
        expect(added).toHaveLength(6);
        expect([...keys].filter(key => !existing.has(key))).toHaveLength(27);
        expect(added.every(scenario => !scenario.profile)).toBe(true);
        // These native optgroup labels and custom-theme branches need a
        // separate inspection/data path; do not inflate visible DOM coverage.
        expect(keys.has('themeWelcome.custom')).toBe(false);
        expect(keys.has('themeWelcome.builtIn')).toBe(false);
        expect(keys.has('themePicker.custom')).toBe(false);
        expect(keys.has('themePicker.builtIn')).toBe(false);
    });
    it('adds 30 notification settings keys backed only by captured default reads', () => {
        const added = scenarios.filter(scenario => scenario.kind === 'notification-settings');
        const existing = new Set(scenarios.filter(scenario => !added.includes(scenario)).flatMap(scenario => scenario.keys));
        const keys = new Set(added.flatMap(scenario => scenario.keys));
        expect(added).toHaveLength(6);
        expect([...keys].filter(key => !existing.has(key))).toHaveLength(30);
        expect(new Set(added.map(scenario => scenario.provider))).toEqual(new Set(['ntfy', 'discord', 'slack', 'pushover', 'custom']));
        expect(added.every(scenario => scenario.profile === 'notifications-default')).toBe(true);
        const profile = capture.scenarios.find(scenario => scenario.id === 'notifications-default');
        expect(profile.requests.map(record => record.request)).toEqual([
            { method: 'GET', path: '/notifications/config', body: null },
        ]);
        expect(profile.requests[0].response.body.enabled).toBe(false);
        // Native option text alone is not a visible DOM reference. Save/send
        // results are covered separately and not fabricated for this form.
        expect(keys.has('notifications.customWebhook')).toBe(false);
        expect(keys.has('notifications.sending')).toBe(false);
    });
});
