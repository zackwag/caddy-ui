import { Harness, IMAGE } from '../../scripts/dev-caddy/harness.mjs';

// The manifest records fresh namespaces BEFORE startup, so interrupted runs can
// clean up without inspecting or deleting resources outside those namespaces.
export async function cleanupNamespace(project, run) {
    const harness = new Harness(project, run);
    await harness.removeAll({ confirmed: true, purge: true });
    const name = `caddy-ui-test-${project}-lease`;
    const ids = await harness.run(['ps', '-aq', '--no-trunc', '--filter', `name=^/${name}$`]);
    if (ids) {
        const [lease] = JSON.parse(await harness.run(['container', 'inspect', name]));
        if (lease.Name !== '/' + name || lease.Config?.Labels?.['io.caddy-ui.test-fixture'] !== 'true' ||
            lease.Config?.Labels?.['io.caddy-ui.test-project'] !== project || lease.Config?.Image !== IMAGE ||
            lease.HostConfig?.NetworkMode !== 'none' || lease.Mounts?.length !== 0) {
            throw new Error('Lease ownership mismatch; refusing cleanup');
        }
        await harness.run(['rm', lease.Id]);
    }
    const [containers, volumes] = await Promise.all([harness.names(), harness.names('volume')]);
    if (containers.length || volumes.length) throw new Error('Owned resources remain after diagnostic cleanup');
    return { project, containers: [], volumes: [], leaseRemoved: true };
}
