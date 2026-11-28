import { getInstanceId } from './api.js';
import { localizeError, localizeWarning } from './errorMessages.js';

// What views say to the user. Errors are localized here, so no caller can show
// a raw server message.
export function createToast(center, t) {
    // A continuing condition, such as a view that can't load: reported once on
    // the selected instance, until it has recovered. Having no instances is
    // shown by the page the app redirects to.
    function incident(scope) {
        const key = `${scope}:${getInstanceId()}`;
        return {
            fail(error) {
                if (error.code !== 'NO_INSTANCES') {
                    center.notify(localizeError(error, t), 'error', error, { mode: 'state', key });
                }
            },
            recover: () => center.recover(key),
        };
    }

    return {
        success: message => center.notify(message, 'success'),
        // Already translated text, for a failure that isn't an API error
        failure: message => center.notify(message, 'error'),
        error: error => center.notify(localizeError(error, t), 'error', error),
        // The outcome of a saved configuration change: its warning, if any
        saved(result, message) {
            if (result?.warning) {
                center.notify(localizeWarning(result, t), 'info', result);
            } else {
                center.notify(message, 'success');
            }
        },
        incident,
        // An incident that lasts as long as a request keeps failing. Settles
        // like the request, unless `signal` aborts first: its view is gone,
        // so the outcome is neither reported nor delivered.
        async track(scope, request, { signal } = {}) {
            const { fail, recover } = incident(scope);
            let value;
            try {
                value = await request;
            } catch (error) {
                if (signal?.aborted) {
                    return new Promise(() => { });
                }
                fail(error);
                throw error;
            }
            if (signal?.aborted) {
                return new Promise(() => { });
            }
            recover();
            return value;
        },
        clearStates: () => center.clearStates(),
    };
}
