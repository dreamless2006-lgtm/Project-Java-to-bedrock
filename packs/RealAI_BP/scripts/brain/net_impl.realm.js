// Network implementation for the Realm/client edition: there is no
// @minecraft/server-net here, so direct HTTP is unavailable and the brain
// talks to the external bridge instead. The build swaps this file for
// net_impl.bds.js in the dedicated-server edition.
export const EDITION = "standard";
export const hasDirectHttp = false;
export const hasServerAdmin = false;

export async function httpSend() {
    throw new Error("direct HTTP is not available in the Realm edition; run the bridge");
}

export function readVariable() { return undefined; }
export function readSecret() { return undefined; }
export function secretNames() { return []; }
export function variableNames() { return []; }
