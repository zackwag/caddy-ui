import { describe, expect, it } from 'vitest';
import {
    buildCaddyfileBlock,
    buildReverseProxyRoute,
    checkPrimaryServer,
    extractSiteBlock,
    isSimpleReverseProxy,
    removeSiteBlock,
    replaceSiteBlock,
} from '../src/routes/routes.js';

describe('buildReverseProxyRoute', () => {
    it('builds a basic reverse proxy route', () => {
        const route = buildReverseProxyRoute({
            id: 'route-123',
            domain: 'app.example.com',
            upstream: 'localhost:8080',
        });
        expect(route['@id']).toBe('route-123');
        expect(route.match[0].host).toEqual(['app.example.com']);
        expect(route.terminal).toBe(true);
        const proxy = route.handle[0].routes[0].handle[0];
        expect(proxy.handler).toBe('reverse_proxy');
        expect(proxy.upstreams[0].dial).toBe('localhost:8080');
    });

    it('includes path matcher when stripPrefix is set', () => {
        const route = buildReverseProxyRoute({
            id: 'route-456',
            domain: 'app.example.com',
            upstream: 'localhost:9090',
            stripPrefix: '/api',
        });
        expect(route.match).toHaveLength(2);
        expect(route.match[1].path).toEqual(['/api/*']);
    });

    it('omits path matcher when stripPrefix is not set', () => {
        const route = buildReverseProxyRoute({
            id: 'r1',
            domain: 'example.com',
            upstream: 'localhost:3000',
        });
        expect(route.match).toHaveLength(1);
    });

    it('wraps handler in subroute', () => {
        const route = buildReverseProxyRoute({
            id: 'r1',
            domain: 'example.com',
            upstream: 'localhost:3000',
        });
        expect(route.handle[0].handler).toBe('subroute');
        expect(route.handle[0].routes).toHaveLength(1);
    });
});

describe('buildCaddyfileBlock', () => {
    it('builds a simple reverse_proxy block', () => {
        const block = buildCaddyfileBlock({
            domain: 'app.example.com',
            upstream: 'localhost:8080',
        });
        expect(block).toBe(
            'app.example.com {\n    reverse_proxy localhost:8080\n}'
        );
    });

    it('builds a block with stripPrefix', () => {
        const block = buildCaddyfileBlock({
            domain: 'app.example.com',
            upstream: 'localhost:8080',
            stripPrefix: '/api',
        });
        expect(block).toContain('handle /api/* {');
        expect(block).toContain('reverse_proxy localhost:8080');
    });

    it('does not include handle block without stripPrefix', () => {
        const block = buildCaddyfileBlock({
            domain: 'app.example.com',
            upstream: 'localhost:8080',
        });
        expect(block).not.toContain('handle');
    });
});

describe('removeSiteBlock', () => {
    it('removes a domain block from a Caddyfile', () => {
        const caddyfile = `app.example.com {
    reverse_proxy localhost:8080
}

other.example.com {
    reverse_proxy localhost:9090
}
`;
        const result = removeSiteBlock(caddyfile, 'app.example.com');
        expect(result).not.toContain('app.example.com');
        expect(result).toContain('other.example.com');
    });

    it('removes http:// prefixed block', () => {
        const caddyfile = `http://app.example.com {
    reverse_proxy localhost:8080
}
`;
        const result = removeSiteBlock(caddyfile, 'app.example.com');
        expect(result).not.toContain('app.example.com');
    });

    it('removes https:// prefixed block', () => {
        const caddyfile = `https://app.example.com {
    reverse_proxy localhost:8080
}
`;
        const result = removeSiteBlock(caddyfile, 'app.example.com');
        expect(result).not.toContain('app.example.com');
    });

    it('handles nested braces in blocks', () => {
        const caddyfile = `app.example.com {
    handle /api/* {
        reverse_proxy localhost:8080
    }
}

other.example.com {
    reverse_proxy localhost:9090
}
`;
        const result = removeSiteBlock(caddyfile, 'app.example.com');
        expect(result).not.toContain('app.example.com');
        expect(result).toContain('other.example.com');
    });

    it('returns just newline when removing the only block', () => {
        const caddyfile = `app.example.com {
    reverse_proxy localhost:8080
}
`;
        const result = removeSiteBlock(caddyfile, 'app.example.com');
        expect(result.trim()).toBe('');
    });

    it('leaves the file unchanged when domain is not found', () => {
        const caddyfile = `other.example.com {
    reverse_proxy localhost:9090
}
`;
        const result = removeSiteBlock(caddyfile, 'nonexistent.example.com');
        expect(result).toContain('other.example.com');
    });
});

describe('replaceSiteBlock', () => {
    it('replaces a domain block with a new one', () => {
        const caddyfile = `app.example.com {
    reverse_proxy localhost:8080
}

other.example.com {
    reverse_proxy localhost:9090
}
`;
        const newBlock = `app.example.com {
    reverse_proxy localhost:3000
}`;
        const result = replaceSiteBlock(caddyfile, 'app.example.com', newBlock);
        expect(result).toContain('reverse_proxy localhost:3000');
        expect(result).not.toContain('reverse_proxy localhost:8080');
        expect(result).toContain('other.example.com');
    });
});

describe('site block edits with literal braces', () => {
    const heredoc = 'app.example.com {\n    respond <<BODY\n}\nother.example.com {\nBODY\n}';
    const other = 'other.example.com {\n    respond "}" # closing brace\n}';

    it('extracts a block whose heredoc contains braces and a site address', () => {
        const caddyfile = heredoc + '\n\n' + other + '\n';
        expect(extractSiteBlock(caddyfile, 'app.example.com')).toBe(heredoc);
        expect(extractSiteBlock(caddyfile, 'other.example.com')).toBe(other);
    });

    it('removes only the requested block and leaves the rest byte-for-byte', () => {
        const first = '{\n\tadmin off\n}\n\n\n# keep spacing\n';
        const caddyfile = first + heredoc + '\n\n' + other + '\n';
        // A comment above a removed block stays, still separated from the next block.
        expect(removeSiteBlock(caddyfile, 'app.example.com')).toBe(first + '\n' + other + '\n');
        expect(removeSiteBlock(caddyfile, 'other.example.com')).toBe(first + heredoc + '\n');
    });

    it('matches environment placeholders and keeps CRLF line endings', () => {
        const caddyfile = '{$APP_DOMAIN} {\r\n\trespond "app"\r\n}\r\n\r\nother.example.com {\r\n\trespond "other"\r\n}\r\n';
        const env = { APP_DOMAIN: 'app.example.com' };
        expect(extractSiteBlock(caddyfile, 'app.example.com', env)).toBe('{$APP_DOMAIN} {\r\n\trespond "app"\r\n}\r');
        expect(removeSiteBlock(caddyfile, 'app.example.com', env)).toBe('other.example.com {\r\n\trespond "other"\r\n}\n');
    });

    it('does not match a site address that is only a directive argument', () => {
        const caddyfile = 'proxy.example.com {\n    reverse_proxy app.example.com {\n        header_up Host {host}\n    }\n}\n';
        expect(extractSiteBlock(caddyfile, 'app.example.com')).toBeNull();
        expect(removeSiteBlock(caddyfile, 'app.example.com')).toBe(caddyfile);
    });
});

describe('isSimpleReverseProxy', () => {
    it('returns true for a simple subroute reverse_proxy', () => {
        const route = buildReverseProxyRoute({
            id: 'r1',
            domain: 'example.com',
            upstream: 'localhost:3000',
        });
        expect(isSimpleReverseProxy(route)).toBe(true);
    });

    it('returns false when no subroute handler exists', () => {
        expect(isSimpleReverseProxy({ handle: [{ handler: 'file_server' }] })).toBe(false);
    });

    it('returns false when subroute has multiple inner routes', () => {
        const route = {
            handle: [{
                handler: 'subroute',
                routes: [
                    { handle: [{ handler: 'reverse_proxy', upstreams: [{ dial: 'a:1' }] }] },
                    { handle: [{ handler: 'reverse_proxy', upstreams: [{ dial: 'b:2' }] }] },
                ],
            }],
        };
        expect(isSimpleReverseProxy(route)).toBe(false);
    });

    it('returns false when inner route has multiple handles', () => {
        const route = {
            handle: [{
                handler: 'subroute',
                routes: [{
                    handle: [
                        { handler: 'headers' },
                        { handler: 'reverse_proxy', upstreams: [{ dial: 'a:1' }] },
                    ],
                }],
            }],
        };
        expect(isSimpleReverseProxy(route)).toBe(false);
    });

    it('returns false for empty handle array', () => {
        expect(isSimpleReverseProxy({ handle: [] })).toBe(false);
    });

    it('returns false for missing handle', () => {
        expect(isSimpleReverseProxy({})).toBe(false);
    });
});

describe('checkPrimaryServer', () => {
    const servers = { srv0: { listen: [':443'] }, srv1: { listen: [':80'] } };

    it('accepts a server that exists', () => {
        expect(checkPrimaryServer(servers, 'srv0')).toBeNull();
    });

    it('rejects a missing server and lists the real ones', () => {
        const err = checkPrimaryServer(servers, 'media.home');
        expect(err).toContain('"media.home" doesn\'t exist');
        expect(err).toContain('srv0, srv1');
        expect(err).toContain('Instances page');
    });

    it('explains when Caddy has no HTTP servers', () => {
        expect(checkPrimaryServer({}, 'srv0')).toContain('no HTTP servers');
        expect(checkPrimaryServer(null, 'srv0')).toContain('no HTTP servers');
    });
});
