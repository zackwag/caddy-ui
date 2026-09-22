import { dockerExec } from './docker.js';

export async function readContainerFile(containerName, filePath) {
    const { stdout } = await dockerExec(['cat', filePath], undefined, containerName);
    return stdout;
}

export async function writeContainerFile(containerName, filePath, content) {
    await dockerExec(['tee', filePath], content, containerName);
}

export async function listContainerDir(containerName, dirPath) {
    try {
        const { stdout } = await dockerExec(['ls', '-1', dirPath], undefined, containerName);
        return stdout.trim().split('\n').filter(Boolean);
    } catch {
        return [];
    }
}

export async function removeContainerPath(containerName, targetPath) {
    await dockerExec(['rm', '-rf', targetPath], undefined, containerName);
}

export async function containerPathExists(containerName, targetPath) {
    try {
        await dockerExec(['test', '-e', targetPath], undefined, containerName);
        return true;
    } catch {
        return false;
    }
}
