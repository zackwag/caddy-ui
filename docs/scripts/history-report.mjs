import { mkdirSync, readFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeBookReport } from './history-books.mjs';
import { options } from './history-inventory.mjs';

let lock;
try {
    const root = fileURLToPath(new URL('../..', import.meta.url));
    const args = options(process.argv.slice(2), ['output', 'grouping']);
    const output = resolve(args.output || join(root, '.docs-history'));
    mkdirSync(join(output, '.lock'));
    lock = join(output, '.lock');
    const manifest = JSON.parse(readFileSync(join(output, 'backfill.json'), 'utf8'));
    const grouping = JSON.parse(readFileSync(resolve(args.grouping || join(root, 'docs/history/groups.json')), 'utf8'));
    if (manifest.schema !== 1) throw new Error('Unsupported backfill manifest');
    const groups = writeBookReport(output, manifest.inventory, manifest.results, grouping);
    console.log(`${new Set(groups.map(group => group.snapshot).filter(Boolean)).size} selected books; report: ${join(output, 'report.md')}`);
} catch (error) {
    console.error(error.message);
    process.exitCode = 1;
} finally {
    if (lock) rmSync(lock, { recursive: true });
}
