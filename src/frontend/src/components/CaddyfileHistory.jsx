import { useTranslation } from "react-i18next";
import { localizeError } from "../utils/errorMessages.js";
import { historyActor } from "../utils/caddyfileHistory.js";
import { formatTs } from "../utils/format.js";
import CaddyfileDiff from "./CaddyfileDiff.jsx";
import { UtilityIcon } from "./Icons.jsx";
import Select from "./Select.jsx";

const ACTION_KEYS = {
    'caddyfile.save': 'caddyfile.actionSave',
    'caddyfile.restore': 'caddyfile.actionRestore',
    'caddyfile.import': 'caddyfile.actionImport',
    'route.add': 'caddyfile.actionRouteAdd',
    'route.edit': 'caddyfile.actionRouteEdit',
    'route.delete': 'caddyfile.actionRouteDelete',
    'maintenance.enable': 'caddyfile.actionMaintenanceEnable',
    'maintenance.disable': 'caddyfile.actionMaintenanceDisable',
    'logs.configure': 'caddyfile.actionLogs',
    'metrics.configure': 'caddyfile.actionMetrics',
};

function ExternalConfigurationDiff({ observation, mode, previewRef }) {
    const { t } = useTranslation();
    return (
        <div ref={previewRef} className="history-preview history-external" role="region" aria-label={t('caddyfile.externalPreview')} tabIndex={0}>
            <p>{t('caddyfile.externalObservationHint')}</p>
            {/* eslint-disable-next-line i18next/no-literal-string -- Internal configuration representation identifier, not user-facing text. */}
            {observation.representations.includes('file') && <p>{t('caddyfile.externalRestoreHint')}</p>}
            {observation.representations.length > 1 && <p>{t('caddyfile.externalRelationshipUnknown')}</p>}
            {observation.representations.map(representation => {
                const label = t(representation === 'file' ? 'caddyfile.fileRepresentation' : 'caddyfile.liveRepresentation');
                const before = observation.before[representation];
                // Without opt-in, the live side holds fingerprints and changed paths, not JSON.
                const pathsOnly = representation === 'live' && Array.isArray(observation.paths);
                return (
                    <section key={representation}>
                        <h3>{label}</h3>
                        {before === null && <p>{t('caddyfile.externalBaselineUnavailable')}</p>}
                        {pathsOnly ? (
                            <>
                                <p>{t('caddyfile.liveValuesOmitted')}</p>
                                {observation.paths.length > 0 && (
                                    <ul className="history-paths" aria-label={t('caddyfile.changedPaths')}>
                                        {observation.paths.map(path => <li key={path}><code>{path}</code></li>)}
                                    </ul>
                                )}
                            </>
                        ) : mode === 'diff' && before !== null
                            ? <CaddyfileDiff oldText={before} newText={observation.after[representation]} label={label} />
                            : <pre>{observation.after[representation]}</pre>}
                    </section>
                );
            })}
        </div>
    );
}

// The version history pane. `history` is useCaddyfileHistory's state and `saved`
// the current file; `view` holds [mode, setMode] and [listOpen, setListOpen], which
// outlast the pane.
export default function CaddyfileHistory({ history, saved, isDirty, view, onRestore, onDelete, headerRef, controlsRef }) {
    const { t } = useTranslation();
    const { entries, preview, comparison } = history;
    const [mode, setMode] = view.mode;
    const [listOpen, setListOpen] = view.list;

    // Diff from older to newer: a snapshot against the saved file, or two
    // snapshots ordered by timestamp (filenames sort chronologically).
    let diffOld = preview.content, diffNew = saved;
    if (comparison.target !== "current" && comparison.content !== null) {
        [diffOld, diffNew] = comparison.target < preview.entry?.filename ? [comparison.content, preview.content] : [preview.content, comparison.content];
    }

    return (
        <div className="card card-flush caddyfile-history">
            <div ref={headerRef} className="card-header">
                <span className="section-label">{t("caddyfile.versionHistory")}</span>
                <div className="btn-row">
                    <button className="btn btn-ghost btn--sm" onClick={() => history.load()} disabled={history.loading}><UtilityIcon name="refresh" /> {t("common.refresh")}</button>
                    <button
                        className={`btn btn--sm ${listOpen ? "btn-primary" : "btn-ghost"}`}
                        onClick={() => setListOpen(open => !open)}
                        aria-label={listOpen ? t("caddyfile.hideVersionList") : t("caddyfile.showVersionList")}
                        title={listOpen ? t("caddyfile.hideVersionList") : t("caddyfile.showVersionList")}
                        aria-expanded={listOpen}
                        aria-controls="history-version-list"
                    >
                        <UtilityIcon name="history" size={16} />
                    </button>
                </div>
            </div>
            <div className={`history-body${listOpen ? " history-body--versions" : ""}`}>
                <div className="history-detail">
                    <div ref={controlsRef} className="caddyfile-history-controls">
                        {preview.entry && (
                            <div className="history-attribution" role="group" aria-label={t('caddyfile.versionDetails')}>
                                <div title={preview.entry.actor?.id}>{t(preview.entry.kind === 'external' ? 'caddyfile.detectedAuthor' : 'caddyfile.versionAuthor', { timestamp: formatTs(preview.entry.detectedAt || preview.entry.timestamp), actor: historyActor(preview.entry, t) })}</div>
                                {preview.entry.kind === 'external' ? <div>{t('caddyfile.externalChange')}</div> : <>
                                    <div>{t(Object.hasOwn(ACTION_KEYS, preview.entry.action) ? ACTION_KEYS[preview.entry.action] : 'caddyfile.actionUnknown')} · {t(preview.entry.outcome === 'applied' ? 'caddyfile.outcomeApplied' : preview.entry.outcome === 'saved-unapplied' ? 'caddyfile.outcomeUnapplied' : 'caddyfile.outcomeUnknown')}</div>
                                    {comparison.target !== 'current' && <div>{t('caddyfile.comparisonAuthor', { actor: historyActor(entries.find(entry => entry.filename === comparison.target), t) })}</div>}
                                    {comparison.target === 'current' && <div>{t('caddyfile.currentFileAttribution')}</div>}
                                </>}
                            </div>
                        )}
                        {entries.length > 0 && (
                            <div className="history-compare">
                                <div className="history-range-picker">
                                    <button className={`btn btn--sm ${mode === "diff" ? "btn-primary" : "btn-ghost"}`} onClick={() => setMode("diff")}>± {t("caddyfile.diff")}</button>
                                    <button className={`btn btn--sm ${mode === "raw" ? "btn-primary" : "btn-ghost"}`} onClick={() => setMode("raw")}>{t("caddyfile.raw")}</button>
                                </div>
                                {mode === "diff" && preview.entry?.kind !== 'external' && (
                                    <Select wrapClassName="history-compare-select" value={comparison.target} onChange={e => comparison.change(e.target.value)} aria-label={t("caddyfile.compareAgainst")}>
                                        <option value="current">{t("caddyfile.vsCurrent")}{isDirty ? ` ${t("caddyfile.savedMarker")}` : ""}</option>
                                        {entries.filter(entry => entry.filename !== preview.entry?.filename && entry.hasFile !== false).map(entry => (
                                            <option key={entry.filename} value={entry.filename}>{t("caddyfile.vsSnapshot", { timestamp: formatTs(entry.timestamp) })}</option>
                                        ))}
                                    </Select>
                                )}
                                <div className="btn-row history-version-actions">
                                    <button className="btn btn-ghost btn--sm" onClick={() => onRestore(preview.entry)} disabled={!preview.entry || preview.loading || preview.entry.hasFile === false}><UtilityIcon name="refresh" /> {t("caddyfile.restore")}</button>
                                    <button className="btn btn-danger btn--sm" title={t("caddyfile.deleteSnapshot")} aria-label={t("caddyfile.deleteSnapshot")} onClick={() => onDelete(preview.entry)} disabled={!preview.entry || preview.loading}><UtilityIcon name="close" /></button>
                                </div>
                            </div>
                        )}
                    </div>
                    {history.loading && entries.length === 0 ? (
                        <div className="loading">{t("common.loading")}</div>
                    ) : entries.length === 0 ? (
                        <div className="card-empty">{history.error ? localizeError(history.error, t) : t("caddyfile.historyEmpty")}</div>
                    ) : preview.loading || (mode === "diff" && comparison.loading) ? (
                        <div className="loading">{t("common.loading")}</div>
                    ) : preview.entry ? (
                        preview.entry.kind === 'external'
                            ? preview.observation && <ExternalConfigurationDiff observation={preview.observation} mode={mode} previewRef={preview.ref} />
                            : mode === "diff"
                            ? <CaddyfileDiff oldText={diffOld} newText={diffNew} previewRef={preview.ref} />
                            : <div ref={preview.ref} className="history-preview" role="region" aria-label={t("caddyfile.versionPreview")} tabIndex={0}>{preview.content}</div>
                    ) : (
                        <div className="card-empty">{t("caddyfile.selectVersion")}</div>
                    )}
                </div>
                {listOpen && (
                    <div id="history-version-list" className="history-versions" role="region" aria-label={t("caddyfile.savedVersions")} tabIndex={0}>
                        {entries.map((entry, i) => (
                            <div key={entry.filename} className="history-row">
                                <button
                                    className={`history-entry ${preview.entry?.filename === entry.filename ? "history-entry--active" : "history-entry--default"}`}
                                    onClick={() => preview.select(entry)}
                                    aria-pressed={preview.entry?.filename === entry.filename}
                                    title={entry.filename}
                                >
                                    {formatTs(entry.detectedAt || entry.timestamp)}
                                    <span className="history-entry-actor" title={entry.actor?.id}>{historyActor(entry, t)}</span>
                                    {entry.kind === 'external' && <span className="history-entry-actor">{t('caddyfile.externalChange')} · {entry.representations.map(key => t(key === 'file' ? 'caddyfile.fileRepresentation' : 'caddyfile.liveRepresentation')).join(' · ')}</span>}
                                    {i === 0 && <span className="history-latest">{t("caddyfile.latest")}</span>}
                                </button>
                            </div>
                        ))}
                        {!history.loading && entries.length === 0 && <div className="card-empty">{history.error ? localizeError(history.error, t) : t("caddyfile.noSavedVersions")}</div>}
                    </div>
                )}
            </div>
        </div>
    );
}
