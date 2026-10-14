// Network implementation for the Bedrock Dedicated Server edition.
// Requires the @minecraft/server-net and @minecraft/server-admin modules
// (manifest dependencies added by the build) and, on the server,
// config/default/permissions.json listing both modules under allowed_modules.
import { http, HttpRequest, HttpHeader, HttpRequestMethod } from "@minecraft/server-net";
import { variables, secrets } from "@minecraft/server-admin";

export const EDITION = "server";
export const hasDirectHttp = true;
export const hasServerAdmin = true;

const METHODS = {
    Post: HttpRequestMethod.Post, Get: HttpRequestMethod.Get, Put: HttpRequestMethod.Put,
    Patch: HttpRequestMethod.Patch, Delete: HttpRequestMethod.Delete, Head: HttpRequestMethod.Head,
};

/** {uri, method, headers:[{key,value}], body, timeoutSec} -> {status, body} */
export async function httpSend(req) {
    const r = new HttpRequest(req.uri);
    r.method = METHODS[req.method] || HttpRequestMethod.Post;
    r.body = req.body || "";
    r.timeout = req.timeoutSec || 45;
    r.headers = (req.headers || []).map(h => new HttpHeader(h.key, h.value));
    const res = await http.request(r);
    return { status: res.status, body: res.body };
}

export function readVariable(name) {
    try { return variables.get(name); } catch (e) { return undefined; }
}

/** Returns a SecretString (usable as a header value) or undefined. */
export function readSecret(name) {
    try { return secrets.get(name); } catch (e) { return undefined; }
}

export function secretNames() { try { return secrets.names; } catch (e) { return []; } }
export function variableNames() { try { return variables.names; } catch (e) { return []; } }
