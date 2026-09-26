import { useEffect, useRef, useState } from "react";
import { API, apiFetch, getToken } from "../utils/api.js";

export default function Logs({ toast, onUnauth }) {
    const [lines, setLines] = useState([]);
    const [live, setLive] = useState(false);
    const [configOpen, setConfigOpen] = useState(false);
    const [logConfig, setLogConfig] = useState(null);
    const [configDirty, setConfigDirty] = useState(false);
    const [savingConfig, setSavingConfig] = useState(false);
    const [logSearch, setLogSearch] = useState("");
    const [levelFilter, setLevelFilter] = useState("all");
    const [refreshing, setRefreshing] = useState(false);
    const bottomRef = useRef(null);
    const esRef = useRef(null);

    useEffect(() => {
        apiFetch("/logs", {}, onUnauth).then(data => setLines(data.lines || [])).catch(e => toast.error(e.message));
        apiFetch("/logs/config", {}, onUnauth).then(setLogConfig).catch(e => toast.error(e.message));
        // eslint-disable-next-line react-hooks/exhaustive-deps -- load once on mount only; toast isn't stable across renders
    }, [onUnauth]);

    useEffect(() => {
        if (!logSearch && levelFilter === "all") {
            if (bottomRef.current) bottomRef.current.scrollIntoView({ behavior: "smooth" });
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps -- only auto-scroll when new lines arrive, not on every search/filter keystroke
    }, [lines]);

    const toggleLive = () => {
        if (live) { esRef.current?.close(); esRef.current = null; setLive(false); return; }
        const token = getToken();
        const url = token ? `${API}/logs/stream?token=${token}` : `${API}/logs/stream`;
        const es = new EventSource(url);
        es.onmessage = e => {
            const data = JSON.parse(e.data);
            if (data.line) setLines(l => [...l.slice(-500), data.line]);
        };
        esRef.current = es;
        setLive(true);
    };

    useEffect(() => () => esRef.current?.close(), []);

    const classify = (line) => {
        const l = line.toLowerCase();
        if (l.includes('"level":"error"') || l.includes('error')) return 'err';
        if (l.includes('"level":"warn"') || l.includes('warn')) return 'warn';
        if (l.includes('"level":"info"')) return 'info';
        return '';
    };

    const matchesLevel = (line) => {
        if (levelFilter === "all") return true;
        if (levelFilter === "error") return line.toLowerCase().includes('"level":"error"');
        if (levelFilter === "warn") return line.toLowerCase().includes('"level":"warn"');
        if (levelFilter === "info") return line.toLowerCase().includes('"level":"info"');
        return true;
    };

    const filteredLines = lines.filter(line => (!logSearch || line.toLowerCase().includes(logSearch.toLowerCase())) && matchesLevel(line));

    const lineCountText = `${filteredLines.length}${logSearch || levelFilter !== "all" ? ` / ${lines.length}` : ""} lines`;

    const exportLogs = () => {
        const linesToExport = (logSearch || levelFilter !== "all") && filteredLines.length > 0 ? filteredLines : lines;
        const blob = new Blob([linesToExport.join('\n')], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `caddy-access-${new Date().toISOString().slice(0, 10)}.log`;
        a.click();
        URL.revokeObjectURL(url);
    };

    const refreshLogs = () => {
        setRefreshing(true);
        apiFetch("/logs", {}, onUnauth)
            .then(d => setLines(d.lines || []))
            .catch(e => toast.error(e.message))
            .finally(() => setRefreshing(false));
    };

    const updateConfig = (key, value) => { setLogConfig(c => ({ ...c, [key]: value })); setConfigDirty(true); };

    const saveConfig = async () => {
        setSavingConfig(true);
        try {
            await apiFetch("/logs/config", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(logConfig) }, onUnauth);
            toast.success("Log config saved and reloaded");
            setConfigDirty(false);
        } catch (e) { toast.error(e.message); }
        finally { setSavingConfig(false); }
    };

    const levelBtn = (level, label) => (
        <button
            className={`btn btn-ghost btn--icon level-btn level-btn--${level} ${levelFilter === level ? "is-active" : ""}`}
            style={{ fontSize: 10 }}
            onClick={() => setLevelFilter(levelFilter === level ? "all" : level)}
        >
            {label}
        </button>
    );

    return (
        <div className="gap-16">
            <div className="card card-flush">
                <div className={`card-header--clickable ${configOpen ? "is-open" : ""}`} onClick={() => setConfigOpen(o => !o)}>
                    <span className="section-label">Log Configuration</span>
                    <div className="flex-center">
                        {logConfig && <span className={`badge ${logConfig.enabled ? "badge-green" : "badge-muted"}`}>{logConfig.enabled ? "ENABLED" : "DISABLED"}</span>}
                        <span className="chevron">{configOpen ? "▲" : "▼"}</span>
                    </div>
                </div>
                {configOpen && !logConfig && (
                    <div className="card-body loading">Loading...</div>
                )}
                {configOpen && logConfig && (
                    <div className="card-body">
                        <div className="config-grid">
                            <div className="log-config-enabled">
                                <span className="field-label">Logging</span>
                                <button
                                    type="button"
                                    className={`btn log-enabled-btn ${logConfig.enabled ? "btn-danger" : "btn-primary"}`}
                                    onClick={() => updateConfig("enabled", !logConfig.enabled)}
                                >
                                    {logConfig.enabled ? "Disable" : "Enable"}
                                </button>
                            </div>
                            <div>
                                <span className="field-label">Format</span>
                                <select className="config-select" value={logConfig.format} onChange={e => updateConfig("format", e.target.value)} disabled={!logConfig.enabled}>
                                    <option value="json">json</option>
                                    <option value="console">console</option>
                                </select>
                            </div>
                            <div>
                                <span className="field-label">Level</span>
                                <select className="config-select" value={logConfig.level} onChange={e => updateConfig("level", e.target.value)} disabled={!logConfig.enabled}>
                                    <option value="DEBUG">DEBUG</option>
                                    <option value="INFO">INFO</option>
                                    <option value="WARN">WARN</option>
                                    <option value="ERROR">ERROR</option>
                                </select>
                            </div>
                            <div className="config-grid-full">
                                <span className="field-label">Log File Path</span>
                                <input className="config-input" value={logConfig.path} onChange={e => updateConfig("path", e.target.value)} disabled={!logConfig.enabled} />
                            </div>
                            <div>
                                <span className="field-label">Roll Size</span>
                                <input className="config-input" value={logConfig.rollSize} onChange={e => updateConfig("rollSize", e.target.value)} placeholder="50mb" disabled={!logConfig.enabled} />
                            </div>
                            <div>
                                <span className="field-label">Roll Keep</span>
                                <input type="number" className="config-input" value={logConfig.rollKeep} onChange={e => updateConfig("rollKeep", parseInt(e.target.value))} min={1} max={20} disabled={!logConfig.enabled} />
                            </div>
                        </div>
                        <div className="flex-end">
                            <button className="btn btn-primary log-save-btn" onClick={saveConfig} disabled={savingConfig || !configDirty}>{savingConfig ? "Saving..." : "↑ Save"}</button>
                        </div>
                    </div>
                )}
            </div>

            <div className="log-toolbar">
                <div className="btn-row">
                    <div className="search-wrap">
                        <input className="search-input search-input--clearable" placeholder="Search logs..." value={logSearch} onChange={e => setLogSearch(e.target.value)} />
                        {logSearch && <button className="search-clear" onClick={() => setLogSearch("")} title="Clear search">✕</button>}
                    </div>
                    {levelBtn("error", "ERROR")}
                    {levelBtn("warn", "WARN")}
                    {levelBtn("info", "INFO")}
                    <span className="log-line-count log-line-count--mobile">{lineCountText}</span>
                </div>
                <div className="btn-row">
                    <span className="log-line-count log-line-count--desktop">{lineCountText}</span>
                    {live && <div className="live-dot" />}
                    <button className={`btn ${live ? "btn-danger" : "btn-ghost"}`} onClick={toggleLive}>{live ? "■ Stop" : "▶ Live"}</button>
                    <button className="btn btn-ghost" onClick={refreshLogs} disabled={refreshing}>↺ {refreshing ? "Refreshing..." : "Refresh"}</button>
                    <button className="btn btn-ghost" onClick={exportLogs}>↓ Export</button>
                </div>
            </div>
            <div className="log-wrap">
                {filteredLines.length === 0 ? (
                    <div className="log-empty">{logSearch || levelFilter !== "all" ? "No lines match the current filter" : "No log lines loaded"}</div>
                ) : (
                    filteredLines.map((line, i) => (
                        <div key={i} className={`log-line ${classify(line)} ${logSearch && line.toLowerCase().includes(logSearch.toLowerCase()) ? "highlight" : ""}`}>{line}</div>
                    ))
                )}
                <div ref={bottomRef} />
            </div>
        </div>
    );
}
