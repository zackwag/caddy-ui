// A second native Node test reporter; the ordinary TAP log is retained separately.
export default async function* report(source) {
    for await (const event of source) {
        if (!['test:pass', 'test:fail', 'test:summary'].includes(event.type)) continue;
        const { name, nesting, skip, details, counts, duration_ms } = event.data;
        yield JSON.stringify({ type: event.type, name, nesting, skip: !!skip, counts, duration_ms,
            durationMs: details?.duration_ms, error: details?.error ? {
                message: details.error.message, stack: details.error.stack,
                cause: details.error.cause?.message,
            } : null }) + '\n';
    }
}
