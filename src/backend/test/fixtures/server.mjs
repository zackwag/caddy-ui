import { once } from 'node:events';
import express from 'express';
import { diagnosticMiddleware, errorHandler } from '../../src/errorReporting.js';

// A real HTTP server around the routes `setup(app)` mounts, with the same body
// parsing, diagnostics and error handling as the app.
export async function serve(setup) {
    const app = express();
    app.use(express.json());
    app.use(express.text({ type: 'text/plain' }));
    app.use(diagnosticMiddleware);
    await setup(app);
    app.use(errorHandler);
    const server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    return {
        url: `http://127.0.0.1:${server.address().port}`,
        async close() {
            server.closeAllConnections();
            await new Promise(resolve => server.close(resolve));
        },
    };
}
