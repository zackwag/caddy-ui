import { useEffect, useRef, useState } from 'react';

export default function PreviewFrame({ config, title }) {
    const frame = useRef(null);
    const latest = useRef(config);
    const [report, setReport] = useState(null);
    const [error, setError] = useState('');
    useEffect(() => { latest.current = config; }, [config]);
    function configure() {
        frame.current?.contentWindow?.postMessage({ channel: 'caddy-ui-playground', type: 'configure-preview', config: latest.current }, location.origin);
    }
    useEffect(() => {
        const receive = event => {
            if (event.source !== frame.current?.contentWindow || event.origin !== location.origin || event.data?.channel !== 'caddy-ui-playground') return;
            if (event.data.type === 'preview-ready') configure();
            if (event.data.type === 'preview-error') setError(event.data.message);
            if (event.data.type === 'preview-report' && event.data.scenario === latest.current.scenario &&
                event.data.selected === latest.current.selected && event.data.locale === latest.current.locale) setReport(event.data);
        };
        window.addEventListener('message', receive);
        return () => window.removeEventListener('message', receive);
    }, []);
    useEffect(() => { setReport(null); setError(''); configure(); }, [config]);
    const matching = report?.observations.filter(record => record.key === config.selected) || [];
    return <article className="preview-state" data-preview-scenario={config.scenario}>
        <h3>{title}</h3>
        <iframe ref={frame} src="./frame.html" title={title} sandbox="allow-scripts allow-same-origin allow-downloads"
            onLoad={configure} style={{ height: report?.height || 420 }} />
        <div className="preview-context" aria-live="polite">
            {error && <p role="alert">Preview failed: {error}</p>}
            {report?.misses.map(message => <p role="alert" key={message}>{message}</p>)}
            {!report ? <p>Loading component context…</p> : <>
                <p>{report.references.length} DOM references for <code>{config.selected}</code> · {report.observations.length} resolved translations in this state.</p>
                {!report.references.length && <p>This key is registered for the scenario but isn’t visible in its current state. Open the relevant control or choose another state.</p>}
                {report.references.some(reference => reference.sharedKeys.length) && <p>Dashed highlights indicate wording shared with other keys; the match is ambiguous.</p>}
                <details><summary>DOM selectors and interpolation values</summary>
                    <pre>{JSON.stringify({ references: report.references, translations: matching }, null, 2)}</pre>
                </details>
            </>}
        </div>
    </article>;
}
