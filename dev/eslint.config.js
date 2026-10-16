import backendConfig from '../src/backend/eslint.config.js';
import { componentConfig, nodeToolConfig } from '../src/frontend/eslint.config.js';

export default [
    { linterOptions: { reportUnusedDisableDirectives: 'off' } },
    ...backendConfig.map(config => ({ ...config, files: ['dev-caddy/**/*.mjs', 'integration/**/*.mjs'] })),
    {
        ...componentConfig,
        files: ['playground/**/*.{js,jsx}'],
        rules: {
            ...componentConfig.rules,
            // Separate English-only contributor tool; never shipped in the app.
            'i18next/no-literal-string': 'off',
        },
    },
    { ...nodeToolConfig, files: ['eslint.config.js', 'playground/**/*.mjs', 'playground/vite.config.js'] },
    {
        ...nodeToolConfig,
        files: ['e2e/**/*.mjs'],
        languageOptions: {
            ...nodeToolConfig.languageOptions,
            globals: { ...nodeToolConfig.languageOptions.globals, ...componentConfig.languageOptions.globals },
        },
    },
    {
        files: ['playground/Workbench.jsx'],
        languageOptions: { globals: { __PREVIEW_SOURCE_HASH__: 'readonly' } },
    },
    {
        files: ['playground/check-browser.mjs'],
        languageOptions: { globals: componentConfig.languageOptions.globals },
    },
];
