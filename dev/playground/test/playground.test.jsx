import { describe, expect, it } from 'vitest';
import { createPreviewI18n, flattenCatalog, placeholders, readValue } from '../model.js';
import { capture, scenarios } from '../registry.jsx';
import en from '../../../src/frontend/src/i18n/locales/en.js';
import de from '../../../src/frontend/src/i18n/locales/de.js';

// Keep fallback coverage independent of how complete the real catalog is.
const sparseGerman = { test: de.test };
const catalogs = { en, de: sparseGerman };

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
        expect(readValue(sparseGerman, 'common.delete')).toBeUndefined();
        expect(first.options.react.bindI18nStore).toContain('added');
    });
    it('falls back and interpolates, then restores missing keys after reset', async () => {
        const preview = await createPreviewI18n(catalogs, 'de');
        expect(
            preview.t('tls.deleteConfirm', { status: 'expired', domain: 'example.home.arpa' }),
        ).toContain('example.home.arpa');
        preview.addResource('de', 'translation', 'common.delete', 'temporary');
        preview.removeResourceBundle('de', 'translation');
        preview.addResourceBundle('de', 'translation', structuredClone(sparseGerman));
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
    it('adds 43 observability keys using read-only real-capture profiles', () => {
        const added = scenarios.filter(scenario => ['metrics', 'logs'].includes(scenario.kind));
        const existing = new Set(scenarios.filter(scenario => !added.includes(scenario) && !['tls', 'sidebar', 'routes', 'route-history'].includes(scenario.kind)).flatMap(scenario => scenario.keys));
        const keys = new Set(added.flatMap(scenario => scenario.keys));
        expect(added).toHaveLength(5);
        expect([...keys].filter(key => !existing.has(key))).toHaveLength(43);
        for (const profileId of new Set(added.map(scenario => scenario.profile))) {
            const profile = capture.scenarios.find(profile => profile.id === profileId);
            expect(profile).toBeDefined();
            expect(profile.requests.every(record => record.request.method === 'GET')).toBe(true);
        }
        // Transient messages and live transport are not claimed as visible
        // coverage when no corresponding response/stream is recorded.
        expect(keys.has('logs.stop')).toBe(false);
        expect(keys.has('logs.live')).toBe(false);
        expect(keys.has('common.save')).toBe(false);
        expect(keys.has('metrics.enabledToast')).toBe(false);
        expect(keys.has('metrics.refreshing')).toBe(false);
    });
    it('adds 33 TLS and sidebar keys backed by read-only captures', () => {
        const added = scenarios.filter(scenario => ['tls', 'sidebar'].includes(scenario.kind));
        const existing = new Set(scenarios.filter(scenario => !added.includes(scenario)).flatMap(scenario => scenario.keys));
        const keys = new Set(added.flatMap(scenario => scenario.keys));
        expect(added).toHaveLength(7);
        expect([...keys].filter(key => !existing.has(key))).toHaveLength(33);
        for (const profileId of new Set(added.map(scenario => scenario.profile))) {
            const profile = capture.scenarios.find(profile => profile.id === profileId);
            expect(profile).toBeDefined();
            expect(profile.requests.every(record => record.request.method === 'GET')).toBe(true);
        }
        // Filter suffixes share a text node with a leading dash and are not
        // separate exact DOM matches. Certificate rows need a populated store.
        expect(keys.has('tls.filter.valid')).toBe(false);
        expect(keys.has('tls.validUpper')).toBe(false);
        expect(keys.has('sidebar.updateAvailable')).toBe(false);
    });
    it('adds 31 route management and history keys from real read-only profiles', () => {
        const added = scenarios.filter(scenario => ['routes', 'route-history'].includes(scenario.kind));
        const existing = new Set(scenarios.filter(scenario => !added.includes(scenario)).flatMap(scenario => scenario.keys));
        const keys = new Set(added.flatMap(scenario => scenario.keys));
        expect(added).toHaveLength(6);
        expect([...keys].filter(key => !existing.has(key))).toHaveLength(31);
        for (const profileId of new Set(added.map(scenario => scenario.profile))) {
            const profile = capture.scenarios.find(profile => profile.id === profileId);
            expect(profile.requests.every(record => record.request.method === 'GET')).toBe(true);
        }
        expect(keys.has('routes.added')).toBe(false);
        expect(keys.has('routeHistory.online')).toBe(false);
        expect(keys.has('routes.noUpstreamStatus')).toBe(false);
    });
    it('adds 32 Caddyfile and unavailable route-block keys with real captures', () => {
        const added = scenarios.filter(scenario => ['caddyfile', 'route-edit'].includes(scenario.kind));
        const existing = new Set(scenarios.filter(scenario => !added.includes(scenario)).flatMap(scenario => scenario.keys));
        const keys = new Set(added.flatMap(scenario => scenario.keys));
        expect(added).toHaveLength(13);
        expect([...keys].filter(key => !existing.has(key))).toHaveLength(32);
        const profile = capture.scenarios.find(scenario => scenario.id === 'caddyfile-history');
        expect(profile.requests.filter(record => record.request.method !== 'GET').map(record => record.request.path))
            .toEqual(['/caddyfile/validations?fmt=true']);
        expect(keys.has('caddyfile.vsCurrent')).toBe(false);
        expect(keys.has('caddyfile.savedReloaded')).toBe(false);
        expect(keys.has('caddyfile.upToDate')).toBe(false);
    });
    it('adds 50 instance, certificate and populated uptime keys from real reads', () => {
        const added = scenarios.filter(scenario => ['instances', 'tls-certificates', 'uptime-populated'].includes(scenario.kind));
        const existing = new Set(scenarios.filter(scenario => !added.includes(scenario)).flatMap(scenario => scenario.keys));
        const keys = new Set(added.flatMap(scenario => scenario.keys));
        expect(added).toHaveLength(11);
        expect([...keys].filter(key => !existing.has(key))).toHaveLength(50);
        for (const kind of ['instances', 'tls-certificates', 'uptime-populated']) {
            const kindKeys = new Set(added.filter(scenario => scenario.kind === kind).flatMap(scenario => scenario.keys));
            expect(kindKeys.size).toBe(kind === 'instances' ? 30 : 10);
        }
        for (const profileId of new Set(added.map(scenario => scenario.profile))) {
            const profile = capture.scenarios.find(scenario => scenario.id === profileId);
            expect(profile.requests.every(record => record.request.method === 'GET')).toBe(true);
        }
        expect(keys.has('instances.added')).toBe(false);
        expect(keys.has('instances.discoveredContainers')).toBe(false);
        expect(keys.has('tls.daysShort')).toBe(false);
        expect(keys.has('uptime.online')).toBe(false);
    });

});
