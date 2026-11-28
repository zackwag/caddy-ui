import { once } from 'node:events';
import { readFile, stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, join, resolve, sep } from 'node:path';

const types = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.css': 'text/css',
    '.png': 'image/png', '.svg': 'image/svg+xml', '.woff': 'font/woff', '.woff2': 'font/woff2' };

// Serves `directory` at `base` on a loopback port. A path outside `base`, or a
// file that doesn't exist, is reported to `onMissing` and answered with
// `fallback` (a file in `directory`, for single-page apps) or a 404.
export async function serveDirectory(directory, { base = '/', fallback, onMissing = () => {} } = {}) {
    const root = resolve(directory);
    const server = createServer(async (req, res) => {
        const path = new URL(req.url, 'http://static.invalid').pathname;
        if (path === '/favicon.ico') {
            res.writeHead(204).end();
            return;
        }
        try {
            if (!path.startsWith(base)) {
                throw new Error('Outside the served base');
            }
            let file = resolve(root, decodeURIComponent(path.slice(base.length)) || 'index.html');
            if (file !== root && !file.startsWith(root + sep)) {
                res.writeHead(403).end();
                return;
            }
            if ((await stat(file)).isDirectory()) {
                file = join(file, 'index.html');
            }
            const body = await readFile(file);
            res.writeHead(200, { 'Content-Type': types[extname(file)] || 'application/octet-stream' }).end(body);
        } catch {
            onMissing(path);
            try {
                if (!fallback) {
                    throw new Error('No fallback');
                }
                const body = await readFile(join(root, fallback));
                res.writeHead(200, { 'Content-Type': types[extname(fallback)] || 'application/octet-stream' }).end(body);
            } catch {
                res.writeHead(404).end();
            }
        }
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    return server;
}
