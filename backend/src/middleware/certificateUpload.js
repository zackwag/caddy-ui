import { json } from 'express';
import { authMiddleware } from './auth.js';

export const MAX_CERTIFICATE_BYTES = 1024 * 1024;
export function validCertificateFiles(certificate, privateKey) {
    return [certificate, privateKey].every(value => typeof value === 'string'
        && value.length > 0 && Buffer.byteLength(value, 'utf8') <= MAX_CERTIFICATE_BYTES);
}

// Two 1 MiB PEM files plus JSON escaping. Never echo parser errors/body data.
const parse = json({ limit: '3mb' });
export const certificateUploadBody = [authMiddleware, (req, res, next) => {
    parse(req, res, err => {
        if (!err) return next();
        res.status(err.type === 'entity.too.large' ? 413 : 400).json({
            error: err.type === 'entity.too.large' ? 'Certificate upload exceeds request limit' : 'Invalid certificate upload JSON',
        });
    });
}];
