import { AppError } from './AppError.js';

// Docker could not reach the instance's container at all. A command missing
// inside a running container is a read failure, not an unavailable source.
const SOURCE_UNAVAILABLE = /cannot connect to the docker daemon|is the docker daemon running|no such container|is not running|permission denied while trying to connect|^spawn docker ENOENT$/im;

export function logReadError(cause, instance, fallbackCode = 'LOG_READ_FAILED') {
    // ENOENT from spawn means the command is missing, not the requested file.
    // Require tail itself to identify this path as missing (GNU, BSD, BusyBox).
    // This matches untranslated messages only; a localized tail reads as a failure.
    const detail = String(cause?.stderr || cause?.message || '');
    const missing = detail.split(/\r?\n/).some(line => /^tail:\s/.test(line)
        && line.includes(instance.logPath) && /no such file or directory\s*$/i.test(line));
    const unavailable = !missing && instance.containerName && SOURCE_UNAVAILABLE.test(detail);
    const code = missing ? 'LOG_FILE_MISSING' : unavailable ? 'LOG_SOURCE_UNAVAILABLE' : fallbackCode;
    return new AppError(code, { cause,
        context: { instanceId: instance.id, containerName: instance.containerName, logPath: instance.logPath },
    });
}
