// Durations describe observations, not exact service failure/recovery times.
// A check is carried forward only until the next check or the gap threshold.
export function summarizeHistory(entries, start, end, gapThresholdMs) {
    const points = entries.filter(entry => entry.at < end).sort((a, b) => a.at - b.at);
    const segments = [];
    function emit(status, from, to) {
        if (to <= from) return;
        const last = segments.at(-1);
        if (last?.status === status && last.end === from) last.end = to;
        else segments.push({ status, start: from, end: to });
    }
    let cursor = start;
    for (let i = 0; i < points.length; i++) {
        const next = Math.min(points[i + 1]?.at ?? end, end);
        if (next <= start) continue;
        const from = Math.max(start, points[i].at);
        const to = Math.min(next, points[i].at + gapThresholdMs);
        emit('unknown', cursor, from);
        emit(points[i].online ? 'online' : 'offline', from, to);
        cursor = Math.max(from, to);
        emit('unknown', cursor, next);
        cursor = next;
    }
    emit('unknown', cursor, end);

    const incidents = segments.flatMap((segment, index) => {
        if (segment.status !== 'offline') return [];
        const next = segments[index + 1];
        return [{ ...segment, recoveredAt: next?.status === 'online' ? segment.end : null,
            monitoringGap: next?.status === 'unknown' }];
    });
    const downtimeMs = incidents.reduce((sum, incident) => sum + incident.end - incident.start, 0);
    const unknownMs = segments.filter(segment => segment.status === 'unknown')
        .reduce((sum, segment) => sum + segment.end - segment.start, 0);
    const checks = points.filter(point => point.at >= start);
    return {
        segments, incidents, downtimeMs, unknownMs,
        longestMs: incidents.reduce((longest, incident) => Math.max(longest, incident.end - incident.start), 0),
        checks: checks.length,
        successPct: checks.length ? checks.filter(point => point.online).length / checks.length * 100 : null,
        coveragePct: (1 - unknownMs / (end - start)) * 100,
    };
}
