import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { apiFetch, getToken } from "../utils/api.js";
import { formatTs } from "../utils/format.js";
import { collapseUnchanged, diffLines } from "../utils/lineDiff.js";

// eslint-disable-next-line i18next/no-literal-string -- Caddy CLI command, not translatable UI copy
const CADDY_FMT_LABEL = "caddy fmt";

function CaddyfileCodeMirror({ value, onChange, theme }) {
    const containerRef = useRef(null);
    const viewRef = useRef(null);
    const onChangeRef = useRef(onChange);

    useEffect(() => { onChangeRef.current = onChange; }, [onChange]);

    useEffect(() => {
        if (!containerRef.current) return;
        let view;

        async function init() {
            const { EditorView, keymap, lineNumbers, highlightActiveLineGutter, drawSelection, highlightSpecialChars } = await import("@codemirror/view");
            const { EditorState } = await import("@codemirror/state");
            const { defaultKeymap, historyKeymap, history } = await import("@codemirror/commands");
            const { StreamLanguage, syntaxHighlighting, indentOnInput, bracketMatching } = await import("@codemirror/language");
            const { classHighlighter } = await import("@lezer/highlight");
            const { caddyfile } = await import("../lib/caddyfileMode.js");

            const isDark = theme === 'dark';

            // Colors read from the CSS theme variables (see styles.js) rather than
            // being hardcoded per-theme here, so a new theme needs no changes in
            // this file -- only a new entry in the THEMES registry.
            const editorTheme = EditorView.theme({
                "&": { background: "var(--editor-bg)", color: "var(--text)", fontSize: "13px", fontFamily: "'IBM Plex Mono', monospace" },
                ".cm-content": { padding: "16px", caretColor: "var(--accent)", lineHeight: "1.7" },
                ".cm-gutters": { background: "var(--editor-gutter)", color: "var(--muted)", border: "none", borderRight: "1px solid var(--editor-border)", paddingRight: "8px" },
                ".cm-activeLineGutter": { background: "var(--editor-active-gutter)" },
                ".cm-activeLine": { background: "var(--editor-active-line)" },
                ".cm-cursor": { borderLeftColor: "var(--accent)" },
                ".cm-selectionBackground, ::selection": { background: "var(--editor-selection) !important" },
                ".cm-line": { padding: "0 4px" },
                ".tok-keyword": { color: "var(--accent)" },
                ".tok-string": { color: "var(--warn)" },
                ".tok-comment": { color: "var(--muted)", fontStyle: "italic" },
                ".tok-number": { color: "var(--accent2)" },
                ".tok-operator": { color: "var(--text)" },
                ".tok-variableName": { color: "var(--danger)" },
                ".tok-typeName": { color: "var(--accent)" },
                ".tok-atom": { color: "var(--warn)" },
                ".tok-propertyName": { color: "var(--accent2)" },
                ".tok-variableName2": { color: "var(--accent3)" },
                "& .cm-scroller": { overflow: "auto" },
            }, { dark: isDark });

            const startState = EditorState.create({
                doc: value,
                extensions: [
                    lineNumbers(), highlightActiveLineGutter(), highlightSpecialChars(),
                    history(), drawSelection(), indentOnInput(), bracketMatching(),
                    syntaxHighlighting(classHighlighter),
                    StreamLanguage.define(caddyfile), editorTheme,
                    keymap.of([...defaultKeymap, ...historyKeymap]),
                    EditorView.updateListener.of(update => {
                        if (update.docChanged) onChangeRef.current(update.state.doc.toString());
                    }),
                    EditorView.lineWrapping,
                ],
            });

            view = new EditorView({ state: startState, parent: containerRef.current });
            viewRef.current = view;
        }

        init();
        return () => { view?.destroy(); viewRef.current = null; };
        // eslint-disable-next-line react-hooks/exhaustive-deps -- only rebuild the editor on theme change; including `value` would tear it down on every keystroke
    }, [theme]);

    useEffect(() => {
        const view = viewRef.current;
        if (!view) return;
        const current = view.state.doc.toString();
        if (current !== value) view.dispatch({ changes: { from: 0, to: current.length, insert: value } });
    }, [value]);

    return <div ref={containerRef} style={{ minHeight: 420, background: "var(--editor-bg)" }} />;
}

function CaddyfileDiff({ oldText, newText }) {
    const { t } = useTranslation();
    const lines = useMemo(() => diffLines(oldText, newText), [oldText, newText]);
    const added = lines.filter(l => l.type === "add").length;
    const removed = lines.filter(l => l.type === "del").length;
    const shown = useMemo(() => collapseUnchanged(lines), [lines]);

    if (!added && !removed) return <div className="history-preview history-diff-empty">{t("caddyfile.noDifferences")}</div>;

    return (
        <>
            <div className="history-diff-stats">
                <span className="diff-stat--add">+{added}</span> <span className="diff-stat--del">−{removed}</span>
            </div>
            <div className="history-preview history-diff">
                <div className="history-diff-lines">
                    {shown.map((line, i) => line.type === "skip" ? (
                        <div key={i} className="diff-skip">⋯ {t("caddyfile.unchangedLines", { count: line.count })}</div>
                    ) : (
                        <div key={i} className={`diff-line diff-line--${line.type}`}>
                            <span className="diff-ln">{line.oldNo ?? ""}</span>
                            <span className="diff-ln">{line.newNo ?? ""}</span>
                            <span className="diff-sign">{line.type === "add" ? "+" : line.type === "del" ? "−" : " "}</span>
                            <span className="diff-text">{line.text}</span>
                        </div>
                    ))}
                </div>
            </div>
        </>
    );
}

export default function CaddyFile({ toast, onUnauth, theme, confirm }) {
    const { t, i18n } = useTranslation();
    const locale = i18n.resolvedLanguage || i18n.language;
    const [content, setContent] = useState("");
    const [original, setOriginal] = useState("");
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [validating, setValidating] = useState(false);
    const [runFmt, setRunFmt] = useState(true);
    const [runSort, setRunSort] = useState(true);
    const [historyOpen, setHistoryOpen] = useState(false);
    const [history, setHistory] = useState([]);
    const [historyLoading, setHistoryLoading] = useState(false);
    const [previewEntry, setPreviewEntry] = useState(null);
    const [previewContent, setPreviewContent] = useState("");
    const [previewMode, setPreviewMode] = useState("diff");
    const [compareTo, setCompareTo] = useState("current");
    const [compareContent, setCompareContent] = useState(null);
    const snapshotCache = useRef(new Map());
    const importInputRef = useRef(null);
    const historyRef = useRef(null);

    useEffect(() => {
        apiFetch("/caddyfile", {}, onUnauth)
            .then(t => { setContent(t); setOriginal(t); })
            .catch(e => toast.error(e.message))
            .finally(() => setLoading(false));
        // eslint-disable-next-line react-hooks/exhaustive-deps -- load once on mount only; toast isn't stable across renders
    }, [onUnauth]);

    const loadHistory = () => {
        setHistoryLoading(true);
        apiFetch("/caddyfile/history", {}, onUnauth).then(setHistory).catch(() => setHistory([])).finally(() => setHistoryLoading(false));
    };

    const toggleHistory = () => {
        if (!historyOpen) {
            loadHistory();
            setTimeout(() => historyRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
        }
        setHistoryOpen(o => !o);
        setPreviewEntry(null);
        setPreviewContent("");
    };

    // Snapshots never change once written, so each is fetched at most once.
    const fetchSnapshot = async (filename) => {
        if (!snapshotCache.current.has(filename)) {
            snapshotCache.current.set(filename, await apiFetch(`/caddyfile/history/${filename}`, {}, onUnauth));
        }
        return snapshotCache.current.get(filename);
    };

    const previewSnapshot = async (entry) => {
        if (previewEntry?.filename === entry.filename) { setPreviewEntry(null); setPreviewContent(""); return; }
        try {
            const text = await fetchSnapshot(entry.filename);
            setPreviewEntry(entry); setPreviewContent(text);
            setCompareTo("current"); setCompareContent(null);
        } catch (e) { toast.error(e.message); }
    };

    const changeCompareTo = async (target) => {
        if (target === "current") { setCompareTo(target); setCompareContent(null); return; }
        try {
            const text = await fetchSnapshot(target);
            setCompareTo(target); setCompareContent(text);
        } catch (e) { toast.error(e.message); }
    };

    const restoreSnapshot = async (entry) => {
        if (!await confirm(t("caddyfile.restoreConfirm", { timestamp: formatTs(entry.timestamp, locale) }), { confirmLabel: t("caddyfile.restore") })) return;
        try {
            const text = await apiFetch(`/caddyfile/history/${entry.filename}`, {}, onUnauth);
            await apiFetch("/caddyfile", { method: "PUT", headers: { "Content-Type": "text/plain" }, body: text }, onUnauth);
            const fresh = await apiFetch("/caddyfile", {}, onUnauth);
            setContent(fresh); setOriginal(fresh); setHistoryOpen(false); setPreviewEntry(null);
            toast.success(t("caddyfile.restoredFrom", { timestamp: formatTs(entry.timestamp, locale) }));
            loadHistory();
        } catch (e) { toast.error(e.message); }
    };

    const deleteSnapshot = async (entry) => {
        if (!await confirm(t("caddyfile.deleteSnapshotConfirm", { timestamp: formatTs(entry.timestamp, locale) }), { confirmLabel: t("common.delete"), danger: true })) return;
        try {
            await apiFetch(`/caddyfile/history/${entry.filename}`, { method: "DELETE" }, onUnauth);
            toast.success(t("caddyfile.snapshotDeleted"));
            snapshotCache.current.delete(entry.filename);
            if (previewEntry?.filename === entry.filename) { setPreviewEntry(null); setPreviewContent(""); }
            if (compareTo === entry.filename) { setCompareTo("current"); setCompareContent(null); }
            loadHistory();
        } catch (e) { toast.error(e.message); }
    };

    const validate = async () => {
        setValidating(true);
        try {
            const result = await apiFetch(`/caddyfile/validations?fmt=${runFmt}`, { method: "POST", headers: { "Content-Type": "text/plain" }, body: content }, onUnauth);
            if (result.formatted) setContent(result.formatted);
            if (result.warnings?.length) result.warnings.forEach(w => toast.info(w));
            else toast.success(t("caddyfile.valid"));
        } catch (e) { toast.error(e.message); }
        finally { setValidating(false); }
    };

    const save = async ({ force = false } = {}) => {
        if (force && !await confirm(t("caddyfile.forceSaveConfirm"), { confirmLabel: t("caddyfile.forceSave"), danger: true })) return;
        setSaving(true);
        try {
            const q = `fmt=${runFmt}&sort=${runSort}${force ? "&validate=false" : ""}`; // eslint-disable-line i18next/no-literal-string -- API query parameter
            const result = await apiFetch(`/caddyfile?${q}`, { method: "PUT", headers: { "Content-Type": "text/plain" }, body: content }, onUnauth);
            const fresh = await apiFetch("/caddyfile", {}, onUnauth);
            setContent(fresh); setOriginal(fresh);
            if (result?.warning) toast.info(result.message || t("caddyfile.reloadFailed"));
            else toast.success(t("caddyfile.savedReloaded"));
            if (historyOpen) loadHistory();
        } catch (e) { toast.error(e.message); }
        finally { setSaving(false); }
    };

    const reload = async () => {
        try { await apiFetch("/caddyfile/reloads", { method: "POST" }, onUnauth); toast.success(t("caddyfile.reloadedFromDisk")); }
        catch (e) { toast.error(e.message); }
    };

    const exportFile = () => {
        const token = getToken();
        window.open(token ? `/api/caddyfile?download=true&token=${token}` : `/api/caddyfile?download=true`, '_blank');
    };

    const importFile = (e) => {
        const file = e.target.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = async (ev) => {
            const text = ev.target.result;
            if (!await confirm(t("caddyfile.importConfirm"), { confirmLabel: t("caddyfile.import") })) return;
            try {
                await apiFetch("/caddyfile", { method: "PUT", headers: { "Content-Type": "text/plain" }, body: text }, onUnauth);
                const fresh = await apiFetch("/caddyfile", {}, onUnauth);
                setContent(fresh); setOriginal(fresh);
                toast.success(t("caddyfile.importedReloaded"));
                if (historyOpen) loadHistory();
            } catch (err) { toast.error(err.message); }
        };
        reader.readAsText(file);
        e.target.value = "";
    };

    const isDirty = content !== original;

    // Diff from older to newer: a snapshot against the saved file, or two
    // snapshots ordered by timestamp (filenames sort chronologically).
    let diffOld = previewContent, diffNew = original;
    if (compareTo !== "current" && compareContent !== null) {
        [diffOld, diffNew] = compareTo < previewEntry?.filename ? [compareContent, previewContent] : [previewContent, compareContent];
    }

    if (loading) return <div className="loading">{t("caddyfile.loading")}</div>;

    return (
        <div className="gap-16">
            <div className="editor-wrap">
                <CaddyfileCodeMirror value={content} onChange={setContent} theme={theme} />
                <div className="editor-toolbar">
                    <div className="btn-row">
                        <label className="editor-checkbox-label">
                            <input type="checkbox" className="editor-checkbox" checked={runFmt} onChange={e => setRunFmt(e.target.checked)} />
                            {CADDY_FMT_LABEL}
                        </label>
                        <label className="editor-checkbox-label">
                            <input type="checkbox" className="editor-checkbox" checked={runSort} onChange={e => setRunSort(e.target.checked)} />
                            {t("caddyfile.sortEntries")}
                        </label>
                        <span className="editor-hint editor-hint--mobile">{isDirty ? `● ${t("caddyfile.unsavedChanges")}` : `✓ ${t("caddyfile.upToDate")}`}</span>
                    </div>
                    <div className="btn-row editor-toolbar-actions">
                        <span className="editor-hint editor-hint--desktop">{isDirty ? `● ${t("caddyfile.unsavedChanges")}` : `✓ ${t("caddyfile.upToDate")}`}</span>
                        <button className="btn btn-ghost" onClick={validate} disabled={validating}>{validating ? t("caddyfile.validating") : `✓ ${t("caddyfile.validate")}`}</button>
                        <button className="btn btn-ghost" onClick={toggleHistory}>⊙ {t("caddyfile.history")}{history.length > 0 && !historyLoading ? ` (${history.length})` : ""}</button>
                        <button className="btn btn-ghost" onClick={exportFile}>↓ {t("common.export")}</button>
                        <button className="btn btn-ghost" onClick={() => importInputRef.current?.click()}>↑ {t("caddyfile.import")}</button>
                        <input ref={importInputRef} type="file" accept="text/plain,.txt" style={{ display: "none" }} onChange={importFile} />
                        <button className="btn btn-ghost" onClick={reload}>↺ {t("caddyfile.reload")}</button>
                        <button className="btn btn-ghost" onClick={() => save({ force: true })} disabled={saving || !isDirty} title={t("caddyfile.forceSaveTitle")}>{saving ? "..." : `⚠ ${t("caddyfile.forceSave")}`}</button>
                        <button className="btn btn-primary" onClick={() => save()} disabled={saving || !isDirty}>{saving ? t("common.saving") : `↑ ${t("common.save")}`}</button>
                    </div>
                </div>
            </div>

            {historyOpen && (
                <div ref={historyRef} className="card card-flush">
                    <div className="card-header">
                        <span className="section-label">{t("caddyfile.versionHistory")}</span>
                        <button className="btn btn-ghost btn--sm" onClick={loadHistory} disabled={historyLoading}>↺ {t("common.refresh")}</button>
                    </div>
                    {historyLoading ? (
                        <div className="card-body loading">{t("common.loading")}</div>
                    ) : history.length === 0 ? (
                        <div className="card-empty">{t("caddyfile.noSnapshots")}</div>
                    ) : (
                        <div className="history-body">
                            {history.map((entry, i) => (
                                <div key={entry.filename}>
                                    <div className="history-row">
                                        <div
                                            className={`history-entry ${previewEntry?.filename === entry.filename ? "history-entry--active" : "history-entry--default"}`}
                                            onClick={() => previewSnapshot(entry)}
                                        >
                                            {formatTs(entry.timestamp, locale)}
                                            {i === 0 && <span className="history-latest">{t("caddyfile.latest")}</span>}
                                        </div>
                                        <div className="btn-row">
                                            <button className="btn btn-ghost btn--sm" onClick={() => restoreSnapshot(entry)}>↺ {t("caddyfile.restore")}</button>
                                            <button className="btn btn-danger btn--sm" title={t("caddyfile.deleteSnapshot")} onClick={() => deleteSnapshot(entry)}>✕</button>
                                        </div>
                                    </div>
                                    {previewEntry?.filename === entry.filename && (
                                        <div className="history-detail">
                                            <div className="history-compare">
                                                <div className="history-range-picker">
                                                    <button className={`btn btn--sm ${previewMode === "diff" ? "btn-primary" : "btn-ghost"}`} onClick={() => setPreviewMode("diff")}>± {t("caddyfile.diff")}</button>
                                                    <button className={`btn btn--sm ${previewMode === "raw" ? "btn-primary" : "btn-ghost"}`} onClick={() => setPreviewMode("raw")}>{t("caddyfile.raw")}</button>
                                                </div>
                                                {previewMode === "diff" && (
                                                    <div className="select-wrap history-compare-select">
                                                        <select className="config-select" value={compareTo} onChange={e => changeCompareTo(e.target.value)} aria-label={t("caddyfile.compareAgainst")}>
                                                            <option value="current">{t("caddyfile.vsCurrent")}{isDirty ? ` ${t("caddyfile.savedMarker")}` : ""}</option>
                                                            {history.filter(other => other.filename !== entry.filename).map(other => (
                                                                <option key={other.filename} value={other.filename}>{t("caddyfile.vsSnapshot", { timestamp: formatTs(other.timestamp, locale) })}</option>
                                                            ))}
                                                        </select>
                                                        <span className="select-arrow">▾</span>
                                                    </div>
                                                )}
                                            </div>
                                            {previewMode === "diff"
                                                ? <CaddyfileDiff oldText={diffOld} newText={diffNew} />
                                                : <div className="history-preview">{previewContent}</div>}
                                        </div>
                                    )}
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
