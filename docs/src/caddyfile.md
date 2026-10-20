# Caddyfile behavior

## Saved versions and attribution

Saving commits the resulting Caddyfile as a new history version. Editing text in
the editor alone does not create a version; a confirmed import does. Restoring a
version saves its exact content without formatting or sorting as a new version
attributed to the current account; it does not change the original author.
Save, restore and import have distinct action labels.

History shows the authenticated account or API-token identity, action and apply
outcome for each version. A selected version initially compares with its recorded
predecessor, when retained. Comparisons across several saves show metadata for
both selected versions; they do not assign every changed line to one actor.

The administrator has a persistent account ID, independent of its username.
Snapshots reference that ID, or a token's existing ID. Active names are resolved
when listing history, so renaming an account does not rewrite its snapshots.
A small `actors.json` registry retains the last recorded name for identities that
are no longer present. API tokens remain read-only; token attribution prepares
history for future write scopes without granting them any additional access.

The previous file is preserved before writing. If it differs from the latest
version, it becomes an **Unknown** baseline: a file edited outside the UI is not
attributed to the administrator who next saves it. Old snapshots also remain
Unknown. This does not add background file monitoring or change notifications.

Rejected changes that roll back do not create an attributed saved version.
Force saves kept on disk despite a failed reload are marked **Saved; Caddy
rejected the reload**. If preserving the previous file fails, the save stops
before changing the Caddyfile. If recording history fails after a save has
already succeeded, the API completes successfully with a warning that history
could not be recorded. The UI shows a warning and operation-specific bookkeeping,
including maintenance recovery state, still completes. The applied change may
therefore lack a history version; it is not reported as rejected or rolled back.

Malformed or unreadable versions are skipped with a log warning rather than
blocking other history or saves. If the identity registry cannot be read, current
identities can still resolve; unavailable historical names appear as Unknown.
Damaged files are not automatically deleted. History caches parsed metadata for
unchanged versions and keeps an in-memory identity registry with serialized writes.

Route, maintenance, logging and metrics edits transform the latest file inside
a per-instance queue, preventing concurrent local commands from dropping each
other's file changes. Editor saves and imports intentionally replace the full
file. External file/API writers do not participate in this queue; continuous
drift detection and stronger conflict checks remain separate follow-ups.

Each instance retains up to 20 versions. New versions store content and metadata
together in atomic JSON files under `HISTORY_PATH`; older plain Caddyfile
snapshots remain readable. Downloading a version through the history API still
returns plain Caddyfile content. Include both `HISTORY_PATH` and `AUTH_PATH` in
persistent storage and backups. Losing or resetting authentication storage creates
a new account identity rather than assigning its history to a new account with
the same name.

Attribution identifies the credential used to submit a change. It is not proof
of which person used that credential, and local history is not tamper-proof.

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

`src/frontend/scripts/fetch-caddyfile-mode.mjs` fetches the latest generated file at dev/build time (wired into `npm run dev` and `npm run build` via `predev`/`prebuild`), so `src/frontend/src/lib/caddyfileMode.js` is gitignored here rather than vendored by hand — it always reflects whatever `caddyfile-codemirror` last synced from the gem. If you're building offline, run `npm run dev`/`npm run build` once with connectivity first so the fetch has a local copy to fall back on.
