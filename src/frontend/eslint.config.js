import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import i18next from 'eslint-plugin-i18next';
import i18nLiteralOptions from './eslint/i18n-literal-options.mjs';

export const componentConfig = {
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
        curly: ['error', 'all'],
        'no-unused-vars': ['error', { args: 'none' }],
        'react-hooks/rules-of-hooks': 'error',
        'react-hooks/exhaustive-deps': 'warn',
        'react-refresh/only-export-components': [
            'warn',
            { allowConstantExport: true, allowExportNames: ['useToast', 'useConfirm'] },
        ],
        'i18next/no-literal-string': ['warn', i18nLiteralOptions],
    },
};

export const nodeToolConfig = {
    languageOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
        globals: globals.node,
    },
    rules: { ...js.configs.recommended.rules, curly: ['error', 'all'] },
};

export default [
    // Alone in its object, so these are skipped rather than linted without rules
    { ignores: ['dist', 'dist-playground', 'src/lib/caddyfileMode.js'] },
    { linterOptions: { reportUnusedDisableDirectives: 'off' } },
    { ...componentConfig, files: ['src/**/*.{js,jsx}'] },
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
        rules: { ...js.configs.recommended.rules, curly: ['error', 'all'] },
    },
    { ...nodeToolConfig, files: ['scripts/**/*.mjs', 'eslint/**/*.mjs'] },
];
