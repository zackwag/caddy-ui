import { Router } from 'express';
import { getAuthentication } from '../middleware/auth.js';
import { sendAppError } from '../errorReporting.js';
import { AppError } from '../AppError.js';

export function createAuthRouter(getService = getAuthentication) {
    const router = Router();
    // Session state, CSRF values and one-time recovery keys must never be cached.
    router.use((_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
    router.get('/status', (req, res) => res.json(getService().getAuthState(req)));
    router.get('/csrf', (req, res) => res.json({ csrfToken: getService().sessions.issueCsrfToken(req, res) }));

    function operation(handler) {
        return async (req, res) => {
            try { await handler(req, res, getService()); }
            catch (error) { sendAppError(res, error instanceof AppError ? error : new AppError('REQUEST_FAILED', { cause: error })); }
        };
    }
    router.post('/sessions', operation(async (req, res, service) => {
        await service.login(req, res, req.body);
        res.json({ ok: true });
    }));
    router.post('/setup', operation(async (req, res, service) => {
        const recoveryKey = await service.completeSetup(req, res, req.body);
        res.json({ ok: true, recoveryKey });
    }));
    router.post('/recovery', operation(async (req, res, service) => {
        const recoveryKey = await service.recoverPassword(req, res, req.body);
        res.json({ ok: true, recoveryKey });
    }));
    router.delete('/sessions/current', operation(async (req, res, service) => {
        service.logout(req, res);
        res.json({ ok: true });
    }));
    return router;
}

export default createAuthRouter();
