import { describe, expect, it } from 'vitest';
import { flattenCatalog, placeholders, readValue } from '../model.js';
import { capture, scenarios } from '../registry.jsx';
import { setups } from '../setups.js';
import en from '../../../src/frontend/src/i18n/locales/en.js';

// The only captured requests that aren't reads: validating changes nothing, and
// the label is saved on the capture's own disposable instance.
const RECORDED_WRITES = ['/caddyfile/validations?fmt=true', '/server-names/srv0'];

describe('localization playground', () => {
    it('indexes canonical leaves and recognizes missing saved values', () => {
        expect(flattenCatalog({ a: { b: 'value' } })).toEqual([['a.b', 'value']]);
        expect(readValue({}, 'a.b')).toBeUndefined();
    });

    it('detects removed or renamed interpolation tokens', () => {
        expect(placeholders('For {{domain}}: {{ status }}')).toEqual(['domain', 'status']);
        expect(placeholders('{{domain}}')).not.toEqual(placeholders('{{host}}'));
    });

    it('registers each state once', () => {
        expect(new Set(scenarios.map(scenario => scenario.id)).size).toBe(scenarios.length);
    });

    it.each(scenarios.map(scenario => [scenario.id, scenario]))('%s is reachable from what was captured', (_id, scenario) => {
        for (const key of scenario.keys) expect(typeof readValue(en, key), key).toBe('string');
        if (scenario.setup) expect(setups).toHaveProperty([scenario.setup]);
        if (!scenario.profile) return;
        const profile = capture.scenarios.find(profile => profile.id === scenario.profile);
        const writes = profile.requests.map(record => record.request).filter(request => request.method !== 'GET');
        expect(RECORDED_WRITES).toEqual(expect.arrayContaining(writes.map(request => request.path)));
    });
});
