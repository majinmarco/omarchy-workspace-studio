import test from 'node:test';
import assert from 'node:assert/strict';
import { loadSandbox, plain } from './sandbox.helper.mjs';

const S = loadSandbox();

function config(overrides) {
  return S.normalize(Object.assign({ workspaces: [] }, overrides));
}

function workspacesUpTo(n) {
  const out = [];
  for (let i = 1; i <= n; i++) out.push({ id: i, name: 'W' + i });
  return out;
}

function lines(text) {
  return text.split('\n');
}

// --------------------------------------------------------------- luaQuote

test('luaQuote wraps and escapes', () => {
  assert.equal(S.luaQuote('plain'), '"plain"');
  assert.equal(S.luaQuote(''), '""');
  assert.equal(S.luaQuote(null), '""');
  assert.equal(S.luaQuote(undefined), '""');
  assert.equal(S.luaQuote('say "hi"'), '"say \\"hi\\""');
  assert.equal(S.luaQuote('a\\b'), '"a\\\\b"');
  // A regex that already contains Lua-escaped dots survives intact: the
  // backslashes are doubled so Lua hands Hyprland exactly what was typed.
  assert.equal(
    S.luaQuote('(foot|org\\.codeberg\\.dnkl\\.foot)'),
    '"(foot|org\\\\.codeberg\\\\.dnkl\\\\.foot)"'
  );
});

test('luaQuote refuses newlines and control characters', () => {
  for (const bad of ['a\nb', 'a\r\nb', '\n', 'a\u0000b', 'a\u0007b', 'a\u001bb', 'a\u007fb', 'a\u009bb']) {
    assert.throws(() => S.luaQuote(bad), /Refusing to emit/, JSON.stringify(bad));
  }
});

test('luaQuote refuses bidirectional overrides', () => {
  for (const bad of ['a\u202eb', 'a\u200eb', 'a\u2066b']) {
    assert.throws(() => S.luaQuote(bad), /bidirectional/);
  }
});

test('luaQuote refuses non-string, non-scalar values', () => {
  assert.throws(() => S.luaQuote({}), /Refusing to emit/);
  assert.throws(() => S.luaQuote([]), /Refusing to emit/);
  assert.throws(() => S.luaQuote(NaN), /non-finite/);
});

test('luaKey refuses anything that is not a bare identifier', () => {
  assert.equal(S.luaKey('layout_opts'), 'layout_opts');
  for (const bad of ['a b', 'a-b', '1a', '', 'a"] = os.execute("x") --']) {
    assert.throws(() => S.luaKey(bad), /Lua table key/);
  }
});

// ------------------------------------------------------------- injection

// Every one of these is a real attempt to break out of the string literal that
// the value lands in. The output must contain the payload only as inert data.
const INJECTIONS = [
  '" }) os.execute("touch /tmp/pwned") hl.workspace_rule({ workspace = "9',
  'x" .. os.getenv("HOME") .. "',
  'a\\" }) os.execute("id") --',
  '\\',
  '"',
  '\\"',
  '${IFS}',
  "'; rm -rf ~; '",
  '#{}',
  ']]--',
  '"]=os.exit,["'
];

test('injection payloads survive as inert Lua strings', () => {
  for (const payload of INJECTIONS) {
    const cfg = config({
      workspaces: [{
        id: 1,
        name: payload,
        monitor: payload,
        apps: [{
          label: payload,
          match: { class: payload, title: payload },
          launch: { mode: 'autostart', command: payload, delaySec: 1 },
          rules: { size: '', move: '' }
        }]
      }],
      binds: { focusMods: 'SUPER' }
    });
    const lua = S.toLua(cfg);

    // Nothing may appear at statement position other than what we emit.
    for (const line of lines(lua)) {
      const trimmed = line.trim();
      if (trimmed === '' || trimmed.startsWith('--')) continue;
      assert.match(
        trimmed,
        /^(hl\.workspace_rule\(|hl\.window_rule\(|hl\.unbind\(|o\.bind\(|o\.launch_on_start\(|o\.exec_on_start\(|[a-z_]+ = |\}\)|\{|\})/,
        'unexpected statement for payload ' + JSON.stringify(payload) + ': ' + trimmed
      );
    }
    assert.ok(lua.indexOf('os.execute') === -1 || lua.indexOf('\\"') !== -1);
    // The payload must never appear unescaped: every backslash doubled, every
    // quote escaped.
    const escaped = payload.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    assert.ok(lua.indexOf(escaped) !== -1, 'escaped payload missing: ' + JSON.stringify(payload));
  }
});

test('a newline smuggled past normalization aborts generation', () => {
  // Config.js strips control characters, so build the hostile object directly.
  const cfg = S.normalize({ workspaces: [{ id: 1 }] });
  cfg.workspaces[0].name = 'evil"})\nos.execute("touch /tmp/pwned")\nhl.workspace_rule({workspace="1';
  assert.throws(() => S.toLua(cfg), /Refusing to emit a newline/);
});

test('a code:NN keysym is refused structurally, not merely normalized away', () => {
  const cfg = S.normalize({ workspaces: [{ id: 1 }] });
  cfg.binds.keysyms[0] = 'code:10';
  const lua = S.toLua(cfg);
  // keysymFor rejects it, so workspace 1 gets no bind at all rather than a
  // broken one; and the only "code:" text is inside an hl.unbind.
  assert.equal(lua.indexOf('o.bind("SUPER + code:'), -1);
  for (const line of lines(lua)) {
    if (line.indexOf('code:') !== -1) assert.match(line.trim(), /^(hl\.unbind\(|--)/);
  }
});

// ------------------------------------------------------------------ binds

test('binds are emitted for every workspace, keysyms only, when N < 10', () => {
  const lua = S.toLua(config({ workspaces: workspacesUpTo(5) }));
  for (let i = 1; i <= 5; i++) {
    assert.ok(lua.includes(`o.bind("SUPER + ${i}", "Switch to workspace ${i}", hl.dsp.focus({ workspace = "${i}" }))`));
    assert.ok(lua.includes(`o.bind("SUPER + SHIFT + ${i}", "Move window to workspace ${i}", hl.dsp.window.move({ workspace = "${i}" }))`));
    assert.ok(lua.includes(`o.bind("SUPER + SHIFT + ALT + ${i}", "Move window silently to workspace ${i}", hl.dsp.window.move({ workspace = "${i}", follow = false }))`));
  }
  // No bind may ever be declared by keycode.
  for (const line of lines(lua)) {
    if (line.startsWith('o.bind(')) assert.ok(line.indexOf('code:') === -1, line);
  }
});

test('workspace 10 binds to keysym 0, not to "10" and not to code:19', () => {
  const lua = S.toLua(config({ workspaces: workspacesUpTo(10) }));
  assert.ok(lua.includes('o.bind("SUPER + 0", "Switch to workspace 10", hl.dsp.focus({ workspace = "10" }))'));
  assert.ok(lua.includes('o.bind("SUPER + SHIFT + 0", "Move window to workspace 10"'));
  assert.equal(lua.indexOf('o.bind("SUPER + 10"'), -1);
  // Both spellings are unbound before rebinding, on every workspace.
  for (let i = 1; i <= 10; i++) {
    assert.ok(lua.includes(`hl.unbind("SUPER + code:${i + 9}")`), 'missing code unbind for ' + i);
  }
  assert.ok(lua.includes('hl.unbind("SUPER + 0")'));
});

test('workspaces 11 and 12 use minus and equal', () => {
  const lua = S.toLua(config({ workspaces: workspacesUpTo(12) }));
  assert.ok(lua.includes('o.bind("SUPER + minus", "Switch to workspace 11"'));
  assert.ok(lua.includes('o.bind("SUPER + equal", "Switch to workspace 12"'));
});

test('removed workspaces have their stock binds unbound and not rebound', () => {
  const lua = S.toLua(config({ workspaces: [{ id: 1 }, { id: 2 }, { id: 5 }] }));
  assert.ok(lua.includes("Workspaces this config does not define"));
  for (const gone of [[3, '3'], [4, '4'], [6, '6'], [7, '7'], [8, '8'], [9, '9'], [10, '0']]) {
    const [id, sym] = gone;
    assert.ok(lua.includes(`hl.unbind("SUPER + ${sym}")`), 'no keysym unbind for ws ' + id);
    assert.ok(lua.includes(`hl.unbind("SUPER + code:${id + 9}")`), 'no keycode unbind for ws ' + id);
    assert.ok(lua.includes(`hl.unbind("SUPER + SHIFT + ${sym}")`));
    assert.ok(lua.includes(`hl.unbind("SUPER + SHIFT + ALT + ${sym}")`));
    assert.equal(lua.indexOf(`o.bind("SUPER + ${sym}"`), -1, 'ws ' + id + ' was rebound');
  }
  for (const kept of ['1', '2', '5']) {
    assert.ok(lua.includes(`o.bind("SUPER + ${kept}", "Switch to workspace ${kept}"`));
  }
});

test('unbindUnused false leaves the stock binds alone', () => {
  const lua = S.toLua(config({ workspaces: [{ id: 1 }], binds: { unbindUnused: false } }));
  assert.equal(lua.indexOf('Workspaces this config does not define'), -1);
  assert.equal(lua.indexOf('hl.unbind("SUPER + 7")'), -1);
});

test('binds.enabled false emits no bind section at all', () => {
  const lua = S.toLua(config({ workspaces: workspacesUpTo(3), binds: { enabled: false } }));
  assert.equal(lua.indexOf('o.bind('), -1);
  assert.equal(lua.indexOf('hl.unbind('), -1);
});

test('custom modifiers are honoured and validated', () => {
  const lua = S.toLua(config({ workspaces: [{ id: 1 }], binds: { focusMods: 'super + ctrl' } }));
  assert.ok(lua.includes('o.bind("SUPER + CTRL + 1", "Switch to workspace 1"'));
  // Junk modifiers fall back rather than being emitted.
  const fallback = S.toLua(config({ workspaces: [{ id: 1 }], binds: { focusMods: 'SUPER + "); os.exit(' } }));
  assert.ok(fallback.includes('o.bind("SUPER + 1"'));
});

// ---------------------------------------------------------- launch modes

test('launch mode "none" emits a window rule and nothing else', () => {
  const lua = S.toLua(config({
    workspaces: [{ id: 1, apps: [{ match: { class: '^chromium$' }, launch: { mode: 'none', command: 'chromium' } }] }]
  }));
  assert.ok(lua.includes('hl.window_rule({ name = "wsstudio:ws1:1", match = { class = "^chromium$" }, workspace = "1" })'));
  assert.equal(lua.indexOf('on_created_empty'), -1);
  assert.equal(lua.indexOf('o.launch_on_start'), -1);
  assert.equal(lua.indexOf('o.exec_on_start'), -1);
});

test('launch mode "onCreatedEmpty" becomes a workspace rule field', () => {
  const lua = S.toLua(config({
    workspaces: [{ id: 2, apps: [{ match: { class: '^foot$' }, launch: { mode: 'onCreatedEmpty', command: 'foot' } }] }]
  }));
  assert.ok(lua.includes('on_created_empty = o.launch("foot")'));
  assert.equal(lua.indexOf('o.exec_on_start'), -1);
});

test('several onCreatedEmpty apps chain into one command', () => {
  const lua = S.toLua(config({
    workspaces: [{
      id: 4,
      apps: [
        { match: { class: 'a' }, launch: { mode: 'onCreatedEmpty', command: 'slack' } },
        { match: { class: 'b' }, launch: { mode: 'onCreatedEmpty', command: 'whatsapp' } }
      ]
    }]
  }));
  assert.ok(lua.includes('on_created_empty = o.launch("slack") .. " & " .. o.launch("whatsapp")'));
});

test('launch mode "autostart" emits exec-once with and without a delay', () => {
  const lua = S.toLua(config({
    workspaces: [{
      id: 1,
      apps: [
        { match: { class: 'a' }, launch: { mode: 'autostart', command: 'foot', delaySec: 0 } },
        { match: { class: 'b' }, launch: { mode: 'autostart', command: 'chromium', delaySec: 4 } }
      ]
    }],
    apply: { landOn: 1 }
  }));
  assert.ok(lua.includes('o.launch_on_start("foot")'));
  assert.ok(lua.includes('o.exec_on_start("sleep 4 && " .. o.launch("chromium"))'));
  // The land-on dispatch waits for the longest delay plus a settle margin.
  assert.ok(lua.includes('o.exec_on_start("sleep 6 && hyprctl dispatch workspace 1")'));
  // Verified on Hyprland 0.56.2: hyprland.start does not refire on reload,
  // so the generator carries no re-entry guard and says so.
  assert.ok(lua.includes('does not refire'));
});

test('landOn is not emitted when nothing autostarts', () => {
  const lua = S.toLua(config({
    workspaces: [{ id: 1, apps: [{ match: { class: 'a' }, launch: { mode: 'onCreatedEmpty', command: 'foot' } }] }],
    apply: { landOn: 1 }
  }));
  assert.equal(lua.indexOf('hyprctl dispatch workspace'), -1);
});

test('a shared launcher prefix expands into the emitted command', () => {
  const lua = S.toLua(config({
    launchers: { 'chromium-p2': { label: 'Chromium (Profile 2)', command: "chromium --profile-directory='Profile 2'" } },
    workspaces: [{
      id: 5,
      apps: [{
        match: { class: 'chrome-claude_ai_-Profile_2' },
        launch: { mode: 'autostart', launcher: 'chromium-p2', args: '--app=https://claude.ai/', delaySec: 7 }
      }]
    }]
  }));
  assert.ok(lua.includes(
    'o.exec_on_start("sleep 7 && " .. o.launch("chromium --profile-directory=\'Profile 2\' --app=https://claude.ai/"))'
  ));
});

// ---------------------------------------------------------- window rules

test('window rules carry every match property and the workspace target', () => {
  const lua = S.toLua(config({
    workspaces: [{
      id: 3,
      monitor: 'eDP-1',
      apps: [{
        match: { class: '^c$', title: '^t$', initialClass: '^ic$', initialTitle: '^it$' },
        rules: { float: true, size: '800 600', move: '100 100', silent: true }
      }]
    }]
  }));
  assert.ok(lua.includes('match = {') || lua.includes('match = { class'));
  assert.ok(lua.includes('class = "^c$"'));
  assert.ok(lua.includes('title = "^t$"'));
  assert.ok(lua.includes('initial_class = "^ic$"'));
  assert.ok(lua.includes('initial_title = "^it$"'));
  assert.ok(lua.includes('workspace = "3 silent"'));
  assert.ok(lua.includes('float = true'));
  assert.ok(lua.includes('size = "800 600"'));
  assert.ok(lua.includes('move = "100 100"'));
  assert.ok(lua.includes('monitor = "eDP-1"'));
});

test('float false emits tile true', () => {
  const lua = S.toLua(config({
    workspaces: [{ id: 1, apps: [{ match: { class: 'a' }, rules: { float: false } }] }]
  }));
  assert.ok(lua.includes('tile = true'));
  assert.equal(lua.indexOf('float ='), -1);
});

test('an app with no match emits no window rule', () => {
  const lua = S.toLua(config({
    workspaces: [{ id: 1, apps: [{ launch: { mode: 'autostart', command: 'foot' } }] }]
  }));
  assert.equal(lua.indexOf('hl.window_rule'), -1);
  assert.ok(lua.includes('o.launch_on_start("foot")'));
});

test('window rules are named per workspace and app index, deterministically', () => {
  const cfg = config({
    workspaces: [
      { id: 2, apps: [{ match: { class: 'b' } }] },
      { id: 1, apps: [{ match: { class: 'a1' } }, { match: { class: 'a2' } }] }
    ]
  });
  const lua = S.toLua(cfg);
  assert.ok(lua.indexOf('wsstudio:ws1:1') < lua.indexOf('wsstudio:ws1:2'));
  assert.ok(lua.indexOf('wsstudio:ws1:2') < lua.indexOf('wsstudio:ws2:1'));
  assert.equal(S.toLua(cfg), lua, 'generation must be deterministic');
});

// ------------------------------------------------------- workspace rules

test('a workspace with nothing configured emits no workspace rule', () => {
  const lua = S.toLua(config({ workspaces: [{ id: 1 }, { id: 2 }] }));
  assert.equal(lua.indexOf('hl.workspace_rule'), -1);
});

test('workspace rule fields map onto the verified Hyprland names', () => {
  const lua = S.toLua(config({
    workspaces: [{
      id: 7,
      name: 'Code',
      monitor: 'HDMI-A-1',
      persistent: true,
      default: true,
      layout: 'master',
      layoutOpts: { orientation: 'center' },
      advanced: { gapsIn: 4, gapsOut: 8, borderSize: 2, decorate: true, noRounding: true, noBorder: false, noShadow: true }
    }]
  }));
  assert.ok(lua.includes('workspace = "7"'));
  assert.ok(lua.includes('default_name = "Code"'));
  assert.ok(lua.includes('monitor = "HDMI-A-1"'));
  assert.ok(lua.includes('persistent = true'));
  assert.ok(lua.includes('default = true'));
  assert.ok(lua.includes('layout = "master"'));
  assert.ok(lua.includes('layout_opts = { orientation = "center" }'));
  assert.ok(lua.includes('gaps_in = 4'));
  assert.ok(lua.includes('gaps_out = 8'));
  assert.ok(lua.includes('border_size = 2'));
  assert.ok(lua.includes('decorate = true'));
  assert.ok(lua.includes('no_rounding = true'));
  assert.ok(lua.includes('no_border = false'));
  assert.ok(lua.includes('no_shadow = true'));
  // `is_default`, `name` and `animation_style` are NOT workspace-rule fields.
  assert.equal(lua.indexOf('is_default'), -1);
  assert.equal(lua.indexOf('animation_style'), -1);
});

test('layout options are dropped when no layout is chosen', () => {
  const lua = S.toLua(config({ workspaces: [{ id: 1, name: 'x', layoutOpts: { orientation: 'center' } }] }));
  assert.equal(lua.indexOf('layout_opts'), -1);
});

// ------------------------------------------------------------------ diff

test('diffLines marks additions, removals and context', () => {
  const diff = S.diffLines('a\nb\nc\n', 'a\nB\nc\n');
  const rendered = diff.map(row => row.type + row.text).join('|');
  assert.ok(rendered.includes('-b'));
  assert.ok(rendered.includes('+B'));
  assert.ok(rendered.includes(' a'));
  const stats = S.diffStats(diff);
  assert.equal(stats.added, 1);
  assert.equal(stats.removed, 1);
  assert.equal(stats.changed, true);
});

test('diffLines against an identical file reports no change', () => {
  const lua = S.toLua(config({ workspaces: workspacesUpTo(3) }));
  assert.equal(S.diffStats(S.diffLines(lua, lua)).changed, false);
});

test('diffLines handles an empty before-file (first apply)', () => {
  const lua = S.toLua(config({ workspaces: [{ id: 1, name: 'x' }] }));
  const stats = S.diffStats(S.diffLines('', lua));
  assert.equal(stats.removed, 0);
  assert.ok(stats.added > 0);
});

// -------------------------------------------------- command precedence

function appConfig(app, extra) {
  return S.normalize(Object.assign({
    workspaces: [{ id: 1, name: 'w', apps: [app] }]
  }, extra || {}));
}

test('commandFor puts a typed command first, then a launcher, then a picked entry', () => {
  const launchers = { chromium: { command: 'chromium --profile-directory=X' } };

  const all = appConfig({
    match: { class: 'x' },
    desktop: { id: 'Slack' },
    launch: { mode: 'onCreatedEmpty', launcher: 'chromium', args: '--app=y', command: 'foot' }
  }, { launchers: launchers });
  assert.equal(S.commandFor(all, all.workspaces[0].apps[0]), 'foot');

  const withLauncher = appConfig({
    match: { class: 'x' },
    desktop: { id: 'Slack' },
    launch: { mode: 'onCreatedEmpty', launcher: 'chromium', args: '--app=y' }
  }, { launchers: launchers });
  assert.equal(S.commandFor(withLauncher, withLauncher.workspaces[0].apps[0]), 'chromium --profile-directory=X --app=y');

  const picked = appConfig({
    match: { class: 'x' },
    desktop: { id: 'Slack' },
    launch: { mode: 'onCreatedEmpty' }
  });
  assert.equal(S.commandFor(picked, picked.workspaces[0].apps[0]), "gtk-launch 'Slack.desktop'");

  const nothing = appConfig({ match: { class: 'x' } });
  assert.equal(S.commandFor(nothing, nothing.workspaces[0].apps[0]), '');
});

// If these two ever disagree, validate() and the generator disagree about
// whether an app has a command, and Apply silently does nothing.
test('commandFor and Config.resolveCommand agree on every combination', () => {
  const launchers = { l: { command: 'prefix' } };
  for (const command of ['', 'foot']) {
    for (const launcher of ['', 'l', 'missing']) {
      for (const id of ['', 'Slack']) {
        const config = appConfig({
          match: { class: 'x' },
          desktop: id ? { id: id } : undefined,
          launch: { mode: 'onCreatedEmpty', launcher: launcher, args: 'a', command: command }
        }, { launchers: launchers });
        const app = config.workspaces[0].apps[0];
        assert.equal(S.commandFor(config, app), S.resolveCommand(config, app),
          JSON.stringify({ command, launcher, id }));
      }
    }
  }
});

test('a desktop id containing a space is quoted for the shell inside the Lua string', () => {
  const lua = S.toLua(appConfig({
    match: { class: 'x' },
    desktop: { id: 'Google Maps' },
    launch: { mode: 'onCreatedEmpty' }
  }));
  assert.ok(lua.includes(`o.launch("gtk-launch 'Google Maps.desktop'")`), lua);
});

test('an id that survived normalization can still not break out of the quoting', () => {
  // Config refuses these outright; the generator refuses them again on the way
  // out, because a second independent boundary is the whole point.
  for (const id of ["a'b", 'a\nb', 'a b', 'a/b']) {
    assert.equal(S.commandFor({}, { launch: { mode: 'onCreatedEmpty' }, desktop: { id: id } }), '');
  }
});

// ---------------------------------------------------- arrangement -> Lua

function arranged(mode, root, extra) {
  return S.normalize(Object.assign({
    workspaces: [{
      id: 1,
      name: 'w',
      apps: [
        { label: 'a', match: { class: '^a$' } },
        { label: 'b', match: { class: '^b$' } }
      ],
      arrangement: { mode: mode, root: root }
    }]
  }, extra || {}));
}

const TWO_UP = { dir: 'h', ratio: 0.6, kids: [{ app: 0 }, { app: 1 }] };

test('tiled mode emits layout and layout_opts, and no geometry', () => {
  const lua = S.toLua(arranged('tiled', TWO_UP));
  assert.ok(lua.includes('layout = "master"'), lua);
  assert.ok(/layout_opts = \{ mfact = 0\.6, orientation = "left" \}/.test(lua), lua);
  assert.equal(lua.indexOf('float = true'), -1);
  assert.equal(lua.indexOf('size ='), -1);
  assert.equal(lua.indexOf('move ='), -1);
});

test('float mode emits percentages on the window rules, and no layout', () => {
  const lua = S.toLua(arranged('float', TWO_UP));
  assert.ok(lua.includes('float = true'), lua);
  assert.ok(lua.includes('size = "60% 100%"'), lua);
  assert.ok(lua.includes('move = "0% 0%"'), lua);
  assert.ok(lua.includes('size = "40% 100%"'), lua);
  assert.ok(lua.includes('move = "60% 0%"'), lua);
  assert.equal(lua.indexOf('layout ='), -1);
});

test('float mode leaves room for the bar when the workspace asks for it', () => {
  const config = S.normalize({
    workspaces: [{
      id: 1, name: 'w',
      apps: [{ label: 'a', match: { class: '^a$' } }],
      arrangement: { mode: 'float', root: { app: 0 }, topReservePct: 4 }
    }]
  });
  const lua = S.toLua(config);
  assert.ok(lua.includes('size = "100% 96%"'), lua);
  assert.ok(lua.includes('move = "0% 4%"'), lua);
});

test('an explicit workspace layout beats the tree-derived one', () => {
  const lua = S.toLua(S.normalize({
    workspaces: [{
      id: 1, name: 'w', layout: 'dwindle',
      apps: [{ label: 'a', match: { class: '^a$' } }, { label: 'b', match: { class: '^b$' } }],
      arrangement: { mode: 'tiled', root: TWO_UP }
    }]
  }));
  assert.ok(lua.includes('layout = "dwindle"'), lua);
  assert.equal(lua.indexOf('master'), -1);
});

test('an explicit app size beats the tree-derived rectangle', () => {
  const lua = S.toLua(S.normalize({
    workspaces: [{
      id: 1, name: 'w',
      apps: [
        { label: 'a', match: { class: '^a$' }, rules: { size: '800 600' } },
        { label: 'b', match: { class: '^b$' } }
      ],
      arrangement: { mode: 'float', root: TWO_UP }
    }]
  }));
  assert.ok(lua.includes('size = "800 600"'), lua);
  assert.equal(lua.indexOf('size = "60% 100%"'), -1);
  // The other app still gets its rectangle.
  assert.ok(lua.includes('size = "40% 100%"'), lua);
});

test('an app explicitly tiled is never floated by the canvas', () => {
  const lua = S.toLua(S.normalize({
    workspaces: [{
      id: 1, name: 'w',
      apps: [{ label: 'a', match: { class: '^a$' }, rules: { float: false } }],
      arrangement: { mode: 'float', root: { app: 0 } }
    }]
  }));
  assert.ok(lua.includes('tile = true'), lua);
  assert.equal(lua.indexOf('float = true'), -1);
  assert.equal(lua.indexOf('%"'), -1);
});

test('mode "none" generates exactly what v0.1 generated', () => {
  const before = S.toLua(S.normalize({
    workspaces: [{ id: 1, name: 'w', apps: [{ label: 'a', match: { class: '^a$' } }] }]
  }));
  const after = S.toLua(S.normalize({
    workspaces: [{
      id: 1, name: 'w', apps: [{ label: 'a', match: { class: '^a$' } }],
      arrangement: { mode: 'none', root: { app: 0 } }
    }]
  }));
  assert.equal(after, before);
});

// Hyprland accepts a bogus layout name and a bogus layout_opts key without a
// word of complaint and then does nothing, so the generator has to catch them.
test('a layout name outside the whitelist is refused', () => {
  const lua = S.toLua(S.normalize({ workspaces: [{ id: 1, name: 'w', layout: 'bogus' }] }));
  assert.equal(lua.indexOf('bogus'), -1);
  assert.equal(lua.indexOf('layout ='), -1);
});

test('a layout_opts key outside the whitelist is refused', () => {
  const lua = S.toLua(S.normalize({
    workspaces: [{ id: 1, name: 'w', layout: 'master', layoutOpts: { mfact: 0.7, bogus_opt: 1, drop_at_cursor: true } }]
  }));
  assert.ok(lua.includes('mfact = 0.7'), lua);
  assert.equal(lua.indexOf('bogus_opt'), -1);
  assert.equal(lua.indexOf('drop_at_cursor'), -1);
});

test('an orientation Hyprland does not have is refused', () => {
  const lua = S.toLua(S.normalize({
    workspaces: [{ id: 1, name: 'w', layout: 'master', layoutOpts: { orientation: 'diagonal' } }]
  }));
  assert.equal(lua.indexOf('diagonal'), -1);
  for (const good of ['left', 'right', 'top', 'bottom', 'center']) {
    const ok = S.toLua(S.normalize({
      workspaces: [{ id: 1, name: 'w', layout: 'master', layoutOpts: { orientation: good } }]
    }));
    assert.ok(ok.includes('orientation = "' + good + '"'), good);
  }
});

test('an arrangement generates the same bytes every time', () => {
  const config = arranged('float', TWO_UP);
  assert.equal(S.toLua(config), S.toLua(config));
  assert.equal(S.toLua(S.normalize(config)), S.toLua(config));
});

test('injection payloads stay inert with a desktop entry and an arrangement present', () => {
  for (const payload of INJECTIONS) {
    const cfg = S.normalize({
      workspaces: [{
        id: 1,
        name: payload,
        apps: [{
          label: payload,
          match: { class: payload },
          desktop: { id: payload, name: payload, icon: payload },
          launch: { mode: 'onCreatedEmpty' }
        }],
        arrangement: { mode: 'float', root: { app: 0 } }
      }]
    });
    const lua = S.toLua(cfg);
    for (const line of lua.split('\n')) {
      const trimmed = line.trim();
      if (trimmed === '' || trimmed.indexOf('--') === 0) continue;
      assert.match(trimmed, /^(hl\.|o\.|\}|[a-z_]+ = |"|\{)/, trimmed);
    }
    // The payload text itself does appear — as inert data inside a quoted
    // string literal, with every quote and backslash escaped. What must never
    // happen is it reaching statement position, and that is exactly what the
    // line-shape check above rules out.
  }
});
