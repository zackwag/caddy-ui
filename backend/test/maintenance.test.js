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

    it('escapes backticks in HTML', () => {
        const html = '<html><body>`code`</body></html>';
        const block = buildMaintenanceBlock('example.com', html);
        expect(block).toContain('\\`code\\`');
    });

    it('preserves the domain exactly', () => {
        const block = buildMaintenanceBlock('http://local.dev', '<p>maint</p>');
        expect(block).toMatch(/^http:\/\/local\.dev \{/);
    });

    it('produces a valid Caddyfile block structure', () => {
        const block = buildMaintenanceBlock('test.com', '<h1>Down</h1>');
        const lines = block.split('\n');
        expect(lines[0]).toBe('test.com {');
        expect(lines[lines.length - 1]).toBe('}');
        expect(lines.length).toBe(4);
    });
});
