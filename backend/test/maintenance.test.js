import { describe, expect, it } from 'vitest';
import { buildMaintenanceBlock } from '../src/routes/routes.js';

describe('buildMaintenanceBlock', () => {
    it('builds a respond block with the given HTML', () => {
        const html = '<html><body>Under Maintenance</body></html>';
        const block = buildMaintenanceBlock('app.example.com', html);
        expect(block).toContain('app.example.com {');
        expect(block).toContain('header Content-Type text/html');
        expect(block).toContain('respond');
        expect(block).toContain('503');
        expect(block).toContain('Under Maintenance');
        expect(block).toMatch(/}$/);
    });

    it('passes backticks and backslashes through unchanged', () => {
        const html = '<html><body>`code` C:\\path</body></html>';
        const block = buildMaintenanceBlock('example.com', html);
        expect(block).toContain('        <html><body>`code` C:\\path</body></html>');
    });

    it('uses a heredoc marker that does not appear in the HTML', () => {
        const html = '<p>CADDY_UI_MAINTENANCE</p>';
        const lines = buildMaintenanceBlock('example.com', html).split('\n');
        expect(lines[2]).toBe('    respond <<CADDY_UI_MAINTENANCE_');
        expect(lines[4]).toBe('        CADDY_UI_MAINTENANCE_ 503');
    });

    it('indents each line of the page and leaves blank lines empty', () => {
        const lines = buildMaintenanceBlock('example.com', '<p>a</p>\r\n\r\n<p>b</p>').split('\n');
        expect(lines.slice(3, 6)).toEqual(['        <p>a</p>', '', '        <p>b</p>']);
    });

    it('preserves the domain exactly', () => {
        const block = buildMaintenanceBlock('http://local.dev', '<p>maint</p>');
        expect(block).toMatch(/^http:\/\/local\.dev \{/);
    });

    it('produces a valid Caddyfile block structure', () => {
        const block = buildMaintenanceBlock('test.com', '<h1>Down</h1>');
        const lines = block.split('\n');
        expect(lines).toEqual([
            'test.com {',
            '    header Content-Type text/html',
            '    respond <<CADDY_UI_MAINTENANCE',
            '        <h1>Down</h1>',
            '        CADDY_UI_MAINTENANCE 503',
            '}',
        ]);
    });
});
