import { describe, expect, it } from 'vitest';
import { availableUpdate, channelOf, compareVersions, getUpdateInfo, isValidManifest } from '../src/updateCheck.js';

const manifest = {
    schema: 1,
    channels: {
        stable: { frontend: ['2.15.0', '2.13.0'], backend: ['2.15.0', '2.14.0'] },
        beta: { frontend: ['beta-ccc3333', 'beta-aaa1111'], backend: ['beta-ccc3333'] },
        edge: { frontend: ['edge-ddd4444', 'beta-ccc3333', 'edge-bbb2222'], backend: ['edge-eee5555'] },
    },
};

describe('compareVersions', () => {
    it('compares numerically, not lexically', () => {
        expect(compareVersions('2.14.0', '2.9.0')).toBeGreaterThan(0);
        expect(compareVersions('2.9.0', '2.14.0')).toBeLessThan(0);
        expect(compareVersions('v2.15.0', '2.15.0')).toBe(0);
    });

    it('treats unparseable versions as equal', () => {
        expect(compareVersions('dev', '2.15.0')).toBe(0);
    });
});

describe('channelOf', () => {
    it('maps APP_VERSION formats to channels', () => {
        expect(channelOf('2.15.0')).toBe('stable');
        expect(channelOf('beta-abc1234')).toBe('beta');
        expect(channelOf('edge-abc1234')).toBe('edge');
    });

    it('ignores dev and unknown builds', () => {
        expect(channelOf('dev')).toBeNull();
        expect(channelOf(null)).toBeNull();
        expect(channelOf('2.15')).toBeNull();
        expect(channelOf('edge-')).toBeNull();
    });
});

describe('availableUpdate', () => {
    it('offers a newer stable release', () => {
        expect(availableUpdate(manifest, 'backend', '2.14.0')).toBe('2.15.0');
        expect(availableUpdate(manifest, 'frontend', '2.9.0')).toBe('2.15.0');
    });

    it('stays quiet when current or ahead of the manifest', () => {
        expect(availableUpdate(manifest, 'backend', '2.15.0')).toBeNull();
        expect(availableUpdate(manifest, 'backend', '2.16.0')).toBeNull();
    });

    it('offers the latest beta/edge build when the running one is older in history', () => {
        expect(availableUpdate(manifest, 'frontend', 'edge-bbb2222')).toBe('edge-ddd4444');
        expect(availableUpdate(manifest, 'frontend', 'beta-aaa1111')).toBe('beta-ccc3333');
    });

    it('stays quiet for the latest or an unlisted beta/edge build', () => {
        expect(availableUpdate(manifest, 'frontend', 'edge-ddd4444')).toBeNull();
        expect(availableUpdate(manifest, 'backend', 'edge-fff6666')).toBeNull();
    });

    it('checks beta builds against the beta channel', () => {
        // beta-ccc3333 is also in edge history, but a beta build is compared
        // with beta, where it's still the latest
        expect(availableUpdate(manifest, 'frontend', 'beta-ccc3333')).toBeNull();
    });

    it('handles dev builds and missing data', () => {
        expect(availableUpdate(manifest, 'backend', 'dev')).toBeNull();
        expect(availableUpdate(null, 'backend', '2.14.0')).toBeNull();
        expect(availableUpdate({ schema: 1, channels: {} }, 'backend', '2.14.0')).toBeNull();
        expect(availableUpdate({ schema: 1, channels: { stable: { backend: [] } } }, 'backend', '2.14.0')).toBeNull();
    });
});

describe('isValidManifest', () => {
    it('accepts schema 1 with channels', () => {
        expect(isValidManifest(manifest)).toBe(true);
    });

    it('rejects anything else', () => {
        expect(isValidManifest(null)).toBe(false);
        expect(isValidManifest({ channels: {} })).toBe(false);
        expect(isValidManifest({ schema: 2, channels: {} })).toBe(false);
        expect(isValidManifest({ schema: 1 })).toBe(false);
    });
});

describe('getUpdateInfo', () => {
    it('returns null before any manifest has loaded', () => {
        expect(getUpdateInfo({ backend: '2.14.0', frontend: '2.14.0' })).toBeNull();
    });
});
