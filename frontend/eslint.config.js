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
                            '^navigate
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
,
                            '^t
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
,
                            '^document\\.createElement
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
,
                            '^window\\.open
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
,
                        ],
                    },

                    'object-properties': {
                        exclude: [
                            '^(background|color|font.*|lineHeight|caretColor|border.*|padding.*|margin.*|width|height|minWidth|minHeight|maxWidth|maxHeight|overflow.*|display|gap|alignItems|justifyContent|textAlign|textTransform|letterSpacing|cursor|opacity|boxShadow|flex.*|position|top|right|bottom|left|whiteSpace)
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
,
                        ],
                    },

                    words: {
                        exclude: [
                            '^
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
,
                            '^en
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
,
                            '^dark
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
,
                            '^light
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
,
                            '^vt2026
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
,
                            '^coarse-everywhere
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
,
                            '^caddy/ui
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
,
                            '^/.*
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
,
                            '^https?://',
                            '^--.*
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
,
                            '^var\\(--[a-z0-9-]+\\)
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
,
                            '^data-[a-z0-9-]+
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
,
                            '^(application/json|text/plain)
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
,
                            '^(GET|POST|PUT|PATCH|DELETE)
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
,
                            '^(DEBUG|INFO|WARN|ERROR)
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
,
                            '^(success|error|info)
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
,
                            '^(online|offline|unknown|partial|maintenance|pending|none)
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
,
                            '^(all|asc|desc|diff|raw|current|domain|title|upstream|server|status|expires|days)
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
,
                            '^(json|console|acme|orphaned|superseded|valid|expiring|expired)
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
,
                            '^(ntfy|discord|slack|pushover|custom)
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
,
                            '^(short|numeric|2-digit)
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
,
                            '^(iOS / iPadOS|macOS|Android|Windows)
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
,
                            '^localhost:443 .*reverse_proxy.*
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
,
                            '^[^A-Za-zÀ-ž]+
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
,
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
