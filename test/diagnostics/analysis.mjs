// Evidence rules are deliberately separate from collection and test execution.
// Correlation is reported as correlation; missing evidence never implies success.
export function wilson(failures, count) {
    if (!count) return null;
    const z = 1.959963984540054;
    const p = failures / count;
    const denominator = 1 + z * z / count;
    const center = (p + z * z / (2 * count)) / denominator;
    const radius = z * Math.sqrt(p * (1 - p) / count + z * z / (4 * count * count)) / denominator;
    return { rate: p, lower: Math.max(0, center - radius), upper: Math.min(1, center + radius) };
}

export function netlogEvents(data) {
    const names = Object.fromEntries(Object.entries(data.constants?.logEventTypes || {}).map(([name, id]) => [id, name]));
    const offset = Number(data.constants?.timeTickOffset);
    return (data.events || []).map((event, index) => ({
        index, name: names[event.type] || String(event.type), source: event.source?.id,
        epoch: Number.isFinite(offset) ? Number(event.time) + offset : null,
        error: event.params?.net_error,
    })).filter(event => event.name === 'NETWORK_IP_ADDRESSES_CHANGED' || event.error === -21);
}

export function analyzeEvidence({ timeline = [], system = [], netlog = [], metadata = {} }) {
    const failures = timeline.filter(event => event.type === 'request-failed' && event.error === 'net::ERR_NETWORK_CHANGED');
    const ipChanges = netlog.filter(event => event.name === 'NETWORK_IP_ADDRESSES_CHANGED');
    const interruptions = netlog.filter(event => event.error === -21);
    const interfaceEvents = metadata.interface ? system.filter(event => {
        const name = metadata.interface.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const marker = new RegExp(`\\b${metadata.interface.index}:\\s+${name}(?:@\\S+)?\\s+inet6\\s+fe80:`, 'i');
        return event.type === 'kernel' && marker.test(event.line);
    }) : [];
    // NetLog's tick/wall-clock conversion and stream delivery have finite precision.
    const correlations = interfaceEvents.flatMap(kernel => ipChanges.filter(change =>
        Number.isFinite(change.epoch) && Math.abs(change.epoch - kernel.epoch) <= 500,
    ).map(change => ({ kernelEvent: kernel.index, netlogEvent: change.index, deltaMs: Math.round(change.epoch - kernel.epoch) })));
    const missedToasts = [];
    for (const added of timeline.filter(event => event.type === 'dom' && event.event === 'toast-added')) {
        const removed = timeline.find(event => event.type === 'dom' && event.event === 'toast-removed' &&
            event.document === added.document && event.toast === added.toast && event.epoch >= added.epoch);
        const loaded = timeline.find(event => event.type === 'dom' && event.event === 'load' &&
            event.document === added.document && event.epoch >= added.epoch);
        if (removed && loaded && removed.epoch < loaded.epoch && removed.epoch - added.epoch >= 5900) {
            missedToasts.push({ added: added.index, removed: removed.index, load: loaded.index,
                lifetimeMs: removed.epoch - added.epoch, loadAfterRemovalMs: loaded.epoch - removed.epoch });
        }
    }
    const findings = [];
    if (failures.length) findings.push({ kind: 'network-interruption',
        assessment: correlations.length && interruptions.length ? 'Owned-interface and Chromium events correlate with request interruptions.' : 'Request interruption observed; its interface cause is unconfirmed.',
        requestEvents: failures.map(event => event.index), netlogErrors: interruptions.map(event => event.index), correlations });
    if (missedToasts.length) findings.push({ kind: 'toast-before-load',
        assessment: 'Toast DOM nodes disappeared after their normal lifetime, before the document load event. This is consistent with the navigation observation race.',
        evidence: missedToasts });
    return { findings, networkInterruptions: failures.length, existingBootstrapRetries: timeline.filter(event => event.type === 'bootstrap-retry').length,
        missedToasts: missedToasts.length, missing: metadata.captureErrors || [] };
}

const escape = value => String(value).replaceAll('|', '\\|').replaceAll('\n', ' ');
export function evidenceMarkdown(metadata, evidence) {
    const lines = [`# ${metadata.name}`, '', `Profile: **${metadata.profile}**. Namespace: \`${metadata.project || 'none'}\`.`, '',
        'These observations describe this run. They do not assign every test failure to a known cause.', '',
        '| Observation | Evidence references |', '|---|---|'];
    for (const finding of evidence.findings) lines.push(`| ${escape(finding.assessment)} | \`analysis.json\`: ${finding.kind}; raw event indexes are recorded there. |`);
    if (!evidence.findings.length) lines.push('| Neither known signature was observed. Other failures remain unclassified. | Review the test result and raw traces. |');
    lines.push('', 'Files: `timeline.json`, `system.json`, `browser-netlog.json`, `analysis.json`, `metadata.json`, `trace.zip`, `backend-log.json`, and `final.png` where available.', '',
        'The network rule requires an owned-interface IPv6 event, a Chromium IP-change event within 500 ms, and interrupted requests/NetLog error -21. This is temporal evidence, not an automatic proof that a particular assertion failed for that reason.', '',
        'The toast rule requires the same document and toast, a lifetime of at least 5.9 seconds, and removal before document load. DOM observation does not by itself prove painted visibility.', '');
    if (evidence.missing.length) lines.push('## Incomplete capture', '', ...evidence.missing.map(error => `- ${escape(error)}`), '');
    return lines.join('\n');
}

export function summarize(trials) {
    const rows = [];
    for (const profile of [...new Set(trials.map(trial => trial.profile))]) {
        const group = trials.filter(trial => trial.profile === profile);
        const eligible = group.filter(trial => !trial.interrupted && !trial.timedOut && !trial.unavailable);
        const failed = eligible.filter(trial => trial.exitCode !== 0).length;
        rows.push({ profile, trials: group.length, eligible: eligible.length, incomplete: group.length - eligible.length,
            failed, interval: wilson(failed, eligible.length),
            captureNotes: group.reduce((sum, trial) => sum + trial.evidence.filter(evidence => evidence.missing?.length).length, 0),
            networkInterruptions: group.reduce((sum, trial) => sum + trial.evidence.reduce((n, evidence) => n + evidence.networkInterruptions, 0), 0),
            passingWithInterruptions: eligible.filter(trial => trial.exitCode === 0 && trial.evidence.some(evidence => evidence.networkInterruptions)).length,
            existingBootstrapRetries: group.reduce((sum, trial) => sum + trial.evidence.reduce((n, evidence) => n + (evidence.existingBootstrapRetries || 0), 0), 0),
            toastSignatures: group.reduce((sum, trial) => sum + trial.evidence.reduce((n, evidence) => n + evidence.missedToasts, 0), 0) });
    }
    return rows;
}
