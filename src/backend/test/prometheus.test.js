import { describe, expect, it } from 'vitest';
import { formatLabels, metricValue, parseMetrics } from '../src/prometheus.js';

describe('parseMetrics', () => {
    it('reads names, labels and values in any number format', () => {
        expect(parseMetrics(`plain 42

scientific 1.5e+3
small 2.5e-05
labeled{code="200",le="+Inf"} 7 1700000000000
limit +Inf`)).toEqual([
            { name: 'plain', labels: {}, value: 42 },
            { name: 'scientific', labels: {}, value: 1500 },
            { name: 'small', labels: {}, value: 0.000025 },
            { name: 'labeled', labels: { code: '200', le: '+Inf' }, value: 7 },
            { name: 'limit', labels: {}, value: Infinity },
        ]);
    });

    it('skips comments, even ones that look like samples, and samples without a number', () => {
        expect(parseMetrics('# old_metric 5\n# HELP metric Help 1\nmetric NaN\nword\n')).toEqual([]);
    });

    it('reads back any label value it writes', () => {
        const labels = { name: 'My "lab"\\box\nx, y=1}' };
        expect(parseMetrics(`metric{${formatLabels(labels)}} 1`)).toEqual([{ name: 'metric', labels, value: 1 }]);
    });

    it('finds a metric reported once', () => {
        const samples = parseMetrics('a 1\nb 2\n');
        expect(metricValue(samples, 'b')).toBe(2);
        expect(metricValue(samples, 'c')).toBeUndefined();
    });
});
