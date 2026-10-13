import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import i18next from 'eslint-plugin-i18next';
import i18nLiteralOptions from './eslint/i18n-literal-options.mjs';
import localizedErrorToast from './eslint/localized-error-toast.mjs';

export default [
    {
        ignores: ['dist', 'src/lib/caddyfileMode.js'],
        linterOptions: {
            reportUnusedDisableDirectives: 'off',
        },
    },
    {
        files: ['src/**/*.{js,jsx}'],
        languageOptions: {
            ecmaVersion: 'latest',
            sourceType: 'module',
            globals: globals.browser,
            parserOptions: {
                ecmaFeatures: { jsx: true },
            },
        },
        plugins: {
            'react-hooks': reactHooks,
            'react-refresh': reactRefresh,
            i18next,
            local: {
                rules: {
                    'localized-error-toast': localizedErrorToast,
                },
            },
        },
        rules: {
            ...js.configs.recommended.rules,
            'no-unused-vars': ['error', { args: 'none' }],
            'react-hooks/rules-of-hooks': 'error',
            'react-hooks/exhaustive-deps': 'warn',
            'react-refresh/only-export-components': [
                'warn',
                { allowConstantExport: true, allowExportNames: ['useToast', 'useConfirm'] },
            ],
            'i18next/no-literal-string': ['warn', i18nLiteralOptions],
            'local/localized-error-toast': 'error',
        },
    },
    {
        files: [
            'src/i18n/**/*.{js,jsx}',
            // Headless policy module with no user-facing copy.
            'src/utils/notificationCenter.js',
            'src/lib/caddyfileMode.js',
        ],
        rules: {
            'i18next/no-literal-string': 'off',
        },
    },
    {
        files: ['test/**/*.{js,jsx}'],
        languageOptions: {
            ecmaVersion: 'latest',
            sourceType: 'module',
            globals: globals.browser,
            parserOptions: {
                ecmaFeatures: { jsx: true },
            },
        },
        rules: js.configs.recommended.rules,
    },
    {
        files: ['scripts/**/*.mjs', 'eslint/**/*.mjs'],
        languageOptions: {
            ecmaVersion: 'latest',
            sourceType: 'module',
            globals: globals.node,
        },
        rules: js.configs.recommended.rules,
    },
    {
        files: ['e2e/**/*.mjs'],
        languageOptions: {
            ecmaVersion: 'latest',
            sourceType: 'module',
            globals: { ...globals.node, ...globals.browser },
        },
        rules: js.configs.recommended.rules,
    },
];
