// `node --import ./tools/tests/register-mock.mjs` maps @minecraft/server and @minecraft/server-ui to the mocks.
import { register } from 'node:module';

register(
  'data:text/javascript,' +
    encodeURIComponent(`
      export async function resolve(specifier, context, next) {
        if (specifier === '@minecraft/server') return { url: ${JSON.stringify(new URL('./mock-server.mjs', import.meta.url).href)}, shortCircuit: true };
        if (specifier === '@minecraft/server-ui') return { url: ${JSON.stringify(new URL('./mock-server-ui.mjs', import.meta.url).href)}, shortCircuit: true };
        return next(specifier, context);
      }`)
);
