import { fileURLToPath } from 'node:url';
import { defineConfig, searchForWorkspaceRoot } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
    root: fileURLToPath(new URL('.', import.meta.url)),
    base: './',
    plugins: [react()],
    // Preview wrappers and real frontend components must share context providers.
    resolve: { dedupe: ['react', 'react-dom', 'i18next', 'react-i18next', 'react-router', 'react-router-dom',
        '@codemirror/view', '@codemirror/state'] },
    define: { 'import.meta.env.VITE_APP_VERSION': JSON.stringify('dev') },
    server: {
        host: '127.0.0.1', port: 5174, strictPort: true, watch: { ignoreInitial: true },
        // The playground imports the app's CSS; its bundled font files also
        // need to be served from the sibling frontend package during development.
        fs: { allow: [
            searchForWorkspaceRoot(fileURLToPath(new URL('.', import.meta.url))),
            fileURLToPath(new URL('../../src/frontend', import.meta.url)),
        ] },
    },
    build: { outDir: '../../src/frontend/dist-playground', emptyOutDir: true, rolldownOptions: { input: {
        index: fileURLToPath(new URL('index.html', import.meta.url)),
        frame: fileURLToPath(new URL('frame.html', import.meta.url)),
    } } },
});
