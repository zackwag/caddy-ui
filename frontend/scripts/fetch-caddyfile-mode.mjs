#!/usr/bin/env node
// Fetches the generated Caddyfile CodeMirror mode from
// https://github.com/zackwag/caddyfile-codemirror, which regenerates its
// vocabulary daily from the seanthegeek/rouge-lexer-caddyfile gem. Runs
// before dev/build so the editor's highlighting always uses the latest
// Caddyfile keyword vocabulary without vendoring it by hand.
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const SOURCE_URL = "https://raw.githubusercontent.com/zackwag/caddyfile-codemirror/main/dist/caddyfileMode.js";
const outPath = fileURLToPath(new URL("../src/lib/caddyfileMode.js", import.meta.url));

try {
    const res = await fetch(SOURCE_URL);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, text);
    console.log(`[fetch-caddyfile-mode] updated src/lib/caddyfileMode.js from ${SOURCE_URL}`);
} catch (err) {
    if (existsSync(outPath)) {
        console.warn(`[fetch-caddyfile-mode] could not fetch latest mode (${err.message}); keeping existing local copy.`);
    } else {
        console.error(`[fetch-caddyfile-mode] could not fetch mode and no local copy exists: ${err.message}`);
        process.exit(1);
    }
}
