import assert from "node:assert/strict";
import { ambiguousCallbackRule, callbackRule, hostPattern, matchCallback, parseOrigin } from "./relay.mjs";

const first = "a".repeat(43);
const second = "b".repeat(43);
const pending = [
  { state: first, origin: "https://quota.example", startedAt: 1, expiresAt: 9 },
  { state: second, origin: "http://localhost:5173", startedAt: 2, expiresAt: 10 },
];
const source = "http://127.0.0.1:1455/auth/callback";
const query = `?code=example-code&state=${second}&example-extra=example-value`;
const rule = callbackRule(pending[1], 2);
const regex = new RegExp(rule.condition.regexFilter);
const guard = ambiguousCallbackRule();
const ambiguous = new RegExp(guard.condition.regexFilter);
const redirected = (url) => url.replace(regex, rule.action.redirect.regexSubstitution.replace(/\\(\d)/g, "$$$1"));
const target = redirected(source + query);
const match = matchCallback(target, pending, 3);

assert.equal(parseOrigin("quota.example"), pending[0].origin);
assert.equal(parseOrigin("localhost:5173"), pending[1].origin);
assert.equal(hostPattern(pending[1].origin), "http://localhost/*");
assert.equal(parseOrigin("https://*.example.com"), null);
assert.equal(parseOrigin("http://quota.example"), null);
assert.deepEqual(rule.condition.resourceTypes, ["main_frame"]);
assert.ok(guard.priority > (rule.priority ?? 1));
assert.equal(guard.action.type, "allow");
assert.equal(ambiguous.test(source + query), false);
assert.equal(target, `http://localhost:5173/api/oauth/codex/callback${query}#openai-oauth-relay-127.0.0.1`);
assert.match(redirected(`http://localhost:1455/auth/callback?state=${second}&error=access_denied`), /#openai-oauth-relay-localhost$/);
assert.equal(regex.test(`${source}?state=${first}&code=example-code`), false);
assert.equal(ambiguous.test(`${source}${query}&state=${first}`), true);
assert.equal(ambiguous.test(`${source}?st%61te=${first}&state=${second}`), true);
assert.equal(ambiguous.test(`${source}?code=example%2Bcode&state=${second}`), false);
assert.equal(regex.test(`${source}/other${query}`), false);
assert.equal(regex.test(source.replace(":1455", ":1456") + query), false);
assert.ok(match);
assert.equal(match.activity.source, source);
assert.equal(match.activity.destination, "http://localhost:5173/api/oauth/codex/callback");
assert.deepEqual(match.activity.fields, ["code", "state"]);
assert.equal(match.activity.otherFields, 1);
assert.doesNotMatch(JSON.stringify(match.activity), /example-code|example-extra|example-value|bbbb/);
assert.equal(matchCallback(target, pending, 10), null);
assert.equal(matchCallback(target.replace("localhost:5173", "localhost:5174"), pending, 3), null);
