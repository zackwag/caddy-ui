// Curated Caddyfile snippet templates inserted by the editor's context menu
// and autocomplete. Each snippet declares which editing context it belongs to
// (from contextKind in caddyfileStructure.js), so the menu only shows relevant
// items. `template` is plain text for the context menu; `snippetTemplate` uses
// CodeMirror's snippet syntax (#{n:placeholder}) for tab-stop completions.
// Templates use tab indentation to match `caddy fmt`.

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
                snippetTemplate: '#{1:example.com} {\n\treverse_proxy #{2:localhost:8080}\n}\n',
            },
            {
                key: 'redirect',
                template: 'old.example.com {\n\tredir https://new.example.com{uri} permanent\n}\n',
                snippetTemplate: '#{1:old.example.com} {\n\tredir #{2:https://new.example.com}{uri} #{3:permanent}\n}\n',
            },
            {
                key: 'fileServer',
                template: 'static.example.com {\n\troot * /srv\n\tfile_server\n}\n',
                snippetTemplate: '#{1:static.example.com} {\n\troot * #{2:/srv}\n\tfile_server\n}\n',
            },
            {
                key: 'staticResponse',
                template: 'example.com {\n\trespond "Hello, world!" 200\n}\n',
                snippetTemplate: '#{1:example.com} {\n\trespond "#{2:Hello, world!}" #{3:200}\n}\n',
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
                snippetTemplate: 'reverse_proxy #{1:localhost:8080}',
            },
            {
                key: 'reverseProxyWithHealth',
                template: 'reverse_proxy localhost:8080 {\n\thealth_uri /health\n\thealth_interval 10s\n}',
                snippetTemplate: 'reverse_proxy #{1:localhost:8080} {\n\thealth_uri #{2:/health}\n\thealth_interval #{3:10s}\n}',
            },
            {
                key: 'redir',
                template: 'redir /old /new permanent',
                snippetTemplate: 'redir #{1:/old} #{2:/new} #{3:permanent}',
            },
            {
                key: 'respond',
                template: 'respond "OK" 200',
                snippetTemplate: 'respond "#{1:OK}" #{2:200}',
            },
            {
                key: 'fileServer',
                template: 'root * /srv\nfile_server',
                snippetTemplate: 'root * #{1:/srv}\nfile_server',
            },
            {
                key: 'header',
                template: 'header {\n\tX-Frame-Options DENY\n\tX-Content-Type-Options nosniff\n\tReferrer-Policy strict-origin-when-cross-origin\n}',
                snippetTemplate: 'header {\n\t#{1:X-Frame-Options} #{2:DENY}\n\t#{3}\n}',
            },
            {
                key: 'encode',
                template: 'encode zstd gzip',
                snippetTemplate: 'encode #{1:zstd gzip}',
            },
            {
                key: 'tls',
                template: 'tls {$TLS_EMAIL}',
                snippetTemplate: 'tls #{1:email@example.com}',
            },
            {
                key: 'log',
                template: 'log {\n\toutput file /var/log/caddy/access.log\n}',
                snippetTemplate: 'log {\n\toutput file #{1:/var/log/caddy/access.log}\n}',
            },
            {
                key: 'handle',
                template: 'handle {\n\t\n}',
                snippetTemplate: 'handle {\n\t#{1}\n}',
            },
            {
                key: 'handlePath',
                template: 'handle_path /prefix/* {\n\t\n}',
                snippetTemplate: 'handle_path #{1:/prefix/*} {\n\t#{2}\n}',
            },
            {
                key: 'basicauth',
                template: 'basicauth {\n\tuser $2a$14$hashhere\n}',
                snippetTemplate: 'basicauth {\n\t#{1:user} #{2:hash}\n}',
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
                snippetTemplate: 'email #{1:admin@example.com}',
            },
            {
                key: 'admin',
                template: 'admin off',
                snippetTemplate: 'admin #{1:off}',
            },
            {
                key: 'logGlobal',
                template: 'log {\n\toutput stderr\n\tlevel INFO\n}',
                snippetTemplate: 'log {\n\toutput #{1:stderr}\n\tlevel #{2:INFO}\n}',
            },
            {
                key: 'servers',
                template: 'servers {\n\tprotocols h1 h2 h3\n}',
                snippetTemplate: 'servers {\n\tprotocols #{1:h1 h2 h3}\n}',
            },
        ],
    },
];

/* eslint-enable i18next/no-literal-string */

// Returns the categories applicable to `kind` (from contextKind).
export function snippetsForContext(kind) {
    return SNIPPET_CATEGORIES.filter(cat => cat.context === kind);
}
