// `node --import ./tools/tests/register-mock.mjs` maps @minecraft/server and @minecraft/server-ui to the mocks.
import { register } from 'node:module';

register(
  'data:text/javascript,' +
    encodeURIComponent(`
      export async function resolve(specifier, context, next) {
        if (specifier === '@minecraft/server') return { url: ${JSON.stringify(new URL('./mock-server.mjs', import.meta.url).href)}, shortCircuit: true };
        if (specifier === '@minecraft/server-ui') return { url: ${JSON.stringify(new URL('./mock-server-ui.mjs', import.meta.url).href)}, shortCircuit: true };
        // The Jenny Mod Java Port's own scripts are not run under the mock (their API use is theirs to test);
        // our optional imports of them fall back to our own code paths.
        if (specifier.includes('/jenny_port/')) return { url: 'data:text/javascript,throw%20new%20Error(%22not%20loaded%20under%20the%20tests%22)', shortCircuit: true };
        // Reign of Nether's generated data (tools/import-reign.mjs) is not read by the tests either: they inject fixtures.
        if (specifier.includes('/reign_port/')) return { url: 'data:text/javascript,throw%20new%20Error(%22not%20loaded%20under%20the%20tests%22)', shortCircuit: true };
        return next(specifier, context);
      }`)
);
