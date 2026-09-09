import test from 'node:test';
import assert from 'node:assert/strict';
import { loadSandbox, readRepoJson, plain } from './sandbox.helper.mjs';

const S = loadSandbox();

// ------------------------------------------------------------- defaults

test('defaults() is a valid five-workspace document', () => {
  const config = S.defaults();
  assert.equal(config.version, 1);
  assert.equal(config.workspaces.length, 5);
  assert.deepEqual(plain(config.workspaces.map(w => w.id)), [1, 2, 3, 4, 5]);
  assert.equal(S.validate(config).ok, true);
});

test('empty() has no workspaces and does not validate', () => {
  const config = S.empty();
  assert.equal(config.workspaces.length, 0);
  const result = S.validate(config);
  assert.equal(result.ok, false);
  assert.equal(result.errors[0].path, 'workspaces');
});

test('default keysyms are keysyms, never keycodes', () => {
  for (const sym of S.defaults().binds.keysyms) {
    assert.match(sym, /^[A-Za-z0-9_]+$/);
    assert.doesNotMatch(sym, /^code/i);
  }
});

// ------------------------------------------------------------ normalize

test('normalize fills every field and tolerates garbage', () => {
  for (const junk of [null, undefined, 0, 'nope', [], true]) {
    const config = S.normalize(junk);
    assert.equal(config.version, 1);
    assert.deepEqual(plain(config.workspaces), []);
    assert.equal(config.binds.focusMods, 'SUPER');
    assert.equal(config.apply.reloadMode, 'config-only');
  }
});

test('normalize sorts workspaces, drops duplicate ids and clamps the count', () => {
  const many = [];
  for (let i = 1; i <= 30; i++) many.push({ id: i });
  many.push({ id: 3 });
  const config = S.normalize({ workspaces: many.concat([{ id: 2 }]) });
  assert.equal(config.workspaces.length, 12);
  assert.deepEqual(plain(config.workspaces.map(w => w.id)), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
});

test('normalize strips control characters and truncates long strings', () => {
  const config = S.normalize({
    workspaces: [{ id: 1, name: 'a\u0000b\u001bc', icon: 'x'.repeat(40) }]
  });
  assert.equal(config.workspaces[0].name, 'abc');
  assert.equal(config.workspaces[0].icon.length, 8);
});

test('normalize rejects unknown enum values by falling back', () => {
  const config = S.normalize({
    workspaces: [{ id: 1, layout: 'tabbed', color: 'chartreuse' }],
    apply: { reloadMode: 'nuke' }
  });
  assert.equal(config.workspaces[0].layout, '');
  assert.equal(config.workspaces[0].color, 'default');
  assert.equal(config.apply.reloadMode, 'config-only');
});

test('normalize keeps a hex colour but lowercases it', () => {
  const config = S.normalize({ workspaces: [{ id: 1, color: '#A1B2C3' }] });
  assert.equal(config.workspaces[0].color, '#a1b2c3');
});

test('normalize refuses code:NN keysyms and substitutes the stock one', () => {
  const config = S.normalize({ workspaces: [{ id: 1 }], binds: { keysyms: ['code:10', 'code:11', '3'] } });
  assert.equal(config.binds.keysyms[0], '1');
  assert.equal(config.binds.keysyms[1], '2');
  assert.equal(config.binds.keysyms[2], '3');
  assert.equal(config.binds.keysyms.length, 12);
});

test('normalize rejects modifier lists that are not modifiers', () => {
  const config = S.normalize({ binds: { focusMods: 'SUPER + rm -rf', moveMods: 'super+shift' } });
  assert.equal(config.binds.focusMods, 'SUPER');
  assert.equal(config.binds.moveMods, 'SUPER + SHIFT');
});

test('normalize drops a landOn pointing at a workspace that does not exist', () => {
  assert.equal(S.normalize({ workspaces: [{ id: 1 }], apply: { landOn: 7 } }).apply.landOn, 0);
  assert.equal(S.normalize({ workspaces: [{ id: 7 }], apply: { landOn: 7 } }).apply.landOn, 7);
});

test('normalize is idempotent', () => {
  const once = S.normalize({ workspaces: [{ id: 2, name: 'Term', apps: [{ match: { class: 'foot' } }] }] });
  assert.deepEqual(plain(S.normalize(once)), plain(once));
});

test('normalize drops launcher entries with no command', () => {
  const config = S.normalize({ launchers: { good: { command: 'foot' }, bad: { label: 'x' }, '': { command: 'y' } } });
  assert.deepEqual(plain(Object.keys(config.launchers)), ['good']);
  assert.equal(config.launchers.good.label, 'good');
});

// -------------------------------------------------------------- parsing

test('parse returns null for empty, blank and invalid input', () => {
  for (const raw of ['', '   \n', '{', 'null', '[]', '"a"', undefined, null]) {
    assert.equal(S.parse(raw), null, JSON.stringify(raw));
  }
});

test('parse round-trips a serialized config', () => {
  const config = S.defaults();
  config.workspaces[0].icon = '\u{f00d6}';
  config.workspaces[0].iconName = 'nf-md-briefcase';
  const text = S.serialize(config);
  assert.equal(text[text.length - 1], '\n');
  assert.deepEqual(plain(S.parse(text)), plain(S.normalize(config)));
});

// ------------------------------------------------------------ migration

test('migrate upgrades a v0 icons map to workspaces', () => {
  const config = S.migrate({ icons: { 1: 'A', 2: 'B', 5: 'E' } });
  assert.equal(config.version, 1);
  assert.deepEqual(plain(config.workspaces.map(w => w.id)), [1, 2, 5]);
  assert.deepEqual(plain(config.workspaces.map(w => w.icon)), ['A', 'B', 'E']);
});

test('migrate returns defaults for a non-object document', () => {
  assert.deepEqual(plain(S.migrate('nope')), plain(S.defaults()));
  assert.deepEqual(plain(S.migrate(null)), plain(S.defaults()));
});

test('a future version is migrated forward, and validate warns about it', () => {
  const result = S.validate({ version: 99, workspaces: [{ id: 1, name: 'x' }] });
  assert.equal(result.ok, true);
  assert.ok(result.warnings.some(w => w.path === 'version'));
});

// ------------------------------------------------------------ validation

test('an app with neither a match nor a launch is an error', () => {
  const result = S.validate({ workspaces: [{ id: 1, apps: [{ label: 'Ghost' }] }] });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some(e => /does nothing/.test(e.message)));
});

test('a launch mode without a command is an error', () => {
  const result = S.validate({
    workspaces: [{ id: 1, apps: [{ match: { class: 'a' }, launch: { mode: 'autostart' } }] }]
  });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some(e => /Launch mode needs a command/.test(e.message)));
});

test('an unknown launcher reference is an error', () => {
  const result = S.validate({
    workspaces: [{ id: 1, apps: [{ match: { class: 'a' }, launch: { mode: 'autostart', launcher: 'nope' } }] }]
  });
  assert.ok(result.errors.some(e => /Unknown launcher/.test(e.message)));
});

test('two default workspaces on the same monitor is an error', () => {
  const result = S.validate({
    workspaces: [{ id: 1, default: true, monitor: 'eDP-1' }, { id: 2, default: true, monitor: 'eDP-1' }]
  });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some(e => /both the default/.test(e.message)));
});

test('defaults on different monitors are fine', () => {
  const result = S.validate({
    workspaces: [{ id: 1, default: true, monitor: 'eDP-1' }, { id: 2, default: true, monitor: 'HDMI-A-1' }]
  });
  assert.equal(result.ok, true);
});

test('malformed size and position are errors', () => {
  const result = S.validate({
    workspaces: [{ id: 1, apps: [{ match: { class: 'a' }, rules: { size: 'big', move: 'over there' } }] }]
  });
  assert.equal(result.errors.filter(e => /Size|Position/.test(e.message)).length, 2);
});

test('a launch with no window match is a warning, not an error', () => {
  const result = S.validate({
    workspaces: [{ id: 1, apps: [{ launch: { mode: 'autostart', command: 'foot' } }] }]
  });
  assert.equal(result.ok, true);
  assert.ok(result.warnings.some(w => /not be pinned/.test(w.message)));
});

test('more than one onCreatedEmpty app on a workspace warns about chaining', () => {
  const result = S.validate({
    workspaces: [{
      id: 1,
      apps: [
        { match: { class: 'a' }, launch: { mode: 'onCreatedEmpty', command: 'a' } },
        { match: { class: 'b' }, launch: { mode: 'onCreatedEmpty', command: 'b' } }
      ]
    }]
  });
  assert.equal(result.ok, true);
  assert.ok(result.warnings.some(w => /chained into one command/.test(w.message)));
});

test('going past ten workspaces warns about the non-digit keys', () => {
  const many = [];
  for (let i = 1; i <= 11; i++) many.push({ id: i });
  const result = S.validate({ workspaces: many });
  assert.equal(result.ok, true);
  assert.ok(result.warnings.some(w => /minus/.test(w.message)));
});

// ---------------------------------------------------------- editing aids

test('addWorkspace fills the first free id and refuses duplicates', () => {
  let config = S.normalize({ workspaces: [{ id: 1 }, { id: 3 }] });
  config = S.addWorkspace(config, 0);
  assert.deepEqual(plain(config.workspaces.map(w => w.id)), [1, 2, 3]);
  config = S.addWorkspace(config, 3);
  assert.deepEqual(plain(config.workspaces.map(w => w.id)), [1, 2, 3]);
});

test('addWorkspace stops at the twelve-workspace ceiling', () => {
  let config = S.empty();
  for (let i = 0; i < 20; i++) config = S.addWorkspace(config, 0);
  assert.equal(config.workspaces.length, 12);
});

test('removeWorkspace leaves a gap rather than renumbering', () => {
  const config = S.removeWorkspace(S.normalize({ workspaces: [{ id: 1 }, { id: 2 }, { id: 3 }] }), 2);
  assert.deepEqual(plain(config.workspaces.map(w => w.id)), [1, 3]);
});

test('moveWorkspace swaps ids so the content moves and the key stays put', () => {
  let config = S.normalize({
    workspaces: [{ id: 1, name: 'A' }, { id: 2, name: 'B' }, { id: 3, name: 'C' }]
  });
  config = S.moveWorkspace(config, 3, -1);
  assert.deepEqual(plain(config.workspaces.map(w => w.name)), ['A', 'C', 'B']);
  assert.deepEqual(plain(config.workspaces.map(w => w.id)), [1, 2, 3]);
  // Moving off either end is a no-op.
  assert.deepEqual(plain(S.moveWorkspace(config, 1, -1).workspaces.map(w => w.name)), ['A', 'C', 'B']);
  assert.deepEqual(plain(S.moveWorkspace(config, 3, 1).workspaces.map(w => w.name)), ['A', 'C', 'B']);
});

// ------------------------------------------------------- chromium web apps

// Checked against three real windows: dots in the host survive, every "/"
// becomes "_", and the host/path boundary adds one more "_".
test('chromiumWebAppClass predicts the class Chromium gives a web app', () => {
  assert.equal(S.chromiumWebAppClass('https://web.whatsapp.com/', 'Profile 2'), 'chrome-web.whatsapp.com__-Profile_2');
  assert.equal(
    S.chromiumWebAppClass('https://app.slack.com/client/T681EDZRV/', 'Profile 2'),
    'chrome-app.slack.com__client_T681EDZRV_-Profile_2'
  );
  assert.equal(S.chromiumWebAppClass('https://claude.ai/', 'Profile 2'), 'chrome-claude.ai__-Profile_2');
  assert.equal(S.chromiumWebAppClass('https://example.com', ''), 'chrome-example.com__-Default');
  assert.equal(S.chromiumWebAppClass('https://example.com/x?y=1#z', 'Default'), 'chrome-example.com__x-Default');
  assert.equal(S.chromiumWebAppClass('', 'Profile 2'), '');
});

test('escapeClassRegex anchors and escapes an observed class', () => {
  assert.equal(
    S.escapeClassRegex('chrome-web.whatsapp.com__-Profile_2'),
    '^chrome-web\\.whatsapp\\.com__-Profile_2$'
  );
  assert.equal(S.escapeClassRegex(''), '');
});

// ------------------------------------------------- shipped file integrity

test('manifest.json matches what the shell and the marketplace enforce', () => {
  const manifest = readRepoJson('manifest.json');
  assert.equal(manifest.schemaVersion, 1);
  assert.equal(manifest.id, 'majinmarco.workspace-studio');
  assert.match(manifest.id, /^[a-z0-9][a-z0-9._-]*$/);
  assert.ok(manifest.id.indexOf('omarchy.') !== 0);
  assert.equal(manifest.license, 'MIT');
  assert.equal(manifest.author, 'majinmarco');
  assert.ok(manifest.description.length <= 500);
  assert.deepEqual(manifest.kinds, ['bar-widget', 'overlay']);
  assert.equal(manifest.entryPoints.barWidget, 'Workspaces.qml');
  assert.equal(manifest.entryPoints.overlay, 'Studio.qml');
  assert.equal(manifest.barWidget.defaultSection, 'left');
  assert.equal(manifest.omarchy, undefined, 'clonedFrom must not be published');
  for (const value of Object.values(manifest.entryPoints)) {
    assert.ok(value.charAt(0) !== '/' && value.indexOf('..') === -1);
  }
});

test('every schema key has a matching default, and vice versa', () => {
  const manifest = readRepoJson('manifest.json');
  const schemaKeys = manifest.barWidget.schema.map(row => row.key).sort();
  const defaultKeys = Object.keys(manifest.barWidget.defaults).sort();
  assert.deepEqual(schemaKeys, defaultKeys);
  for (const row of manifest.barWidget.schema) {
    assert.ok(row.label, 'schema row ' + row.key + ' has no label');
    assert.ok(['string', 'integer', 'boolean', 'enum', 'path'].includes(row.type));
    assert.equal(row.defaultValue, manifest.barWidget.defaults[row.key]);
    if (row.type === 'enum') {
      assert.ok(Array.isArray(row.options) && row.options.length > 1);
      assert.ok(row.options.includes(row.defaultValue));
    }
    if (row.type === 'integer') {
      assert.equal(typeof row.min, 'number');
      assert.equal(typeof row.max, 'number');
      assert.ok(row.defaultValue >= row.min && row.defaultValue <= row.max);
    }
  }
});

test('icons.json is well formed and its glyphs match their codepoints', () => {
  const icons = readRepoJson('icons.json');
  assert.equal(icons.version, 1);
  assert.ok(icons.icons.length >= 300, 'expected a curated set of at least 300 glyphs');
  const groups = new Set(icons.groups);
  const seenNames = new Set();
  const seenCodepoints = new Set();
  for (const icon of icons.icons) {
    assert.match(icon.cp, /^[0-9A-F]+$/, icon.name);
    assert.equal(icon.glyph.codePointAt(0), parseInt(icon.cp, 16), icon.name);
    assert.equal(String.fromCodePoint(parseInt(icon.cp, 16)), icon.glyph, icon.name);
    assert.ok(groups.has(icon.group), icon.name + ' has unknown group ' + icon.group);
    assert.ok(icon.keywords.length > 0, icon.name + ' has no keywords');
    assert.ok(!seenNames.has(icon.name), 'duplicate name ' + icon.name);
    assert.ok(!seenCodepoints.has(icon.cp), 'duplicate codepoint ' + icon.cp);
    seenNames.add(icon.name);
    seenCodepoints.add(icon.cp);
  }
  // The five glyphs the user's hand-written bar clone uses must be pickable,
  // so a first run can reproduce their current bar exactly.
  for (const cp of ['F00D6', 'F120', 'F048B', 'F028C', 'F0674']) {
    assert.ok(seenCodepoints.has(cp), 'icons.json is missing ' + cp);
  }
});

test('config.schema.json documents the shape defaults() produces', () => {
  const schema = readRepoJson('config.schema.json');
  const config = S.defaults();
  assert.equal(schema.type, 'object');
  for (const key of Object.keys(config)) {
    assert.ok(schema.properties[key], 'config.schema.json is missing ' + key);
  }
  const workspace = schema.properties.workspaces.items.properties;
  for (const key of Object.keys(config.workspaces[0])) {
    assert.ok(workspace[key], 'config.schema.json workspace is missing ' + key);
  }
});
