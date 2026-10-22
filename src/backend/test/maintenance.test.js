import { describe, expect, it } from 'vitest';
import { buildMaintenanceBlock, isMaintenanceBlock } from '../src/maintenance.js';

describe('buildMaintenanceBlock', () => {
    it('builds a reverse_proxy block pointing at the backend', () => {
        const block = buildMaintenanceBlock('app.example.com', 'caddy-ui-backend:3001');
        expect(block).toEqual([
            'app.example.com {',
            '    rewrite * /public/responses/maintenance',
            '    reverse_proxy caddy-ui-backend:3001',
            '}',
        ].join('\n'));
    });

    it('preserves the domain exactly', () => {
        const block = buildMaintenanceBlock('http://local.dev', 'localhost:3001');
        expect(block).toMatch(/^http:\/\/local\.dev \{/);
    });
});

describe('isMaintenanceBlock', () => {
    it('recognizes the current reverse_proxy format', () => {
        const block = buildMaintenanceBlock('example.com', 'caddy-ui-backend:3001');
        expect(isMaintenanceBlock(block)).toBe(true);
    });

    it('recognizes the legacy heredoc format', () => {
        const legacy = [
            'example.com {',
            '    header Content-Type text/html',
            '    respond <<CADDY_UI_MAINTENANCE',
            '        <h1>Down</h1>',
            '        CADDY_UI_MAINTENANCE 503',
            '}',
        ].join('\n');
        expect(isMaintenanceBlock(legacy)).toBe(true);
    });

    it('rejects non-maintenance blocks', () => {
        expect(isMaintenanceBlock('example.com {\n    reverse_proxy localhost:8080\n}')).toBe(false);
    });

    it('rejects non-strings', () => {
        expect(isMaintenanceBlock(null)).toBe(false);
        expect(isMaintenanceBlock(undefined)).toBe(false);
    });
});
