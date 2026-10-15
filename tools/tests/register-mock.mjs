// `node --import ./tools/tests/register-mock.mjs` maps @minecraft/server and @minecraft/server-ui to the mocks.
import { register } from 'node:module';

register(
  'data:text/javascript,' +
    encodeURIComponent(`
      export async function resolve(specifier, context, next) {
        if (specifier === '@minecraft/server') return { url: ${JSON.stringify(new URL('./mock-server.mjs', import.meta.url).href)}, shortCircuit: true };
        if (specifier === '@minecraft/server-ui') return { url: ${JSON.stringify(new URL('./mock-server-ui.mjs', import.meta.url).href)}, shortCircuit: true };
        // The Jenny Mod Java Port's own scripts are not run under the mock (their API use is theirs to test).
        if (specifier.endsWith('/jenny_port/main.js')) return { url: 'data:text/javascript,throw%20new%20Error(%22not%20loaded%20under%20the%20tests%22)', shortCircuit: true };
        return next(specifier, context);
      }`)
);
