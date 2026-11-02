import { validateCapture } from '../../dev/playground/capture-format.js';

// Documentation replays a successfully enrolled installation. It must not
// recreate the retired authentication opt-out or guess missing API responses.
export function screenshotRecords(capture) {
    validateCapture(capture);
    const records = capture.scenarios.flatMap(scenario => scenario.requests);
    const auth = records.find(record => record.request.method === 'GET' && record.request.path === '/auth/status');
    if (auth?.response.status !== 200 || auth.response.body?.authEnabled !== true
        || auth.response.body.authenticated !== true || auth.response.body.setupRequired !== false) {
        throw new Error('Screenshot capture lacks an authenticated administrator. Refresh it with npm run docs:screenshots:capture.');
    }
    return records;
}
