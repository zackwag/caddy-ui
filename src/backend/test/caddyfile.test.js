import { describe, expect, it } from 'vitest';
import { sortCaddyfile } from '../src/caddyfileSort.js';
import { planLegacyHistoryMigration } from '../src/configurationHistory.js';

describe('sortCaddyfile', () => {
    it('sorts public blocks before internal blocks', () => {
        const content = `grafana.internal {
    reverse_proxy localhost:3000
}

app.example.com {
    reverse_proxy localhost:8080
}`;
        expect(sortCaddyfile(content)).toBe(`app.example.com {
    reverse_proxy localhost:8080
}

grafana.internal {
    reverse_proxy localhost:3000
}
`);
    });

    it('sorts internal blocks before http:// blocks', () => {
        const content = `http://redirect.example.com {
    redir https://example.com
}

grafana.internal {
    reverse_proxy localhost:3000
}`;
        expect(sortCaddyfile(content)).toBe(`grafana.internal {
    reverse_proxy localhost:3000
}

http://redirect.example.com {
    redir https://example.com
}
`);
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
        expect(sortCaddyfile(content)).toBe(`{
    email admin@example.com
}

app.example.com {
    reverse_proxy localhost:8080
}

beta.example.com {
    reverse_proxy localhost:9090
}
`);
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
        expect(sortCaddyfile(content)).toBe(`alpha.example.com {
    reverse_proxy localhost:1000
}

bravo.example.com {
    reverse_proxy localhost:2000
}

charlie.example.com {
    reverse_proxy localhost:3000
}
`);
    });

    it('preserves top-level import lines', () => {
        const content = `import conf.d/*.caddy

beta.example.com {
    reverse_proxy localhost:9090
}

alpha.example.com {
    reverse_proxy localhost:8080
}`;
        expect(sortCaddyfile(content)).toBe(`import conf.d/*.caddy

alpha.example.com {
    reverse_proxy localhost:8080
}

beta.example.com {
    reverse_proxy localhost:9090
}
`);
    });

    it('moves a site with nested blocks as a whole', () => {
        const nested = 'b.example.com {\n    handle /api/* {\n        reverse_proxy localhost:8080\n    }\n}';
        expect(sortCaddyfile(nested + '\n\na.example.com {\n    respond "a"\n}\n'))
            .toBe('a.example.com {\n    respond "a"\n}\n\n' + nested + '\n');
    });

    it('keeps a file of only comments', () => {
        expect(sortCaddyfile('# just a comment\n# another')).toBe('# just a comment\n# another\n');
    });

    it('ends with a trailing newline', () => {
        const content = `app.example.com {
    reverse_proxy localhost:8080
}`;
        expect(sortCaddyfile(content)).toBe(content + '\n');
    });
});

describe('sortCaddyfile with literal braces and comments', () => {
    it('does not count braces in quoted values or comments', () => {
        const quoted = 'b.example.com {\n    respond "}"\n    # stray {\n}';
        const result = sortCaddyfile(quoted + '\n\na.example.com {\n    respond "a"\n}\n');
        expect(result).toBe('a.example.com {\n    respond "a"\n}\n\n' + quoted + '\n');
    });

    it('moves top-level comments with the block below them and keeps trailing comments', () => {
        const content = '# Beta service\nb.example.com {\n    respond "b"\n}\n\n# Alpha service\na.example.com {\n    respond "a"\n}\n\n# end of file\n';
        expect(sortCaddyfile(content)).toBe('# Alpha service\na.example.com {\n    respond "a"\n}\n\n# Beta service\nb.example.com {\n    respond "b"\n}\n\n# end of file\n');
    });

    it('keeps a global block with a trailing comment first and snippets before sites', () => {
        const content = '﻿z.example.com {\n    import common\n}\n\n{ # options\n    admin off\n}\n\n(common) {\n    respond "ok"\n}\n';
        expect(sortCaddyfile(content)).toBe('﻿{ # options\n    admin off\n}\n\n(common) {\n    respond "ok"\n}\n\nz.example.com {\n    import common\n}\n');
    });

    it('sorts a site header followed by a comment by its address alone', () => {
        const commented = 'c.example.com { # mirrors grafana.internal\n    respond "c"\n}';
        const content = commented + '\n\nb.internal {\n    respond "b"\n}\n\na.example.com {\n    respond "a"\n}\n';
        expect(sortCaddyfile(content)).toBe('a.example.com {\n    respond "a"\n}\n\n' + commented + '\n\nb.internal {\n    respond "b"\n}\n');
    });

    it('rejects input it cannot structure instead of reordering it', () => {
        expect(() => sortCaddyfile('a.example.com {\n    respond <<BODY\n}\n')).toThrow(SyntaxError);
    });
});

describe('planLegacyHistoryMigration', () => {
    const caddy = { id: 'caddy' };
    const root = ['caddy', 'Caddyfile-2026-08-04T15-49-09', 'Caddyfile-2026-09-21T15-24-01'];

    it('moves root snapshots into the only instance when no default instance exists', () => {
        expect(planLegacyHistoryMigration([caddy], root, ['Caddyfile-2026-09-22T19-51-00']))
            .toEqual({ targetId: 'caddy', moves: ['Caddyfile-2026-08-04T15-49-09', 'Caddyfile-2026-09-21T15-24-01'], orphaned: 0 });
    });

    it('leaves root snapshots alone while a default instance owns them', () => {
        expect(planLegacyHistoryMigration([{ id: 'default' }, caddy], root, [])).toBeNull();
    });

    it('does nothing when there are no root snapshots', () => {
        expect(planLegacyHistoryMigration([caddy], ['caddy'], [])).toBeNull();
    });

    it('skips snapshots that already exist in the target folder', () => {
        expect(planLegacyHistoryMigration([caddy], root, ['Caddyfile-2026-08-04T15-49-09']).moves)
            .toEqual(['Caddyfile-2026-09-21T15-24-01']);
    });

    it('reports them as orphaned when several instances could own them', () => {
        expect(planLegacyHistoryMigration([caddy, { id: 'edge' }], root, []))
            .toEqual({ targetId: null, moves: [], orphaned: 2 });
    });

    it('reports them as orphaned when no instances exist', () => {
        expect(planLegacyHistoryMigration([], root, []).orphaned).toBe(2);
    });
});
