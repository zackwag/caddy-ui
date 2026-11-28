// Curated Caddyfile snippet templates inserted by the editor's context menu
// and autocomplete. Each snippet declares which editing context it belongs to
// (from contextKind in caddyfileStructure.js), so the menu only shows relevant
// items. `template` uses CodeMirror's snippet syntax (#{n:placeholder}) for
// tab-stop completions. The menu inserts it as text, or `text` where an example
// worth inserting says more than the placeholders do.
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
                template: '#{1:example.com} {\n\treverse_proxy #{2:localhost:8080}\n}\n',
            },
            {
                key: 'redirect',
                template: '#{1:old.example.com} {\n\tredir #{2:https://new.example.com}{uri} #{3:permanent}\n}\n',
            },
            {
                key: 'fileServer',
                template: '#{1:static.example.com} {\n\troot * #{2:/srv}\n\tfile_server\n}\n',
            },
            {
                key: 'staticResponse',
                template: '#{1:example.com} {\n\trespond "#{2:Hello, world!}" #{3:200}\n}\n',
            },
        ],
    },
    {
        key: 'directives',
        context: 'directive',
        snippets: [
            {
                key: 'reverseProxy',
                template: 'reverse_proxy #{1:localhost:8080}',
            },
            {
                key: 'reverseProxyWithHealth',
                template: 'reverse_proxy #{1:localhost:8080} {\n\thealth_uri #{2:/health}\n\thealth_interval #{3:10s}\n}',
            },
            {
                key: 'redir',
                template: 'redir #{1:/old} #{2:/new} #{3:permanent}',
            },
            {
                key: 'respond',
                template: 'respond "#{1:OK}" #{2:200}',
            },
            {
                key: 'fileServer',
                template: 'root * #{1:/srv}\nfile_server',
            },
            {
                key: 'header',
                template: 'header {\n\t#{1:X-Frame-Options} #{2:DENY}\n\t#{3}\n}',
                text: 'header {\n\tX-Frame-Options DENY\n\tX-Content-Type-Options nosniff\n\tReferrer-Policy strict-origin-when-cross-origin\n}',
            },
            {
                key: 'encode',
                template: 'encode #{1:zstd gzip}',
            },
            {
                key: 'tls',
                template: 'tls #{1:email@example.com}',
                text: 'tls {$TLS_EMAIL}',
            },
            {
                key: 'log',
                template: 'log {\n\toutput file #{1:/var/log/caddy/access.log}\n}',
            },
            {
                key: 'handle',
                template: 'handle {\n\t#{1}\n}',
            },
            {
                key: 'handlePath',
                template: 'handle_path #{1:/prefix/*} {\n\t#{2}\n}',
            },
            {
                key: 'basicauth',
                template: 'basicauth {\n\t#{1:user} #{2:hash}\n}',
                text: 'basicauth {\n\tuser $2a$14$hashhere\n}',
            },
        ],
    },
    {
        key: 'globalOptions',
        context: 'global',
        snippets: [
            {
                key: 'email',
                template: 'email #{1:admin@example.com}',
            },
            {
                key: 'admin',
                template: 'admin #{1:off}',
            },
            {
                key: 'logGlobal',
                template: 'log {\n\toutput #{1:stderr}\n\tlevel #{2:INFO}\n}',
            },
            {
                key: 'servers',
                template: 'servers {\n\tprotocols #{1:h1 h2 h3}\n}',
            },
        ],
    },
];

/* eslint-enable i18next/no-literal-string */

export function snippetsForContext(kind) {
    return SNIPPET_CATEGORIES.filter(cat => cat.context === kind);
}

export function snippetText({ template, text }) {
    return text ?? template.replace(/#\{\d+(?::([^}]*))?\}/g, (_, placeholder) => placeholder ?? '');
}
