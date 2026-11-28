// nginx closes a proxied response that is silent for 60s (proxy_read_timeout)
const HEARTBEAT_MS = 25_000;

// Opens a server-sent event stream, kept alive while it's quiet. Resolves the
// sender; `onClose` runs once the client is gone or the stream has ended.
export function openEventStream(res, onClose) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();
    const write = text => { if (!res.writableEnded && !res.destroyed) { res.write(text); } };
    const heartbeat = setInterval(() => write(': ping\n\n'), HEARTBEAT_MS);
    res.on('close', () => {
        clearInterval(heartbeat);
        onClose();
    });
    return data => write(`data: ${JSON.stringify(data)}\n\n`);
}
