import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { backfill } from './history-backfill.mjs';
import { collectInventory, options } from './history-inventory.mjs';

// An incremental crawl preserves verified snapshots, even when new release tags
// or image publications extend the inventory. Failed books remain explicit;
// publication offers release notes for them. Retrying is a maintainer action.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const controller = new AbortController();
    const stop = () => controller.abort(new Error('Crawl interrupted'));
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
    try {
        const args = options(process.argv.slice(2), ['repo', 'inventory', 'output', 'mdbook', 'grouping', 'to', 'versions-ref', 'retry-failed']);
        if (args['retry-failed'] !== undefined && !['true', 'false'].includes(args['retry-failed'])) {
            throw new Error('--retry-failed must be true or false');
        }
        const root = resolve(args.repo || fileURLToPath(new URL('../..', import.meta.url)));
        const inventory = args.inventory ? JSON.parse(readFileSync(resolve(args.inventory), 'utf8'))
            : collectInventory(root, { to: args.to, versionsRef: args['versions-ref'] });
        const grouping = JSON.parse(readFileSync(resolve(args.grouping || root + '/docs/history/groups.json'), 'utf8'));
        const { results } = await backfill({ root, inventory, grouping, output: resolve(args.output || root + '/.docs-history'),
            mdbook: args.mdbook || 'mdbook', reuse: true, retryFailed: args['retry-failed'] === 'true', signal: controller.signal });
        const unavailable = results.filter(result => result.status === 'failed');
        console.log(`${results.length - unavailable.length} books available; ${unavailable.length} releases require a release-notes fallback.`);
    } catch (error) {
        console.error(error.message);
        process.exitCode = 1;
    } finally {
        process.removeListener('SIGINT', stop);
        process.removeListener('SIGTERM', stop);
    }
}
