import assert from 'node:assert/strict';
import test from 'node:test';
import { documentationTarget, resolveDocumentation } from '../theme/versions-model.js';

test('resolver distinguishes released books, component publications, old/missing books, and development builds', () => {
    const catalog = { repository: 'zackwag/caddy-ui', development: { path: 'dev/', pages: ['index.html'] },
        books: { shared: { path: 'books/shared/', pages: ['index.html', 'nested/page.html'] } },
        releases: ['v2.20.0', 'v2.20.1', 'v2.20.2', 'v1.13'].map((tag, i) => ({ tag, snapshot: i < 2 ? 'shared' : null,
            images: { frontend: { version: tag.slice(1) }, backend: { version: tag.slice(1) } } })),
    };
    const params = text => new URLSearchParams(text);
    assert.equal(documentationTarget(catalog, '2.20.0').kind, 'book');
    assert.equal(documentationTarget(catalog, 'v2.20.2').kind, 'notes');
    assert.equal(documentationTarget(catalog, '1.13').href, 'https://github.com/zackwag/caddy-ui/releases/tag/v1.13');
    assert.equal(documentationTarget(catalog, '99.0.0').kind, 'notes');
    assert.equal(documentationTarget(catalog, '99.0.0').href, 'https://github.com/zackwag/caddy-ui/releases');
    assert.match(documentationTarget(catalog, 'edge-abcd').href, /^dev\/index.html/);
    for (const input of ['https://evil.example', 'javascript:alert(1)', '../../', '']) assert.equal(documentationTarget(catalog, input), null);
    assert.equal(resolveDocumentation(catalog, params('frontend=2.20.0&backend=2.20.0')).kind, 'redirect');
    assert.equal(resolveDocumentation(catalog, params('frontend=2.20.0&backend=2.20.1')).kind, 'choose');
    assert.equal(resolveDocumentation(catalog, params('version=2.20.0&backend=2.20.1')).kind, 'invalid');
    catalog.releases.find(r => r.tag === 'v2.20.0').images.backend = null;
    assert.equal(resolveDocumentation(catalog, params('backend=2.20.0')).target.kind, 'notes');
    const missing = documentationTarget(catalog, '2.20.0', { page: '../../escape.html', hash: '#unsafe' });
    assert(missing.href.includes('/index.html?'));
    assert(!missing.href.endsWith('#unsafe'));
});
