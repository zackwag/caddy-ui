import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import i18next from 'eslint-plugin-i18next';

export default [
    { ignores: ['dist', 'src/lib/caddyfileMode.js'] },
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
            'i18next/no-literal-string': [
                'warn',
                {
                    mode: 'all',

                    'jsx-attributes': {
                        exclude: [
                            '^className$',
                            '^path$',
                            '^to$',
                            '^key$',
                            '^value$',
                            '^type$',
                            '^id$',
                            '^name$',
                            '^style$',
                            '^role$',
                            '^href$',
                            '^src$',
                            '^data-',
                        ],
                    },

                    callees: {
                        exclude: [
                            '^navigate$',
                            '^t$',
                        ],
                    },

                    words: {
                        exclude: [
                            '^en$',
                            '^dark$',
                            '^light$',
                            '^/.*$',
                            '^https?://',
                            '^--.*$',
                            '^data-[a-z0-9-]+$',
                            '^[^A-Za-zÀ-ž]+$',
                        ],
                    },
                },
            ],
        },
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
