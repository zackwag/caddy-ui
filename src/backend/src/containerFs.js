import { readFile, writeFile, readdir, rm, access } from 'fs/promises';
import { dockerExec } from './docker.js';

function useDocker(containerName) {
    return !!containerName;
}

export async function readContainerFile(containerName, filePath) {
    if (useDocker(containerName)) {
        const { stdout } = await dockerExec(['cat', '--', filePath], undefined, containerName);
        return stdout;
    }
    return readFile(filePath, 'utf8');
}

export async function writeContainerFile(containerName, filePath, content) {
    if (useDocker(containerName)) {
        await dockerExec(['tee', '--', filePath], content, containerName);
        return;
    }
    await writeFile(filePath, content, 'utf8');
}

export async function readContainerDir(containerName, dirPath) {
    if (useDocker(containerName)) {
        const { stdout } = await dockerExec(['ls', '-1', '--', dirPath], undefined, containerName);
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
    if (/docker daemon|no such container/i.test(text)) return err.message;
    if (/ENOENT|no such file/i.test(text)) return 'not found';
    if (/EACCES|EPERM|permission denied/i.test(text)) return 'permission denied';
    return err?.message || 'unknown error';
}

export async function removeContainerPath(containerName, targetPath) {
    if (useDocker(containerName)) {
        await dockerExec(['rm', '-rf', '--', targetPath], undefined, containerName);
        return;
    }
    await rm(targetPath, { recursive: true, force: true });
}

export async function containerPathExists(containerName, targetPath) {
    try {
        if (useDocker(containerName)) {
            await dockerExec(['test', '-e', '--', targetPath], undefined, containerName);
            return true;
        }
        await access(targetPath);
        return true;
    } catch {
        return false;
    }
}
