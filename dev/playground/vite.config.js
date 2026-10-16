import { fileURLToPath } from 'node:url';
import { defineConfig, normalizePath } from 'vite';
import react from '@vitejs/plugin-react';
import { sourceFingerprint, sourceInputs } from './capture-source.mjs';

const sources = sourceInputs.map(path => normalizePath(fileURLToPath(new URL(`../../${path}`, import.meta.url))));

const captureFreshness = {
    name: 'preview-capture-freshness',
    configureServer(server) {
        server.watcher.add(sources);
        let timer;
        function changed(path) {
            path = normalizePath(path);
            if (!sources.some(source => path === source || path.startsWith(source + '/'))) return;
            clearTimeout(timer);
            timer = setTimeout(() => { void server.restart().catch(error => server.config.logger.error(error.message)); }, 100);
        }
        for (const event of ['add', 'change', 'unlink']) server.watcher.on(event, changed);
        server.httpServer?.once('close', () => clearTimeout(timer));
    },
};

export default defineConfig(async () => ({
    root: fileURLToPath(new URL('.', import.meta.url)),
    base: './',
    plugins: [react(), captureFreshness],
    // Preview wrappers and real frontend components must share context providers.
    resolve: { dedupe: ['react', 'react-dom', 'i18next', 'react-i18next', 'react-router', 'react-router-dom'] },
    define: { __PREVIEW_SOURCE_HASH__: JSON.stringify(await sourceFingerprint()) },
    server: { host: '127.0.0.1', port: 5174, strictPort: true, watch: { ignoreInitial: true } },
    build: { outDir: '../../src/frontend/dist-playground', emptyOutDir: true, rolldownOptions: { input: {
        index: fileURLToPath(new URL('index.html', import.meta.url)),
        frame: fileURLToPath(new URL('frame.html', import.meta.url)),
    } } },
}));
