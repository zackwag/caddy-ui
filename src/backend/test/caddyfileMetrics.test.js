import { describe, expect, it } from 'vitest';
import { metricsEnabled, setMetricsEnabled } from '../src/caddyfileMetrics.js';

const site = '\nexample.com {\n\tmetrics\n}\n';

describe('metrics in a Caddyfile', () => {
    it.each([
        ['a global option', '{\n\tmetrics\n}\n', true],
        ['a global option with settings', '{\n\tmetrics {\n\t\tper_host\n\t}\n}\n', true],
        ['the older servers form', '{\n\tservers {\n\t\tmetrics\n\t}\n}\n', true],
        ['only the handler of a site block', '{\n\tadmin off\n}\n', false],
        ['a comment', '{\n\t# metrics\n}\n', false],
        ['no global options', '', false],
    ])('are read from %s', (_name, global, enabled) => {
        expect(metricsEnabled(global + site)).toBe(enabled);
    });

    it('are added in the style of the existing options', () => {
        expect(setMetricsEnabled('{\n  admin off\n}\n' + site, true)).toBe('{\n  admin off\n  metrics\n}\n' + site);
    });

    it('are added with a global block when there is none', () => {
        expect(setMetricsEnabled(site, true)).toBe('{\n\tmetrics\n}\n\n' + site);
    });

    it('are left as written when already on', () => {
        const content = '{\n\tmetrics {\n\t\tper_host\n\t}\n}\n' + site;
        expect(setMetricsEnabled(content, true)).toBe(content);
    });

    it('are removed wherever they are set, keeping the metrics handler of a site', () => {
        expect(setMetricsEnabled('{\n\tadmin off\n\tmetrics {\n\t\tper_host\n\t}\n\tservers {\n\t\tmetrics\n\t}\n}\n' + site, false))
            .toBe('{\n\tadmin off\n\tservers {\n\t}\n}\n' + site);
        expect(setMetricsEnabled('{\n\tadmin off\n}\n' + site, false)).toBe('{\n\tadmin off\n}\n' + site);
    });
});
