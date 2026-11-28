import { AppError } from './AppError.js';
import { isContainerUnreachable } from './docker.js';

export function logReadError(cause, instance, fallbackCode = 'LOG_READ_FAILED') {
    // ENOENT from spawn means the command is missing, not the requested file.
    // Require tail itself to identify this path as missing (GNU, BSD, BusyBox).
    // This matches untranslated messages only; a localized tail reads as a failure.
    const detail = String(cause?.stderr || cause?.message || '');
    const missing = detail.split(/\r?\n/).some(line => /^tail:\s/.test(line)
        && line.includes(instance.logPath) && /no such file or directory\s*$/i.test(line));
    const unavailable = !missing && instance.containerName && isContainerUnreachable(cause);
    const code = missing ? 'LOG_FILE_MISSING' : unavailable ? 'LOG_SOURCE_UNAVAILABLE' : fallbackCode;
    return new AppError(code, { cause,
        context: { instanceId: instance.id, containerName: instance.containerName, logPath: instance.logPath },
    });
}
