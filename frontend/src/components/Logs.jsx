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
    const bottomRef = useRef(null);
    const esRef = useRef(null);

    useEffect(() => {
        apiFetch("/logs", {}, onUnauth).then(data => setLines(data.lines || [])).catch(e => toast.error(e.message));
        apiFetch("/logs/config", {}, onUnauth).then(setLogConfig).catch(e => toast.error(e.message));
    }, []);

    useEffect(() => {
        if (!logSearch && levelFilter === "all") {
            if (bottomRef.current) bottomRef.current.scrollIntoView({ behavior: "smooth" });
        }
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

    const exportLogs = () => {
        const linesToExport = (logSearch || levelFilter !== "all") && filteredLines.length > 0
            ? filteredLines
            : lines;
        const blob = new Blob([linesToExport.join('\n')], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `caddy-access-${new Date().toISOString().slice(0, 10)}.log`;
        a.click();
        URL.revokeObjectURL(url);
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

    const selectStyle = { background: "var(--editor-bg)", border: "1px solid var(--border2)", borderRadius: 4, padding: "6px 10px", color: "var(--text)", fontFamily: "'IBM Plex Mono', monospace", fontSize: 12, outline: "none", cursor: "pointer", width: "100%" };
    const inputStyle = { background: "var(--editor-bg)", border: "1px solid var(--border2)", borderRadius: 4, padding: "6px 10px", color: "var(--text)", fontFamily: "'IBM Plex Mono', monospace", fontSize: 12, outline: "none", width: "100%" };
    const labelStyle = { fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, letterSpacing: "1.2px", textTransform: "uppercase", color: "var(--muted)", marginBottom: 5, display: "block" };

    const levelBtn = (level, label, color) => (
        <button className="btn btn-ghost" style={{ fontSize: 10, padding: "4px 10px", borderColor: levelFilter === level ? color : "var(--border2)", color: levelFilter === level ? color : "var(--muted)" }} onClick={() => setLevelFilter(levelFilter === level ? "all" : level)}>
            {label}
        </button>
    );

    return (
        <div className="gap-16">
            <div className="card" style={{ padding: 0, overflow: "hidden" }}>
                <div onClick={() => setConfigOpen(o => !o)} style={{ padding: "12px 16px", display: "flex", alignItems: "center", justifyContent: "space-between", cursor: "pointer", userSelect: "none", borderBottom: configOpen ? "1px solid var(--border)" : "none" }}>
                    <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, letterSpacing: "1.5px", textTransform: "uppercase", color: "var(--muted)" }}>Log Configuration</span>
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        {logConfig && <span className={`badge ${logConfig.enabled ? "badge-green" : "badge-muted"}`}>{logConfig.enabled ? "ENABLED" : "DISABLED"}</span>}
                        <span style={{ color: "var(--muted)", fontSize: 12 }}>{configOpen ? "▲" : "▼"}</span>
                    </div>
                </div>
                {configOpen && logConfig && (
                    <div style={{ padding: 16 }}>
                        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 16, marginBottom: 16 }}>
                            <div>
                                <span style={labelStyle}>Logging</span>
                                <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontFamily: "'IBM Plex Mono', monospace", fontSize: 12, color: "var(--text)" }}>
                                    <input type="checkbox" checked={logConfig.enabled} onChange={e => updateConfig("enabled", e.target.checked)} style={{ accentColor: "var(--accent)", width: 14, height: 14 }} />
                                    {logConfig.enabled ? "Enabled" : "Disabled"}
                                </label>
                            </div>
                            <div>
                                <span style={labelStyle}>Format</span>
                                <select value={logConfig.format} onChange={e => updateConfig("format", e.target.value)} style={selectStyle} disabled={!logConfig.enabled}>
                                    <option value="json">json</option>
                                    <option value="console">console</option>
                                </select>
                            </div>
                            <div>
                                <span style={labelStyle}>Level</span>
                                <select value={logConfig.level} onChange={e => updateConfig("level", e.target.value)} style={selectStyle} disabled={!logConfig.enabled}>
                                    <option value="DEBUG">DEBUG</option>
                                    <option value="INFO">INFO</option>
                                    <option value="WARN">WARN</option>
                                    <option value="ERROR">ERROR</option>
                                </select>
                            </div>
                            <div style={{ gridColumn: "1 / -1" }}>
                                <span style={labelStyle}>Log File Path</span>
                                <input value={logConfig.path} onChange={e => updateConfig("path", e.target.value)} style={inputStyle} disabled={!logConfig.enabled} />
                            </div>
                            <div>
                                <span style={labelStyle}>Roll Size</span>
                                <input value={logConfig.rollSize} onChange={e => updateConfig("rollSize", e.target.value)} style={inputStyle} placeholder="50mb" disabled={!logConfig.enabled} />
                            </div>
                            <div>
                                <span style={labelStyle}>Roll Keep</span>
                                <input type="number" value={logConfig.rollKeep} onChange={e => updateConfig("rollKeep", parseInt(e.target.value))} style={inputStyle} min={1} max={20} disabled={!logConfig.enabled} />
                            </div>
                        </div>
                        <div style={{ display: "flex", justifyContent: "flex-end" }}>
                            <button className="btn btn-primary" onClick={saveConfig} disabled={savingConfig || !configDirty}>{savingConfig ? "Saving..." : "↑ Save Config"}</button>
                        </div>
                    </div>
                )}
            </div>

            <div className="log-toolbar">
                <div className="btn-row">
                    <input className="search-input" placeholder="Search logs..." value={logSearch} onChange={e => setLogSearch(e.target.value)} />
                    {levelBtn("error", "ERROR", "var(--danger)")}
                    {levelBtn("warn", "WARN", "var(--warn)")}
                    {levelBtn("info", "INFO", "var(--accent2)")}
                </div>
                <div className="btn-row">
                    <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: "var(--muted)" }}>
                        {filteredLines.length}{logSearch || levelFilter !== "all" ? ` / ${lines.length}` : ""} lines
                    </span>
                    {live && <div className="live-dot" />}
                    <button className={`btn ${live ? "btn-danger" : "btn-ghost"}`} onClick={toggleLive}>{live ? "■ Stop" : "▶ Live"}</button>
                    <button className="btn btn-ghost" onClick={() => apiFetch("/logs", {}, onUnauth).then(d => setLines(d.lines || []))}>↺ Refresh</button>
                    <button className="btn btn-ghost" onClick={exportLogs}>↓ Export</button>
                </div>
            </div>
            <div className="log-wrap">
                {filteredLines.length === 0 ? (
                    <div style={{ color: "var(--muted)", padding: "8px 0" }}>{logSearch || levelFilter !== "all" ? "No lines match the current filter" : "No log lines loaded"}</div>
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
