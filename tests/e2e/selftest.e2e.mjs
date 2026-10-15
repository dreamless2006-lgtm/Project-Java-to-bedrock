// The bridge's own self-test (node index.mjs --selftest) against a real Bedrock server: it must pass on a
// server that accepts the body's movement, and FAIL, saying why, on one that pulls it back every time.
// Its verdict comes from the server's answers, not from the bridge's own belief.
import { startWorld, sleep } from "./lib.mjs";

const fails = [];
function check(cond, msg) { if (!cond) { fails.push(msg); console.log("FAIL -", msg); } else console.log("ok   -", msg); }

// 1. a server that lets the body move
let w = await startWorld({ connect: {} });
try {
    const res = await w.bridge.selfTest(l => console.log("   ", l));
    check(res.ok, "the self-test passes against a server that accepts movement");
    check(res.checks.length >= 7, "and ran every check (" + res.checks.length + ")");
    check(!!w.server.pos(w.name), "the server reported the body's position independently");
} catch (e) {
    fails.push("test aborted: " + (e && e.stack || e));
} finally {
    await w.stop();
}
await sleep(1500);

// 2. a server that rejects every move
w = await startWorld({ connect: {}, serverEnv: { DF_FREEZE: "1" } });
try {
    const res = await w.bridge.selfTest(l => console.log("   ", l));
    check(!res.ok, "the self-test FAILS against a server that pulls the body back");
    const walk = res.checks.find(c => /walking forward/.test(c.name));
    check(walk && !walk.ok && /rubber-banding|ignores/.test(walk.detail), "and says why: " + (walk && walk.detail));
} catch (e) {
    fails.push("test aborted: " + (e && e.stack || e));
} finally {
    await w.stop();
}
if (fails.length) { console.log("\nFAILED:\n - " + fails.join("\n - ")); process.exit(1); }
console.log("\nself-test end-to-end OK");
process.exit(0);
