import { describe, expect, it } from 'vitest';
import { buildMaintenanceBlock, isMaintenanceBlock } from '../src/maintenance.js';

describe('buildMaintenanceBlock', () => {
    it('replaces the reverse_proxy with a maintenance rewrite', () => {
        const original = 'app.example.com {\n    reverse_proxy localhost:8080\n}';
        const block = buildMaintenanceBlock(original, 'caddy-ui-backend:3001');
        expect(block).toEqual([
            'app.example.com {',
            '    rewrite * /public/responses/maintenance',
            '    reverse_proxy caddy-ui-backend:3001',
            '}',
        ].join('\n'));
    });

    it('preserves tls and other infrastructure directives', () => {
        const original = [
            'caddy.internal {',
            '    # caddy/ui',
            '    tls internal',
            '    reverse_proxy backend:9877',
            '}',
        ].join('\n');
        const block = buildMaintenanceBlock(original, 'caddy-ui-backend:3001');
        expect(block).toContain('tls internal');
        expect(block).toContain('# caddy/ui');
        expect(block).not.toContain('backend:9877');
        expect(block).toContain('rewrite * /public/responses/maintenance');
        expect(block).toContain('reverse_proxy caddy-ui-backend:3001');
    });

    it('strips handle blocks and redir while keeping matchers', () => {
        const original = [
            'files.example.com {',
            '    @upload {',
            '        method PUT',
            '    }',
            '    handle @upload {',
            '        respond "No" 401',
            '    }',
            '    handle {',
            '        reverse_proxy backend:9097',
            '    }',
            '}',
        ].join('\n');
        const block = buildMaintenanceBlock(original, 'caddy-ui-backend:3001');
        expect(block).toContain('@upload');
        expect(block).not.toContain('handle');
        expect(block).not.toContain('respond');
        expect(block).toContain('rewrite * /public/responses/maintenance');
    });

    it('preserves the domain address exactly', () => {
        const original = 'http://local.dev {\n    redir https://{host}{uri}\n}';
        const block = buildMaintenanceBlock(original, 'localhost:3001');
        expect(block).toMatch(/^http:\/\/local\.dev \{/);
    });

    it('handles env-variable addresses without matching their braces', () => {
        const original = '{$DOMAIN} {\n    reverse_proxy app:8080\n}';
        const block = buildMaintenanceBlock(original, 'caddy-ui-backend:3001');
        expect(block).toMatch(/^\{\$DOMAIN\} \{/);
        expect(block).toContain('rewrite * /public/responses/maintenance');
        expect(block).not.toContain('app:8080');
    });

    it('strips import directives that could bypass maintenance', () => {
        const original = [
            'example.com {',
            '    tls internal',
            '    import app_handlers',
            '    reverse_proxy backend:8080',
            '}',
        ].join('\n');
        const block = buildMaintenanceBlock(original, 'caddy-ui-backend:3001');
        expect(block).toContain('tls internal');
        expect(block).not.toContain('import');
        expect(block).not.toContain('app_handlers');
    });
});

describe('isMaintenanceBlock', () => {
    it('recognizes the current reverse_proxy format', () => {
        const original = 'example.com {\n    reverse_proxy localhost:8080\n}';
        const block = buildMaintenanceBlock(original, 'caddy-ui-backend:3001');
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
