import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
    plugins: [react()],
    // Dev-only: mirror nginx.conf's /api proxy so `npm run dev` reaches a locally running backend.
    server: {
        proxy: {
            '/api': 'http://localhost:3001',
        },
    },
});
