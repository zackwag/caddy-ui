# Caddyfile behavior

## Caddyfile Titles

When enabled, route titles are stored as `#` comments inside each site block in your Caddyfile instead of in `route-notes.json`. This keeps titles co-located with the routes they describe and follows caddy/ui's principle of using the Caddyfile as the source of truth.

```caddyfile
blog.example.com {
    # My Blog
    reverse_proxy 192.168.4.88:8250
}
```

The first `#` comment inside a site block is treated as the title. It appears in the Route Manager search results and in the edit modal's Title field.

**Auto-detection (default):** On startup, if `route-notes.json` has existing entries, Caddyfile titles are disabled so nothing changes. On a fresh install with no notes, it is enabled automatically.

**Manual override:** Set the `CADDYFILE_TITLES` environment variable to `true` or `false` to force the behavior. When switching from `route-notes.json` to Caddyfile titles, existing notes will appear as the default title in the edit modal — save the route to write the title into the Caddyfile.

## Environment Variables in Caddyfile

Caddy supports `{$VAR_NAME}` syntax in the Caddyfile. Set the vars in your Caddy container's environment and they will be substituted at reload time:

```caddyfile
{
    admin 0.0.0.0:2019
    email {$EMAIL}
}

blog.{$DOMAIN} {
    reverse_proxy 192.168.4.88:8250
}
```

## Caddyfile Syntax Highlighting

The editor's Caddyfile highlighting is a [CodeMirror 6](https://codemirror.net/) `StreamLanguage` mode generated from [**zackwag/caddyfile-codemirror**](https://github.com/zackwag/caddyfile-codemirror), a small companion repo that stays in sync — automatically, every day — with the Caddyfile keyword vocabulary (directives, global options, subdirectives, matcher names, and plugin vocabulary) from [**Sean Whalen**](https://github.com/seanthegeek)'s [**rouge-lexer-caddyfile**](https://github.com/seanthegeek/rouge-lexer-caddyfile), the [Rouge](http://rouge.jneen.net/) lexer Jekyll/GitHub Pages uses to highlight ` ```caddyfile ` code blocks. That gem is the actual research into Caddy's (and its most-downloaded plugins') documented syntax; the CodeMirror mode is a hand-written translation of its grammar into CodeMirror's token-stream API.

`frontend/scripts/fetch-caddyfile-mode.mjs` fetches the latest generated file at dev/build time (wired into `npm run dev` and `npm run build` via `predev`/`prebuild`), so `frontend/src/lib/caddyfileMode.js` is gitignored here rather than vendored by hand — it always reflects whatever `caddyfile-codemirror` last synced from the gem. If you're building offline, run `npm run dev`/`npm run build` once with connectivity first so the fetch has a local copy to fall back on.
