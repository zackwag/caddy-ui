import { describe, expect, it } from 'vitest';
import { buildLogBlock, parseLogConfig, updateGlobalBlock } from '../src/routes/logs.js';

describe('parseLogConfig', () => {
    it('returns defaults when no global block exists', () => {
        const config = parseLogConfig(`app.example.com {
    reverse_proxy localhost:8080
}`);
        expect(config.enabled).toBe(false);
        expect(config.path).toBe('/var/log/caddy/access.log');
        expect(config.rollSize).toBe('50mb');
        expect(config.rollKeep).toBe(5);
        expect(config.format).toBe('json');
        expect(config.level).toBe('INFO');
    });

    it('returns defaults when global block has no log directive', () => {
        const config = parseLogConfig(`{
    email admin@example.com
}

app.example.com {
    reverse_proxy localhost:8080
}`);
        expect(config.enabled).toBe(false);
    });

    it('parses a complete log configuration', () => {
        const config = parseLogConfig(`{
\tlog {
\t\toutput file /var/log/caddy/custom.log {
\t\t\troll_size 100mb
\t\t\troll_keep 10
\t\t}
\t\tformat console
\t\tlevel DEBUG
\t}
}

app.example.com {
    reverse_proxy localhost:8080
}`);
        expect(config.enabled).toBe(true);
        expect(config.path).toBe('/var/log/caddy/custom.log');
        expect(config.rollSize).toBe('100mb');
        expect(config.rollKeep).toBe(10);
        expect(config.format).toBe('console');
        expect(config.level).toBe('DEBUG');
    });

    it('handles partial log config (only output file)', () => {
        const config = parseLogConfig(`{
\tlog {
\t\toutput file /tmp/caddy.log {
\t\t\troll_size 25mb
\t\t\troll_keep 3
\t\t}
\t}
}`);
        expect(config.enabled).toBe(true);
        expect(config.path).toBe('/tmp/caddy.log');
        expect(config.rollSize).toBe('25mb');
        expect(config.rollKeep).toBe(3);
        expect(config.format).toBe('json');
        expect(config.level).toBe('INFO');
    });

    it('uppercases the level', () => {
        const config = parseLogConfig(`{
\tlog {
\t\toutput file /tmp/caddy.log {
\t\t\troll_size 50mb
\t\t\troll_keep 5
\t\t}
\t\tlevel warn
\t}
}`);
        expect(config.level).toBe('WARN');
    });
});

describe('buildLogBlock', () => {
    it('returns null when logging is disabled', () => {
        expect(buildLogBlock({ enabled: false })).toBeNull();
    });

    it('builds a complete log block', () => {
        const block = buildLogBlock({
            enabled: true,
            path: '/var/log/caddy/access.log',
            rollSize: '50mb',
            rollKeep: 5,
            format: 'json',
            level: 'INFO',
        });
        expect(block).toContain('log {');
        expect(block).toContain('output file /var/log/caddy/access.log');
        expect(block).toContain('roll_size 50mb');
        expect(block).toContain('roll_keep 5');
        expect(block).toContain('format json');
        expect(block).toContain('level INFO');
    });
});

describe('updateGlobalBlock', () => {
    it('creates a global block when none exists and logging is enabled', () => {
        const content = `app.example.com {
    reverse_proxy localhost:8080
}`;
        const result = updateGlobalBlock(content, {
            enabled: true,
            path: '/var/log/caddy/access.log',
            rollSize: '50mb',
            rollKeep: 5,
            format: 'json',
            level: 'INFO',
        });
        expect(result).toMatch(/^\{/);
        expect(result).toContain('log {');
        expect(result).toContain('app.example.com');
    });

    it('leaves content unchanged when no global block and logging disabled', () => {
        const content = `app.example.com {
    reverse_proxy localhost:8080
}`;
        const result = updateGlobalBlock(content, { enabled: false });
        expect(result).toBe(content);
    });

    it('adds log block to existing global block', () => {
        const content = `{
    email admin@example.com
}

app.example.com {
    reverse_proxy localhost:8080
}`;
        const result = updateGlobalBlock(content, {
            enabled: true,
            path: '/tmp/caddy.log',
            rollSize: '25mb',
            rollKeep: 3,
            format: 'json',
            level: 'DEBUG',
        });
        expect(result).toContain('email admin@example.com');
        expect(result).toContain('log {');
        expect(result).toContain('output file /tmp/caddy.log');
    });

    it('replaces log block with new config when re-enabling', () => {
        const content = `{
    email admin@example.com
}

app.example.com {
    reverse_proxy localhost:8080
}`;
        const result = updateGlobalBlock(content, {
            enabled: true,
            path: '/tmp/new.log',
            rollSize: '10mb',
            rollKeep: 2,
            format: 'console',
            level: 'WARN',
        });
        expect(result).toContain('email admin@example.com');
        expect(result).toContain('output file /tmp/new.log');
        expect(result).toContain('format console');
        expect(result).toContain('level WARN');
    });
});
