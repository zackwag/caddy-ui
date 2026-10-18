import { describe, expect, it } from 'vitest';
import { updateLink } from '../src/utils/updateLink.js';

const repo = 'https://github.com/zackwag/caddy-ui';

describe('update badge link', () => {
    it('links stable updates to the release notes', () => {
        expect(updateLink({ backend: '2.29.5', frontend: '2.29.5' }, { backend: '2.29.3', frontend: '2.29.3' }))
            .toBe(`${repo}/releases`);
    });

    it('compares the running edge build with the offered one', () => {
        expect(updateLink({ backend: 'edge-dc24841', frontend: null }, { backend: 'edge-72bba1f', frontend: 'edge-72bba1f' }))
            .toBe(`${repo}/compare/72bba1f...dc24841`);
    });

    it("uses the frontend's builds when only the frontend has an update", () => {
        expect(updateLink({ backend: null, frontend: 'beta-1a2b3c4' }, { backend: 'beta-9f8e7d6', frontend: 'beta-5e6f7a8' }))
            .toBe(`${repo}/compare/5e6f7a8...1a2b3c4`);
    });

    it("prefers the backend's builds when both images have an update", () => {
        expect(updateLink({ backend: 'edge-bbbbbbb', frontend: 'edge-fffffff' }, { backend: 'edge-aaaaaaa', frontend: 'edge-eeeeeee' }))
            .toBe(`${repo}/compare/aaaaaaa...bbbbbbb`);
    });

    it('prefers release notes when any offered update is a release', () => {
        expect(updateLink({ backend: 'edge-bbbbbbb', frontend: '2.29.5' }, { backend: 'edge-aaaaaaa', frontend: '2.29.3' }))
            .toBe(`${repo}/releases`);
    });

    it("falls back to main's history when the running commit is unknown", () => {
        expect(updateLink({ backend: 'edge-dc24841' }, { backend: null })).toBe(`${repo}/commits/main`);
        expect(updateLink({ backend: 'edge-dc24841' }, { backend: 'dev' })).toBe(`${repo}/commits/main`);
    });

    it('returns null when nothing is on offer', () => {
        expect(updateLink(null, {})).toBeNull();
        expect(updateLink({ backend: null, frontend: null }, {})).toBeNull();
    });
});
