import { describe, expect, it } from 'vitest';
import { parseSiteBlocks, sortCaddyfile } from '../src/routes/caddyfile.js';

describe('parseSiteBlocks', () => {
    it('parses a single site block', () => {
        const content = `app.example.com {
    reverse_proxy localhost:8080
}`;
        const { blocks } = parseSiteBlocks(content);
        expect(blocks).toHaveLength(1);
        expect(blocks[0].header).toBe('app.example.com {');
    });

    it('parses multiple site blocks', () => {
        const content = `app.example.com {
    reverse_proxy localhost:8080
}

other.example.com {
    reverse_proxy localhost:9090
}`;
        const { blocks } = parseSiteBlocks(content);
        expect(blocks).toHaveLength(2);
        expect(blocks[0].header).toBe('app.example.com {');
        expect(blocks[1].header).toBe('other.example.com {');
    });

    it('handles nested braces', () => {
        const content = `app.example.com {
    handle /api/* {
        reverse_proxy localhost:8080
    }
}`;
        const { blocks } = parseSiteBlocks(content);
        expect(blocks).toHaveLength(1);
        expect(blocks[0].lines).toHaveLength(5);
    });

    it('skips empty lines and comments', () => {
        const content = `# This is a comment

app.example.com {
    reverse_proxy localhost:8080
}`;
        const { blocks } = parseSiteBlocks(content);
        expect(blocks).toHaveLength(1);
    });

    it('returns empty blocks and loose for empty input', () => {
        const { blocks, loose } = parseSiteBlocks('');
        expect(blocks).toEqual([]);
        expect(loose).toEqual([]);
    });

    it('returns empty blocks for only comments', () => {
        const { blocks } = parseSiteBlocks('# just a comment\n# another');
        expect(blocks).toEqual([]);
    });

    it('captures top-level import lines as loose', () => {
        const content = `import conf.d/*.caddy

app.example.com {
    reverse_proxy localhost:8080
}`;
        const { blocks, loose } = parseSiteBlocks(content);
        expect(blocks).toHaveLength(1);
        expect(loose).toHaveLength(1);
        expect(loose[0]).toContain('import conf.d/*.caddy');
    });
});

describe('sortCaddyfile', () => {
    it('sorts public blocks before internal blocks', () => {
        const content = `grafana.internal {
    reverse_proxy localhost:3000
}

app.example.com {
    reverse_proxy localhost:8080
}`;
        const result = sortCaddyfile(content);
        const appIdx = result.indexOf('app.example.com');
        const grafanaIdx = result.indexOf('grafana.internal');
        expect(appIdx).toBeLessThan(grafanaIdx);
    });

    it('sorts internal blocks before http:// blocks', () => {
        const content = `http://redirect.example.com {
    redir https://example.com
}

grafana.internal {
    reverse_proxy localhost:3000
}`;
        const result = sortCaddyfile(content);
        const internalIdx = result.indexOf('grafana.internal');
        const httpIdx = result.indexOf('http://redirect.example.com');
        expect(internalIdx).toBeLessThan(httpIdx);
    });

    it('preserves the global block at the top', () => {
        const content = `{
    email admin@example.com
}

beta.example.com {
    reverse_proxy localhost:9090
}

app.example.com {
    reverse_proxy localhost:8080
}`;
        const result = sortCaddyfile(content);
        expect(result.indexOf('{')).toBe(0);
        expect(result.indexOf('email admin@example.com')).toBeGreaterThan(0);
        const appIdx = result.indexOf('app.example.com');
        const betaIdx = result.indexOf('beta.example.com');
        expect(appIdx).toBeLessThan(betaIdx);
    });

    it('alphabetizes blocks within each category', () => {
        const content = `charlie.example.com {
    reverse_proxy localhost:3000
}

alpha.example.com {
    reverse_proxy localhost:1000
}

bravo.example.com {
    reverse_proxy localhost:2000
}`;
        const result = sortCaddyfile(content);
        const alphaIdx = result.indexOf('alpha.example.com');
        const bravoIdx = result.indexOf('bravo.example.com');
        const charlieIdx = result.indexOf('charlie.example.com');
        expect(alphaIdx).toBeLessThan(bravoIdx);
        expect(bravoIdx).toBeLessThan(charlieIdx);
    });

    it('preserves top-level import lines', () => {
        const content = `import conf.d/*.caddy

beta.example.com {
    reverse_proxy localhost:9090
}

alpha.example.com {
    reverse_proxy localhost:8080
}`;
        const result = sortCaddyfile(content);
        expect(result).toContain('import conf.d/*.caddy');
        const alphaIdx = result.indexOf('alpha.example.com');
        const betaIdx = result.indexOf('beta.example.com');
        expect(alphaIdx).toBeLessThan(betaIdx);
    });

    it('ends with a trailing newline', () => {
        const content = `app.example.com {
    reverse_proxy localhost:8080
}`;
        const result = sortCaddyfile(content);
        expect(result.endsWith('\n')).toBe(true);
        expect(result.endsWith('\n\n')).toBe(false);
    });
});
