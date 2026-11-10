// Curated Caddyfile snippet templates inserted by the editor's context menu.
// Each snippet declares which editing context it belongs to (from contextKind
// in caddyfileStructure.js), so the menu only shows relevant items. Templates
// use tab indentation to match `caddy fmt`.

/* eslint-disable i18next/no-literal-string -- Caddyfile syntax templates and category labels, not translatable UI copy */

// Context values from caddyfileStructure.contextKind:
// 'none'           — top level, outside any block (site addresses)
// 'global'         — inside the global options block
// 'directive'      — inside a site block (or handle/route)
// 'subdirective'   — inside a directive block

export const SNIPPET_CATEGORIES = [
    {
        key: 'siteBlocks',
        context: 'none',
        snippets: [
            {
                key: 'reverseProxy',
                template: 'example.com {\n\treverse_proxy localhost:8080\n}\n',
            },
            {
                key: 'redirect',
                template: 'old.example.com {\n\tredir https://new.example.com{uri} permanent\n}\n',
            },
            {
                key: 'fileServer',
                template: 'static.example.com {\n\troot * /srv\n\tfile_server\n}\n',
            },
            {
                key: 'staticResponse',
                template: 'example.com {\n\trespond "Hello, world!" 200\n}\n',
            },
        ],
    },
    {
        key: 'directives',
        context: 'directive',
        snippets: [
            {
                key: 'reverseProxy',
                template: 'reverse_proxy localhost:8080',
            },
            {
                key: 'reverseProxyWithHealth',
                template: 'reverse_proxy localhost:8080 {\n\thealth_uri /health\n\thealth_interval 10s\n}',
            },
            {
                key: 'redir',
                template: 'redir /old /new permanent',
            },
            {
                key: 'respond',
                template: 'respond "OK" 200',
            },
            {
                key: 'fileServer',
                template: 'root * /srv\nfile_server',
            },
            {
                key: 'header',
                template: 'header {\n\tX-Frame-Options DENY\n\tX-Content-Type-Options nosniff\n\tReferrer-Policy strict-origin-when-cross-origin\n}',
            },
            {
                key: 'encode',
                template: 'encode zstd gzip',
            },
            {
                key: 'tls',
                template: 'tls {$TLS_EMAIL}',
            },
            {
                key: 'log',
                template: 'log {\n\toutput file /var/log/caddy/access.log\n}',
            },
            {
                key: 'handle',
                template: 'handle {\n\t\n}',
            },
            {
                key: 'handlePath',
                template: 'handle_path /prefix/* {\n\t\n}',
            },
            {
                key: 'basicauth',
                template: 'basicauth {\n\tuser $2a$14$hashhere\n}',
            },
        ],
    },
    {
        key: 'globalOptions',
        context: 'global',
        snippets: [
            {
                key: 'email',
                template: 'email admin@example.com',
            },
            {
                key: 'admin',
                template: 'admin off',
            },
            {
                key: 'logGlobal',
                template: 'log {\n\toutput stderr\n\tlevel INFO\n}',
            },
            {
                key: 'servers',
                template: 'servers {\n\tprotocols h1 h2 h3\n}',
            },
        ],
    },
];

/* eslint-enable i18next/no-literal-string */

// Returns the categories applicable to `kind` (from contextKind).
export function snippetsForContext(kind) {
    return SNIPPET_CATEGORIES.filter(cat => cat.context === kind);
}
