import { readFile, writeFile, readdir, rm, access } from 'fs/promises';
import { dockerExec } from './docker.js';

function useDocker(containerName) {
    return !!containerName;
}

export async function readContainerFile(containerName, filePath) {
    if (useDocker(containerName)) {
        const { stdout } = await dockerExec(['cat', filePath], undefined, containerName);
        return stdout;
    }
    return readFile(filePath, 'utf8');
}

export async function writeContainerFile(containerName, filePath, content) {
    if (useDocker(containerName)) {
        await dockerExec(['tee', filePath], content, containerName);
        return;
    }
    await writeFile(filePath, content, 'utf8');
}

export async function listContainerDir(containerName, dirPath) {
    try {
        if (useDocker(containerName)) {
            const { stdout } = await dockerExec(['ls', '-1', dirPath], undefined, containerName);
            return stdout.trim().split('\n').filter(Boolean);
        }
        return await readdir(dirPath);
    } catch {
        return [];
    }
}

export async function removeContainerPath(containerName, targetPath) {
    if (useDocker(containerName)) {
        await dockerExec(['rm', '-rf', targetPath], undefined, containerName);
        return;
    }
    await rm(targetPath, { recursive: true, force: true });
}

export async function containerPathExists(containerName, targetPath) {
    try {
        if (useDocker(containerName)) {
            await dockerExec(['test', '-e', targetPath], undefined, containerName);
            return true;
        }
        await access(targetPath);
        return true;
    } catch {
        return false;
    }
}
