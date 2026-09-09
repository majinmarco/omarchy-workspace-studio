import test from 'node:test';
import assert from 'node:assert/strict';
import { loadSandbox, readRepoFile } from './sandbox.helper.mjs';

const S = loadSandbox();

// The regression net for v0.2. Both fixtures are byte copies of a real machine:
// the v0.1 document that was on disk at ~/.config/omarchy/workspace-studio.json
// and the Lua that v0.1 generated from it. Everything v0.2 adds is additive, and
// these three tests are what proves it — if a change makes an existing document
// serialize differently, or makes it compile to different Lua, it fails here
// before it ever reaches anyone's compositor.

const LIVE_JSON = readRepoFile('tests/fixtures/live-v0.1.json');
const LIVE_LUA = readRepoFile('tests/fixtures/live-v0.1.lua');

test('a v0.1 document round-trips byte-identically', () => {
  const parsed = S.parse(LIVE_JSON);
  assert.notEqual(parsed, null);
  assert.equal(S.serialize(parsed), LIVE_JSON);
});

test('a v0.1 document generates byte-identical Lua', () => {
  const parsed = S.parse(LIVE_JSON);
  // v0.1 stamped its own version into the header; pin it so the comparison is
  // about the rules and not about the version string.
  const lua = S.toLua(parsed, { version: '0.1.0' });
  assert.equal(lua, LIVE_LUA);
});

test('the round trip survives a second pass', () => {
  const once = S.serialize(S.parse(LIVE_JSON));
  const twice = S.serialize(S.parse(once));
  assert.equal(twice, once);
});

test('desktop and arrangement keys are absent when unset', () => {
  const text = JSON.stringify(S.defaults());
  assert.equal(text.indexOf('"desktop"'), -1);
  assert.equal(text.indexOf('"arrangement"'), -1);
  assert.equal(JSON.stringify(S.defaultApp()).indexOf('"desktop"'), -1);
  assert.equal(JSON.stringify(S.defaultWorkspace(1)).indexOf('"arrangement"'), -1);
});

test('an empty arrangement never reaches the serialized document', () => {
  const config = S.normalize({
    workspaces: [{ id: 1, name: 'x', arrangement: { mode: 'none', root: { app: 0 } } }]
  });
  assert.equal(JSON.stringify(config).indexOf('arrangement'), -1);
});

// The generator must be inert for a document that predates the feature even
// when the layout module is not wired up at all.
test('without the layout module a v0.1 document still generates the same Lua', () => {
  const bare = loadSandbox({ layout: false });
  assert.equal(bare.toLua(bare.parse(LIVE_JSON), { version: '0.1.0' }), LIVE_LUA);
});
