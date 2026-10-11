import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
    root: fileURLToPath(new URL('.', import.meta.url)),
    plugins: [react()],
    server: { host: '0.0.0.0', port: 5174, strictPort: true },
    build: { outDir: '../dist-playground', emptyOutDir: true },
});
