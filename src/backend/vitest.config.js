import { defineConfig } from 'vitest/config';

// Tests that derive credentials with scrypt can approach the 5s default.
export default defineConfig({
    test: { testTimeout: 15000 },
});
