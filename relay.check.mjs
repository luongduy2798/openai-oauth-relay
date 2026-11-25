import assert from "node:assert/strict";
import { hostPattern, matchCallback, parseOrigin } from "./relay.mjs";

const first = "a".repeat(43);
const second = "b".repeat(43);
const pending = [
  { state: first, origin: "https://quota.example", startedAt: 1, expiresAt: 9 },
  { state: second, origin: "http://localhost:5173", startedAt: 2, expiresAt: 10 },
];
const source = "http://127.0.0.1:1455/auth/callback";
const query = `?code=example-code&state=${second}&example-extra=example-value`;
const match = matchCallback(source + query, pending, 3);

assert.equal(parseOrigin("quota.example"), pending[0].origin);
assert.equal(parseOrigin("localhost:5173"), pending[1].origin);
assert.equal(hostPattern(pending[1].origin), "http://localhost/*");
assert.equal(parseOrigin("https://*.example.com"), null);
assert.equal(parseOrigin("http://quota.example"), null);
assert.ok(match);
assert.equal(match.target, `http://localhost:5173/api/oauth/codex/callback${query}`);
assert.deepEqual(match.activity.fields, ["code", "state"]);
assert.equal(match.activity.otherFields, 1);
assert.doesNotMatch(JSON.stringify(match.activity), /example-code|example-extra|example-value|bbbb/);
assert.equal(matchCallback(source + query, pending, 10), null);
assert.equal(matchCallback(`${source}${query}&state=${first}`, pending, 3), null);
assert.equal(matchCallback(`${source}/other${query}`, pending, 3), null);
assert.equal(matchCallback(source.replace(":1455", ":1456") + query, pending, 3), null);
