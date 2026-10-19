import { Router } from 'express';
import { getAuthentication } from '../middleware/auth.js';
import { sendAppError } from '../errorReporting.js';
import { AppError } from '../AppError.js';

export function createAuthRouter(getService = getAuthentication) {
    const router = Router();
    // Session state, CSRF values and one-time recovery keys must never be cached.
    router.use((_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
    router.get('/status', (req, res) => res.json(getService().getAuthState(req)));
    router.get('/csrf', (req, res) => {
        if (req.headers['sec-fetch-mode'] === 'navigate') {
            return res.status(403).json({ code: 'CSRF_NAVIGATION', error: 'This endpoint does not accept navigations' });
        }
        res.json({ csrfToken: getService().sessions.issueCsrfToken(req, res) });
    });

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
    router.get('/credentials', operation(async (req, res, service) => res.json(service.getCredentials(req, res))));
    router.patch('/credentials', operation(async (req, res, service) => res.json(await service.updateCredentials(req, res, req.body))));
    router.get('/passkeys', operation(async (req, res, service) => res.json(service.passkeys.list(req, res))));
    router.post('/passkeys/authentication/options', operation(async (req, res, service) => res.json(await service.passkeys.authenticationOptions(req))));
    router.post('/passkeys/authentication', operation(async (req, res, service) => {
        await service.passkeys.authenticate(req, res, req.body);
        res.json({ ok: true });
    }));
    router.post('/passkeys/registration/options', operation(async (req, res, service) => res.json(await service.passkeys.registrationOptions(req, res, req.body))));
    router.post('/passkeys/registration', operation(async (req, res, service) => res.status(201).json(await service.passkeys.register(req, res, req.body))));
    router.delete('/passkeys/:id', operation(async (req, res, service) => {
        await service.passkeys.remove(req, res, req.params.id, req.body);
        res.json({ ok: true });
    }));
    router.get('/tokens', operation(async (req, res, service) => res.json(service.listApiTokens(req, res))));
    router.post('/tokens', operation(async (req, res, service) => res.status(201).json(await service.issueApiToken(req, res, req.body))));
    router.delete('/tokens/:id', operation(async (req, res, service) => {
        await service.revokeApiToken(req, res, req.params.id);
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
