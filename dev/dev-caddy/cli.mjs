import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { checkDocker, Harness, namespace, STATE, withLock } from './harness.mjs';

const [command, ...args] = process.argv.slice(2);
const usage = 'Usage: npm run dev:instances -- create|stop|remove|list|remove-all [name] [--purge] [--yes]';

try {
    if (!['create', 'stop', 'remove', 'list', 'remove-all'].includes(command)) throw new Error(usage);
    const purge = args.includes('--purge');
    const yes = args.includes('--yes');
    const names = args.filter(arg => !arg.startsWith('--'));
    if (args.some(arg => arg.startsWith('--') && !['--purge', '--yes'].includes(arg)) ||
        names.length !== (['create', 'stop', 'remove'].includes(command) ? 1 : 0) ||
        (purge && !['remove', 'remove-all'].includes(command))) throw new Error(usage);
    const destructive = command === 'remove-all' || purge;
    let confirmed = yes;
    if (destructive && !confirmed) {
        if (!stdin.isTTY) throw new Error('This operation requires explicit confirmation. Review the scope and pass --yes.');
        const rl = createInterface({ input: stdin, output: stdout });
        try {
            confirmed = (await rl.question(`Remove ${command === 'remove-all' ? 'all instances in this checkout' : names[0]}${purge ? ' AND their persistent data' : ' (retain data)'}? Type yes: `)) === 'yes';
        } finally { rl.close(); }
        if (!confirmed) throw new Error('Cancelled.');
    }
    await checkDocker();
    await withLock(STATE, async () => {
        const harness = new Harness(await namespace());
        if (command === 'create') {
            const info = await harness.create(names[0]);
            console.log(JSON.stringify(info, null, 2));
            console.log('Register the instance in the UI using the fields above. Discovery may suggest an unreachable address on Docker Desktop; use adminUrl above.');
        } else if (command === 'list') {
            for (const name of await harness.names()) {
                const detail = await harness.inspect('container', harness.resource(name));
                console.log(JSON.stringify({ name, running: detail.State.Running, containerName: harness.resource(name) }));
                if (detail.State.Running) console.log(JSON.stringify(await harness.describe(name)));
            }
            console.log('Retained data volumes:', (await harness.names('volume')).join(', ') || '(none)');
        } else if (command === 'stop') await harness.stop(names[0]);
        else if (command === 'remove') await harness.remove(names[0], purge);
        else await harness.removeAll({ confirmed, purge });
    });
} catch (error) {
    console.error(error.message);
    process.exitCode = 1;
}
