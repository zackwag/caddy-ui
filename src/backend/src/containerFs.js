import { readFile, writeFile, readdir, rm, access } from 'fs/promises';
import { dockerExec, isContainerUnreachable } from './docker.js';

export async function readContainerFile(containerName, filePath) {
    if (containerName) {
        const { stdout } = await dockerExec(containerName, ['cat', '--', filePath]);
        return stdout;
    }
    return readFile(filePath, 'utf8');
}

export async function writeContainerFile(containerName, filePath, content) {
    if (containerName) {
        await dockerExec(containerName, ['tee', '--', filePath], content);
        return;
    }
    await writeFile(filePath, content, 'utf8');
}

export async function readContainerDir(containerName, dirPath) {
    if (containerName) {
        const { stdout } = await dockerExec(containerName, ['ls', '-1', '--', dirPath]);
        return stdout.trim().split('\n').filter(Boolean);
    }
    return readdir(dirPath);
}

// Like readContainerDir, but treats an unreadable directory as empty.
export async function listContainerDir(containerName, dirPath) {
    try {
        return await readContainerDir(containerName, dirPath);
    } catch {
        return [];
    }
}

// Why a path couldn't be read, so a missing volume mount and a permissions
// problem don't look the same in the logs. Handles both fs errors (local mode)
// and the stderr of commands run through docker exec.
export function describeReadError(err) {
    const text = `${err?.code || ''} ${err?.stderr || ''} ${err?.message || ''}`;
    if (isContainerUnreachable(err)) {
        return err.message;
    }
    if (/ENOENT|no such file/i.test(text)) {
        return 'not found';
    }
    if (/EACCES|EPERM|permission denied/i.test(text)) {
        return 'permission denied';
    }
    return err?.message || 'unknown error';
}

export async function removeContainerPath(containerName, targetPath) {
    if (containerName) {
        await dockerExec(containerName, ['rm', '-rf', '--', targetPath]);
        return;
    }
    await rm(targetPath, { recursive: true, force: true });
}

export async function containerPathExists(containerName, targetPath) {
    try {
        if (containerName) {
            // `test -e -- path` is a syntax error in GNU, BSD and busybox test
            await dockerExec(containerName, ['ls', '-d', '--', targetPath]);
            return true;
        }
        await access(targetPath);
        return true;
    } catch {
        return false;
    }
}
