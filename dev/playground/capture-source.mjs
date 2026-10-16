import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../..');

export const sourceInputs = ['src/backend/src', 'src/backend/package.json', 'src/backend/package-lock.json',
    'dev/dev-caddy/harness.mjs', 'src/frontend/src/components/Dashboard.jsx', 'src/frontend/src/components/Notifications.jsx',
    'src/frontend/src/utils/api.js', 'src/frontend/src/utils/format.js'];

export async function sourceFingerprint() {
    async function files(directory) {
        const paths = [];
        for (const entry of await readdir(resolve(root, directory), { withFileTypes: true })) {
            const path = `${directory}/${entry.name}`;
            if (entry.isDirectory()) paths.push(...await files(path));
            else if (entry.isFile()) paths.push(path);
        }
        return paths;
    }
    const paths = [...await files(sourceInputs[0]), ...sourceInputs.slice(1)];
    const hash = createHash('sha256');
    for (const path of paths.sort()) { hash.update(path); hash.update(await readFile(resolve(root, path))); }
    return hash.digest('hex');
}
