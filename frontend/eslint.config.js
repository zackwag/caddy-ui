import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import i18next from 'eslint-plugin-i18next';
import i18nLiteralOptions from './eslint/i18n-literal-options.mjs';

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
        },
    },
    {
        files: [
            'src/i18n/**/*.{js,jsx}',
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
        files: ['scripts/**/*.mjs'],
        languageOptions: {
            ecmaVersion: 'latest',
            sourceType: 'module',
            globals: globals.node,
        },
        rules: js.configs.recommended.rules,
    },
];
