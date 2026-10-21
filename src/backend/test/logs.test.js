import { describe, expect, it } from 'vitest';
import { buildLogBlock, parseLogConfig, updateGlobalBlock, extractGlobalBlock, extractDirectiveBlock } from '../src/routes/logs.js';

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

    it('replaces an existing log block without duplicating it', () => {
        const content = `{
\tlog {
\t\toutput file /var/log/caddy/old.log {
\t\t\troll_size 50mb
\t\t\troll_keep 5
\t\t}
\t\tformat json
\t\tlevel INFO
\t}
}

app.example.com {
    reverse_proxy localhost:8080
}`;
        const result = updateGlobalBlock(content, {
            enabled: true,
            path: '/var/log/caddy/new.log',
            rollSize: '100mb',
            rollKeep: 10,
            format: 'console',
            level: 'DEBUG',
        });
        expect(result).toContain('output file /var/log/caddy/new.log');
        expect(result).not.toContain('old.log');
        const logCount = (result.match(/^\s*log\s*\{/gm) || []).length;
        expect(logCount).toBe(1);
    });

    it('preserves nested acme_dns block when enabling logging', () => {
        const content = `{
\tacme_dns cloudflare {
\t\tapi_token {env.CF_API_TOKEN}
\t}
}

app.example.com {
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
        expect(result).toContain('acme_dns cloudflare {');
        expect(result).toContain('api_token {env.CF_API_TOKEN}');
        expect(result).toContain('log {');
        expect(result).toContain('format json');
    });

    it('preserves nested acme_dns block when updating existing log', () => {
        const content = `{
\tacme_dns cloudflare {
\t\tapi_token {env.CF_API_TOKEN}
\t}
\tlog {
\t\toutput file /var/log/caddy/old.log {
\t\t\troll_size 50mb
\t\t\troll_keep 5
\t\t}
\t\tformat json
\t\tlevel INFO
\t}
}

app.example.com {
    reverse_proxy localhost:8080
}`;
        const result = updateGlobalBlock(content, {
            enabled: true,
            path: '/var/log/caddy/new.log',
            rollSize: '100mb',
            rollKeep: 10,
            format: 'console',
            level: 'DEBUG',
        });
        expect(result).toContain('acme_dns cloudflare {');
        expect(result).toContain('api_token {env.CF_API_TOKEN}');
        expect(result).toContain('output file /var/log/caddy/new.log');
        expect(result).not.toContain('old.log');
    });

    it('preserves multiple nested directives when disabling logging', () => {
        const content = `{
\temail admin@example.com
\tacme_dns cloudflare {
\t\tapi_token {env.CF_API_TOKEN}
\t}
\ton_demand_tls {
\t\task http://localhost:5555/check
\t}
\tlog {
\t\toutput file /var/log/caddy/access.log {
\t\t\troll_size 50mb
\t\t\troll_keep 5
\t\t}
\t\tformat json
\t\tlevel INFO
\t}
}

app.example.com {
    reverse_proxy localhost:8080
}`;
        const result = updateGlobalBlock(content, { enabled: false });
        expect(result).toContain('acme_dns cloudflare {');
        expect(result).toContain('on_demand_tls {');
        expect(result).toContain('email admin@example.com');
        expect(result).not.toContain('log {');
    });

    it('parses log config alongside nested acme_dns', () => {
        const config = parseLogConfig(`{
\tacme_dns cloudflare {
\t\tapi_token {env.CF_API_TOKEN}
\t}
\tlog {
\t\toutput file /var/log/caddy/access.log {
\t\t\troll_size 100mb
\t\t\troll_keep 10
\t\t}
\t\tformat console
\t\tlevel DEBUG
\t}
}`);
        expect(config.enabled).toBe(true);
        expect(config.path).toBe('/var/log/caddy/access.log');
        expect(config.rollSize).toBe('100mb');
        expect(config.rollKeep).toBe(10);
        expect(config.format).toBe('console');
        expect(config.level).toBe('DEBUG');
    });
});

describe('updateGlobalBlock structural validation', () => {
    function assertBalancedBraces(text) {
        let depth = 0;
        for (const ch of text) {
            if (ch === '{') depth++;
            if (ch === '}') depth--;
            if (depth < 0) throw new Error('Unexpected closing brace');
        }
        if (depth !== 0) throw new Error(`Unbalanced braces: depth=${depth}`);
    }

    const NESTED_CADDYFILE = `{
\tacme_dns cloudflare {
\t\tapi_token {env.CF_API_TOKEN}
\t}
\ton_demand_tls {
\t\task http://localhost:5555/check
\t}
}

app.example.com {
    reverse_proxy localhost:8080
}`;

    const LOG_CONFIG = {
        enabled: true,
        path: '/var/log/caddy/access.log',
        rollSize: '50mb',
        rollKeep: 5,
        format: 'json',
        level: 'INFO',
    };

    it('produces balanced braces when adding log to nested globals', () => {
        const result = updateGlobalBlock(NESTED_CADDYFILE, LOG_CONFIG);
        assertBalancedBraces(result);
    });

    it('produces balanced braces when removing log from nested globals', () => {
        const withLog = updateGlobalBlock(NESTED_CADDYFILE, LOG_CONFIG);
        const result = updateGlobalBlock(withLog, { enabled: false });
        assertBalancedBraces(result);
    });

    it('round-trips: parseLogConfig reads back what updateGlobalBlock wrote', () => {
        const result = updateGlobalBlock(NESTED_CADDYFILE, LOG_CONFIG);
        const parsed = parseLogConfig(result);
        expect(parsed.enabled).toBe(true);
        expect(parsed.path).toBe(LOG_CONFIG.path);
        expect(parsed.rollSize).toBe(LOG_CONFIG.rollSize);
        expect(parsed.rollKeep).toBe(LOG_CONFIG.rollKeep);
        expect(parsed.format).toBe(LOG_CONFIG.format);
        expect(parsed.level).toBe(LOG_CONFIG.level);
    });

    it('round-trips through multiple enable/disable cycles', () => {
        let content = NESTED_CADDYFILE;
        for (let i = 0; i < 3; i++) {
            content = updateGlobalBlock(content, LOG_CONFIG);
            assertBalancedBraces(content);
            expect(parseLogConfig(content).enabled).toBe(true);

            content = updateGlobalBlock(content, { enabled: false });
            assertBalancedBraces(content);
            expect(parseLogConfig(content).enabled).toBe(false);
        }
        expect(content).toBe(NESTED_CADDYFILE);
    });

    it('removes the default logger line without leaving a blank line', () => {
        const original = '{\r\n\tadmin off\r\n\tlog {\r\n\t\toutput stderr\r\n\t}  \r\n}\r\n';
        expect(updateGlobalBlock(original, { enabled: false })).toBe('{\r\n\tadmin off\r\n}\r\n');
    });

    it('replaces a CRLF default logger in place', () => {
        const original = '{\r\n\tadmin off\r\n\tlog {\r\n\t\toutput stderr\r\n\t}\r\n}\r\n';
        const updated = updateGlobalBlock(original, LOG_CONFIG);
        expect(updated.startsWith('{\r\n\tadmin off\r\n\tlog {\n')).toBe(true);
        expect(updated.endsWith('\t}\r\n}\r\n')).toBe(true);
        expect(parseLogConfig(updated)).toEqual({ ...LOG_CONFIG, enabled: true });
    });

    it('keeps a trailing comment when removing the default logger', () => {
        const original = '{\n\tadmin off\n\tlog {\n\t\toutput stderr\n\t} # keep this comment\n}\n';
        expect(updateGlobalBlock(original, { enabled: false })).toBe('{\n\tadmin off\n # keep this comment\n}\n');
    });

    it('log directive stays at global depth, not inside acme_dns', () => {
        const result = updateGlobalBlock(NESTED_CADDYFILE, LOG_CONFIG);
        const lines = result.split('\n');
        const logLine = lines.find(l => /^\s*log\s*\{/.test(l));
        const acmeLine = lines.find(l => /^\s*acme_dns/.test(l));
        const logIndent = logLine.match(/^(\s*)/)[1].length;
        const acmeIndent = acmeLine.match(/^(\s*)/)[1].length;
        expect(logIndent).toBe(acmeIndent);
    });
});

describe('extractGlobalBlock', () => {
    it('returns null when no global block exists', () => {
        expect(extractGlobalBlock('app.example.com {\n}')).toBeNull();
    });

    it('extracts a global block with nested directives', () => {
        const content = `{
\tacme_dns cloudflare {
\t\tapi_token {env.CF_API_TOKEN}
\t}
}`;
        const result = extractGlobalBlock(content);
        expect(result).not.toBeNull();
        expect(result.text).toBe(content);
        expect(result.inner).toContain('acme_dns');
    });
});

describe('extractDirectiveBlock', () => {
    it('returns null when directive is absent', () => {
        expect(extractDirectiveBlock('\temail admin@example.com', 'log')).toBeNull();
    });

    it('extracts a nested directive block', () => {
        const inner = `\tlog {
\t\toutput file /tmp/x.log {
\t\t\troll_size 50mb
\t\t}
\t\tformat json
\t}`;
        const result = extractDirectiveBlock(inner, 'log');
        expect(result).not.toBeNull();
        expect(result.inner).toContain('format json');
        expect(result.inner).toContain('roll_size 50mb');
    });
});

describe('logging edits preserve unrelated Caddyfile content', () => {
    const settings = { enabled: true, path: '/tmp/new.log', rollSize: '25mb', rollKeep: 3, format: 'console', level: 'WARN' };
    const site = '\n\n:8080 {\n respond <<BODY\n{\n"log": "literal } text"\n}\nBODY\n}\n';

    it('adds logging to a commented global opening with literal braces', () => {
        const prefix = '# Keep this header and its brace: {\n';
        const existing = '    storage file_system {\n        root "/tmp/caddy{state"\n    }\n    # Example: log {\n';
        const original = prefix + '{ # options\n' + existing + '}' + site;
        const updated = updateGlobalBlock(original, settings);
        expect(updated.startsWith(prefix + '{ # options\n' + existing)).toBe(true);
        expect(updated.endsWith('}' + site)).toBe(true);
        expect(parseLogConfig(updated)).toEqual(settings);
    });

    it('does not mistake heredoc contents for a global block', () => {
        const updated = updateGlobalBlock(site, settings);
        expect(updated.endsWith(site)).toBe(true);
        expect(parseLogConfig(updated)).toEqual(settings);
    });

    it('replaces only the default logger, preserving named loggers and surrounding comments', () => {
        const audit = '    log audit {\n        output file /tmp/audit.log\n        format json\n    }\n';
        const original = '{\n' + audit + '    log default {\n        output stderr\n    } # keep this comment\n}' + site;
        const updated = updateGlobalBlock(original, settings);
        expect(updated).toContain(audit);
        expect(updated).toContain('} # keep this comment');
        expect(updated.endsWith(site)).toBe(true);
        expect(parseLogConfig(updated)).toEqual(settings);
        const disabled = updateGlobalBlock(updated, { enabled: false });
        expect(disabled).toContain(audit);
        expect(parseLogConfig(disabled).enabled).toBe(false);
    });

    it('reads direct-child settings without taking option names from comments or literal values', () => {
        const source = '{\nlog {\n# format console\noutput file `/tmp/path with spaces{}/events.log` {\n# roll_size 999mb\nroll_size 10mb\nroll_keep 2\n}\nformat json\nlevel INFO\n}\n}';
        const parsed = parseLogConfig(source);
        expect(parsed).toEqual({ enabled: true, path: '/tmp/path with spaces{}/events.log', rollSize: '10mb', rollKeep: 2, format: 'json', level: 'INFO' });
        expect(parseLogConfig(updateGlobalBlock(source, parsed))).toEqual(parsed);
    });

    it('does not rewrite anything when the default logger is already absent and disabled', () => {
        const original = '# Keep whitespace\n{ # options\n\tadmin off\n}\n' + site;
        expect(updateGlobalBlock(original, { enabled: false })).toBe(original);
    });
});
