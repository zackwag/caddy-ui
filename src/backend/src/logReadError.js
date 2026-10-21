import { AppError } from './AppError.js';

export function logReadError(cause, instance, fallbackCode = 'LOG_READ_FAILED') {
    // ENOENT from spawn means the command is missing, not the requested file.
    // Require tail itself to identify this path as missing (GNU, BSD, BusyBox).
    const detail = String(cause?.stderr || cause?.message || '');
    const missing = detail.split(/\r?\n/).some(line => /^tail:\s/.test(line)
        && line.includes(instance.logPath) && /no such file or directory\s*$/i.test(line));
    return new AppError(missing ? 'LOG_FILE_MISSING' : fallbackCode, { cause,
        context: { instanceId: instance.id, containerName: instance.containerName, logPath: instance.logPath },
    });
}
