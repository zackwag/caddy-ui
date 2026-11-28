// Prometheus text exposition, read and written.

const SAMPLE = /^([a-zA-Z_:][\w:]*)(?:\{(.*)\})?\s+(\S+)/;
const LABEL = /([a-zA-Z_]\w*)="((?:[^"\\]|\\.)*)"/g;
const UNESCAPED = { '\\\\': '\\', '\\"': '"', '\\n': '\n' };

// [{ name, labels, value }] in the order they appear. Comments and samples
// without a number are skipped.
export function parseMetrics(text) {
    const samples = [];
    for (const line of text.split('\n')) {
        const match = SAMPLE.exec(line.trim());
        const value = match ? Number(match[3].replace(/^([+-]?)Inf$/, '$1Infinity')) : NaN;
        if (Number.isNaN(value)) continue;
        const labels = Object.fromEntries([...(match[2] || '').matchAll(LABEL)]
            .map(([, name, raw]) => [name, raw.replace(/\\[\\"n]/g, escaped => UNESCAPED[escaped])]));
        samples.push({ name: match[1], labels, value });
    }
    return samples;
}

// The value of a metric reported once, or undefined.
export function metricValue(samples, name) {
    return samples.find(sample => sample.name === name)?.value;
}

function escapeLabelValue(value) {
    return String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
}

export function formatLabels(labels) {
    return Object.entries(labels).map(([k, v]) => `${k}="${escapeLabelValue(v)}"`).join(',');
}

// One gauge family: its HELP and TYPE lines, then a sample per series, whose
// `labels` are already formatted.
export function formatGauge(name, help, series) {
    return `# HELP ${name} ${help}\n# TYPE ${name} gauge\n`
        + series.map(({ labels, value }) => `${name}{${labels}} ${value}\n`).join('');
}
