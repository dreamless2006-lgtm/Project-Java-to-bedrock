// `node --import ./tools/tests/register-mock.mjs` maps @minecraft/server to the mock above.
import { register } from 'node:module';

register(
  'data:text/javascript,' +
    encodeURIComponent(`
      export async function resolve(specifier, context, next) {
        if (specifier === '@minecraft/server') return { url: ${JSON.stringify(new URL('./mock-server.mjs', import.meta.url).href)}, shortCircuit: true };
        return next(specifier, context);
      }`)
);
