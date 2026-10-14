// Own resource acquisition and teardown, independent of Docker, HTTP or browsers.
export class FixtureScope {
    #controller;
    #pending;
    #disposers;
    #parentSignal;
    #onAbort;
    #closed = false;
    #cleanup;

    constructor(signal) {
        this.#controller = new AbortController();
        this.#pending = new Set();
        this.#disposers = [];
        this.#parentSignal = signal;
        this.#onAbort = () => {
            this.#controller.abort(signal.reason);
            // The owner also awaits close(), where cleanup failures are reported.
            void this.close().catch(() => {});
        };
        signal?.addEventListener('abort', this.#onAbort, { once: true });
        if (signal?.aborted) this.#onAbort();
    }

    get signal() { return this.#controller.signal; }

    defer(dispose) { this.#disposers.push(dispose); }

    async run(action) {
        this.signal.throwIfAborted();
        if (this.#closed) throw new Error('Fixture is closed');
        const pending = Promise.resolve().then(() => {
            this.signal.throwIfAborted();
            return action();
        });
        this.#pending.add(pending);
        try {
            const value = await pending;
            this.signal.throwIfAborted();
            return value;
        } finally { this.#pending.delete(pending); }
    }

    acquire(start, dispose) {
        return this.run(async () => {
            const value = await start();
            this.defer(() => dispose(value));
            return value;
        });
    }

    close() {
        // Set #closed synchronously so run() rejects immediately, even if
        // close()'s async body has not yet drained #pending.
        this.#closed = true;
        return this.#cleanup ??= Promise.resolve().then(async () => {
            this.#parentSignal?.removeEventListener('abort', this.#onAbort);
            this.#controller.abort(new Error('Fixture is closed'));
            // A mutation may create resources even after cancellation. Finish it
            // before disposing resources, including acquisitions that return late.
            await Promise.allSettled([...this.#pending]);
            const errors = [];
            for (const dispose of this.#disposers.reverse()) {
                try { await dispose(); } catch (error) { errors.push(error); }
            }
            if (errors.length) throw new AggregateError(errors, 'Fixture cleanup failed');
        });
    }
}
