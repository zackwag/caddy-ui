import { localizeError } from "../utils/errorMessages.js";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import PaneDivider from "./PaneDivider.jsx";
import { apiFetch, getToken, getInstanceId } from "../utils/api.js";
import { stateNotificationKey } from "../utils/notificationCenter.js";
import { formatTs } from "../utils/format.js";
import { collapseUnchanged, diffLines } from "../utils/lineDiff.js";

// eslint-disable-next-line i18next/no-literal-string -- Caddy CLI command, not translatable UI copy
const CADDY_FMT_LABEL = "caddy fmt";
// eslint-disable-next-line i18next/no-literal-string -- Stable DOM identifier linking the divider to the editor pane
const EDITOR_PANE_ID = "caddyfile-editor-pane";

function CaddyfileCodeMirror({ value, onChange, theme }) {
    const containerRef = useRef(null);
    const viewRef = useRef(null);
    const onChangeRef = useRef(onChange);

    useEffect(() => { onChangeRef.current = onChange; }, [onChange]);

    useEffect(() => {
        if (!containerRef.current) return;
        let view;
        let cancelled = false;

        async function init() {
            const { EditorView, keymap, lineNumbers, highlightActiveLineGutter, drawSelection, highlightSpecialChars } = await import("@codemirror/view");
            const { EditorState } = await import("@codemirror/state");
            const { defaultKeymap, historyKeymap, history } = await import("@codemirror/commands");
            const { StreamLanguage, syntaxHighlighting, indentOnInput, bracketMatching } = await import("@codemirror/language");
            const { classHighlighter } = await import("@lezer/highlight");
            const { caddyfile } = await import("../lib/caddyfileMode.js");

            if (cancelled) return;

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
        return () => { cancelled = true; view?.destroy(); viewRef.current = null; };
        // eslint-disable-next-line react-hooks/exhaustive-deps -- only rebuild the editor on theme change; including `value` would tear it down on every keystroke
    }, [theme]);

    useEffect(() => {
        const view = viewRef.current;
        if (!view) return;
        const current = view.state.doc.toString();
        if (current !== value) view.dispatch({ changes: { from: 0, to: current.length, insert: value } });
    }, [value]);

    return <div ref={containerRef} className="caddyfile-editor" />;
}

function CaddyfileDiff({ oldText, newText, previewRef }) {
    const { t } = useTranslation();
    const lines = useMemo(() => diffLines(oldText, newText), [oldText, newText]);
    const added = lines.filter(l => l.type === "add").length;
    const removed = lines.filter(l => l.type === "del").length;
    const shown = useMemo(() => collapseUnchanged(lines), [lines]);

    if (!added && !removed) return <div ref={previewRef} className="history-preview history-diff-empty" role="region" aria-label={t("caddyfile.versionPreview")} tabIndex={0}>{t("caddyfile.noDifferences")}</div>;

    return (
        <>
            <div className="history-diff-stats">
                <span className="diff-stat--add">+{added}</span> <span className="diff-stat--del">−{removed}</span>
            </div>
            <div ref={previewRef} className="history-preview history-diff" role="region" aria-label={t("caddyfile.versionPreview")} tabIndex={0}>
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
    const { t } = useTranslation();
    const [content, setContent] = useState("");
    const [original, setOriginal] = useState("");
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [validating, setValidating] = useState(false);
    const [runFmt, setRunFmt] = useState(true);
    const [runSort, setRunSort] = useState(true);
    const [historyOpen, setHistoryOpen] = useState(false);
    const [historyListOpen, setHistoryListOpen] = useState(false);
    const [editorShare, setEditorShare] = useState(60);
    const [history, setHistory] = useState([]);
    const [historyLoading, setHistoryLoading] = useState(false);
    const [previewEntry, setPreviewEntry] = useState(null);
    const [previewContent, setPreviewContent] = useState("");
    const [previewLoading, setPreviewLoading] = useState(false);
    const [compareLoading, setCompareLoading] = useState(false);
    const [previewMode, setPreviewMode] = useState("diff");
    const [compareTo, setCompareTo] = useState("current");
    const [compareContent, setCompareContent] = useState(null);
    const snapshotCache = useRef(new Map());
    const importInputRef = useRef(null);
    const pageRef = useRef(null);
    const toolbarRef = useRef(null);
    const historyHeaderRef = useRef(null);
    const historyPreviewRef = useRef(null);
    const historyControlsRef = useRef(null);
    const previewRequest = useRef(0);
    const compareRequest = useRef(0);
    const historyRequest = useRef(0);
    const selectedFilename = useRef(null);
    const comparisonFilename = useRef("current");

    useEffect(() => () => {
        historyRequest.current++;
        previewRequest.current++;
        compareRequest.current++;
    }, []);

    useEffect(() => {
        const key = stateNotificationKey('caddyfile.load', getInstanceId());
        apiFetch("/caddyfile", {}, onUnauth)
            .then(content => { toast.recover(key); setContent(content); setOriginal(content); })
            .catch(e => toast.error(localizeError(e, t), e, { mode: 'state', key }))
            .finally(() => setLoading(false));
        // eslint-disable-next-line react-hooks/exhaustive-deps -- load once on mount only; toast isn't stable across renders
    }, [onUnauth]);

    const clearPreview = () => {
        previewRequest.current++;
        compareRequest.current++;
        selectedFilename.current = null;
        comparisonFilename.current = "current";
        setPreviewEntry(null); setPreviewContent(""); setPreviewLoading(false);
        setCompareTo("current"); setCompareContent(null); setCompareLoading(false);
    };

    const loadHistory = async () => {
        const request = ++historyRequest.current;
        setHistoryLoading(true);
        try {
            const entries = await apiFetch("/caddyfile/history", {}, onUnauth);
            if (request !== historyRequest.current) return;
            setHistory(entries);
            const selected = entries.find(entry => entry.filename === selectedFilename.current) || entries[0];
            if (!selected) clearPreview();
            else if (selected.filename !== selectedFilename.current) previewSnapshot(selected);
            else if (comparisonFilename.current !== "current" && !entries.some(entry => entry.filename === comparisonFilename.current)) {
                changeCompareTo("current");
            }
        } catch (e) {
            if (request === historyRequest.current) toast.error(localizeError(e, t), e);
        } finally {
            if (request === historyRequest.current) setHistoryLoading(false);
        }
    };

    const toggleHistory = () => {
        if (!historyOpen) loadHistory();
        setHistoryOpen(o => !o);
    };

    // Snapshots never change once written, so each is fetched at most once.
    const fetchSnapshot = async (filename) => {
        if (!snapshotCache.current.has(filename)) {
            snapshotCache.current.set(filename, await apiFetch(`/caddyfile/history/${filename}`, {}, onUnauth));
        }
        return snapshotCache.current.get(filename);
    };

    const previewSnapshot = async (entry) => {
        if (!entry) return;
        if (selectedFilename.current === entry.filename) return;
        const request = ++previewRequest.current;
        compareRequest.current++;
        selectedFilename.current = entry.filename;
        comparisonFilename.current = "current";
        setPreviewEntry(entry); setPreviewContent(""); setPreviewLoading(true);
        setCompareTo("current"); setCompareContent(null); setCompareLoading(false);
        historyPreviewRef.current?.scrollTo({ top: 0 });
        try {
            const text = await fetchSnapshot(entry.filename);
            if (request === previewRequest.current) setPreviewContent(text);
        } catch (e) {
            if (request === previewRequest.current) {
                selectedFilename.current = null;
                setPreviewEntry(null);
                toast.error(localizeError(e, t), e);
            }
        } finally {
            if (request === previewRequest.current) setPreviewLoading(false);
        }
    };

    const changeCompareTo = async (target) => {
        const request = ++compareRequest.current;
        comparisonFilename.current = target;
        setCompareTo(target); setCompareContent(null);
        setCompareLoading(target !== "current");
        if (target === "current") return;
        try {
            const text = await fetchSnapshot(target);
            if (request === compareRequest.current) setCompareContent(text);
        } catch (e) {
            if (request === compareRequest.current) {
                comparisonFilename.current = "current";
                setCompareTo("current");
                toast.error(localizeError(e, t), e);
            }
        } finally {
            if (request === compareRequest.current) setCompareLoading(false);
        }
    };

    const restoreSnapshot = async (entry) => {
        if (!await confirm(t("caddyfile.restoreConfirm", { timestamp: formatTs(entry.timestamp) }), { confirmLabel: t("caddyfile.restore") })) return;
        try {
            const text = await apiFetch(`/caddyfile/history/${entry.filename}`, {}, onUnauth);
            await apiFetch("/caddyfile", { method: "PUT", headers: { "Content-Type": "text/plain" }, body: text }, onUnauth);
            const fresh = await apiFetch("/caddyfile", {}, onUnauth);
            setContent(fresh); setOriginal(fresh); setHistoryOpen(false); clearPreview();
            toast.success(t("caddyfile.restoredFrom", { timestamp: formatTs(entry.timestamp) }));
            loadHistory();
        } catch (e) { toast.error(localizeError(e, t), e); }
    };

    const deleteSnapshot = async (entry) => {
        if (!await confirm(t("caddyfile.deleteSnapshotConfirm", { timestamp: formatTs(entry.timestamp) }), { confirmLabel: t("common.delete"), danger: true })) return;
        try {
            await apiFetch(`/caddyfile/history/${entry.filename}`, { method: "DELETE" }, onUnauth);
            toast.success(t("caddyfile.snapshotDeleted"));
            snapshotCache.current.delete(entry.filename);
            if (selectedFilename.current === entry.filename) clearPreview();
            else if (comparisonFilename.current === entry.filename) changeCompareTo("current");
            loadHistory();
        } catch (e) { toast.error(localizeError(e, t), e); }
    };

    const validate = async () => {
        setValidating(true);
        try {
            const result = await apiFetch(`/caddyfile/validations?fmt=${runFmt}`, { method: "POST", headers: { "Content-Type": "text/plain" }, body: content }, onUnauth);
            if (result.formatted) setContent(result.formatted);
            if (result.warnings?.length) toast.info(t('errors.validationWarning'), result);
            else toast.success(t("caddyfile.valid"));
        } catch (e) { toast.error(localizeError(e, t), e); }
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
            if (result?.warning) toast.info(t('errors.operationWarning'), result);
            else toast.success(t("caddyfile.savedReloaded"));
            if (historyOpen) loadHistory();
        } catch (e) { toast.error(localizeError(e, t), e); }
        finally { setSaving(false); }
    };

    const reload = async () => {
        try { await apiFetch("/caddyfile/reloads", { method: "POST" }, onUnauth); toast.success(t("caddyfile.reloadedFromDisk")); }
        catch (e) { toast.error(localizeError(e, t), e); }
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
            } catch (err) { toast.error(localizeError(err, t), err); }
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
        <div
            ref={pageRef}
            className={`gap-16 caddyfile-page${historyOpen ? " caddyfile-page--history" : ""}`}
            style={{ "--editor-share": `${editorShare}fr`, "--history-share": `${100 - editorShare}fr` }}
        >
            <div id={EDITOR_PANE_ID} className="editor-wrap">
                <CaddyfileCodeMirror value={content} onChange={setContent} theme={theme} />
                <div ref={toolbarRef} className="editor-toolbar">
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
                <PaneDivider
                    containerRef={pageRef}
                    primaryMinimumRef={toolbarRef}
                    secondaryMinimumRef={historyHeaderRef}
                    secondaryControlsRef={historyControlsRef}
                    primaryPaneId={EDITOR_PANE_ID}
                    value={editorShare}
                    onChange={setEditorShare}
                />
            )}
            {historyOpen && (
                <div className="card card-flush caddyfile-history">
                    <div ref={historyHeaderRef} className="card-header">
                        <span className="section-label">{t("caddyfile.versionHistory")}</span>
                        <div className="btn-row">
                            <button className="btn btn-ghost btn--sm" onClick={loadHistory} disabled={historyLoading}>↺ {t("common.refresh")}</button>
                            <button
                                className={`btn btn--sm ${historyListOpen ? "btn-primary" : "btn-ghost"}`}
                                onClick={() => setHistoryListOpen(open => !open)}
                                aria-label={historyListOpen ? t("caddyfile.hideVersionList") : t("caddyfile.showVersionList")}
                                title={historyListOpen ? t("caddyfile.hideVersionList") : t("caddyfile.showVersionList")}
                                aria-expanded={historyListOpen}
                                aria-controls="history-version-list"
                            >
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                    <path d="M3 3v5h5" />
                                    <path d="M3.05 13a9 9 0 1 0 .5-5" />
                                    <path d="M12 7v5l3 2" />
                                </svg>
                            </button>
                        </div>
                    </div>
                    <div className={`history-body${historyListOpen ? " history-body--versions" : ""}`}>
                        <div className="history-detail">
                            <div ref={historyControlsRef} className="caddyfile-history-controls">
                                {history.length > 0 && (
                                    <div className="history-compare">
                                        <div className="history-range-picker">
                                            <button className={`btn btn--sm ${previewMode === "diff" ? "btn-primary" : "btn-ghost"}`} onClick={() => setPreviewMode("diff")}>± {t("caddyfile.diff")}</button>
                                            <button className={`btn btn--sm ${previewMode === "raw" ? "btn-primary" : "btn-ghost"}`} onClick={() => setPreviewMode("raw")}>{t("caddyfile.raw")}</button>
                                        </div>
                                        {previewMode === "diff" && (
                                            <div className="select-wrap history-compare-select">
                                                <select className="config-select" value={compareTo} onChange={e => changeCompareTo(e.target.value)} aria-label={t("caddyfile.compareAgainst")}>
                                                    <option value="current">{t("caddyfile.vsCurrent")}{isDirty ? ` ${t("caddyfile.savedMarker")}` : ""}</option>
                                                    {history.filter(entry => entry.filename !== previewEntry?.filename).map(entry => (
                                                        <option key={entry.filename} value={entry.filename}>{t("caddyfile.vsSnapshot", { timestamp: formatTs(entry.timestamp) })}</option>
                                                    ))}
                                                </select>
                                                <span className="select-arrow">▾</span>
                                            </div>
                                        )}
                                        <div className="btn-row history-version-actions">
                                            <button className="btn btn-ghost btn--sm" onClick={() => restoreSnapshot(previewEntry)} disabled={!previewEntry || previewLoading}>↺ {t("caddyfile.restore")}</button>
                                            <button className="btn btn-danger btn--sm" title={t("caddyfile.deleteSnapshot")} aria-label={t("caddyfile.deleteSnapshot")} onClick={() => deleteSnapshot(previewEntry)} disabled={!previewEntry || previewLoading}>✕</button>
                                        </div>
                                    </div>
                                )}
                            </div>
                            {historyLoading && history.length === 0 ? (
                                <div className="loading">{t("common.loading")}</div>
                            ) : history.length === 0 ? (
                                <div className="card-empty">{t("caddyfile.noSnapshots")}</div>
                            ) : previewLoading || (previewMode === "diff" && compareLoading) ? (
                                <div className="loading">{t("common.loading")}</div>
                            ) : previewEntry ? (
                                previewMode === "diff"
                                    ? <CaddyfileDiff oldText={diffOld} newText={diffNew} previewRef={historyPreviewRef} />
                                    : <div ref={historyPreviewRef} className="history-preview" role="region" aria-label={t("caddyfile.versionPreview")} tabIndex={0}>{previewContent}</div>
                            ) : (
                                <div className="card-empty">{t("caddyfile.selectVersion")}</div>
                            )}
                        </div>
                        {historyListOpen && (
                            <div id="history-version-list" className="history-versions" role="region" aria-label={t("caddyfile.savedVersions")} tabIndex={0}>
                                {history.map((entry, i) => (
                                    <div key={entry.filename} className="history-row">
                                        <button
                                            className={`history-entry ${previewEntry?.filename === entry.filename ? "history-entry--active" : "history-entry--default"}`}
                                            onClick={() => previewSnapshot(entry)}
                                            aria-pressed={previewEntry?.filename === entry.filename}
                                            title={entry.filename}
                                        >
                                            {formatTs(entry.timestamp)}
                                            {i === 0 && <span className="history-latest">{t("caddyfile.latest")}</span>}
                                        </button>
                                    </div>
                                ))}
                                {!historyLoading && history.length === 0 && <div className="card-empty">{t("caddyfile.noSavedVersions")}</div>}
                            </div>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}
