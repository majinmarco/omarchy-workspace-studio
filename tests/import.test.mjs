import test from 'node:test';
import assert from 'node:assert/strict';
import { loadSandbox, plain } from './sandbox.helper.mjs';

const S = loadSandbox();

// The three fixtures below are the shape of a real hand-written Omarchy
// workspace layout, verbatim from the machine this plugin was written on.

const HYPRLAND_LUA = `
-- ─── Workspace layout ───────────────────────────────────────────
-- Classes are matched in full.
o.window("chromium", { workspace = "1" })                                              -- browser
o.window("(foot|org\\\\.codeberg\\\\.dnkl\\\\.foot)", { workspace = "2" })                   -- terminal
o.window("chrome-dlijmjnakehgcjngafdkneaigmfcdmhf-Profile_2", { workspace = "3" })     -- Amazon WorkSpaces
o.window("chrome-app\\\\.slack\\\\.com__client_T681EDZRV_-Profile_2", { workspace = "4" }) -- Slack
o.window("chrome-web\\\\.whatsapp\\\\.com__-Profile_2", { workspace = "4" })               -- WhatsApp
o.window("chrome-claude\\\\.ai__-Profile_2", { workspace = "5" })                        -- Claude
-- o.window("commented", { workspace = "9" })
`;

const AUTOSTART_LUA = `
local chromium = "chromium --profile-directory='Profile 2'"

o.launch_on_start("foot")                                                         -- ws 2
o.launch_on_start(chromium)                                                       -- ws 1
o.exec_on_start("sleep 4 && " .. o.launch(chromium .. " --app-id=dlijmjnakehgcjngafdkneaigmfcdmhf"))     -- ws 3
o.exec_on_start("sleep 5 && " .. o.launch(chromium .. " --app=https://app.slack.com/client/T681EDZRV/")) -- ws 4 Slack
o.exec_on_start("sleep 6 && " .. o.launch(chromium .. " --app=https://web.whatsapp.com/"))               -- ws 4 WhatsApp
o.exec_on_start("sleep 7 && " .. o.launch(chromium .. " --app=https://claude.ai/"))                      -- ws 5 Claude
o.exec_on_start("sleep 9 && hyprctl dispatch workspace 1")                                               -- land on ws 1
`;

const BAR_CLONE_QML = `
  readonly property var icons: ({
    1: "\\uDB80\\uDCD6",         // nf-md-briefcase
    2: "\\uf120",               // nf-fa-terminal
    3: "\\uDB81\\uDC8B",         // nf-md-server
    4: "\\uDB80\\uDE8C",         // nf-md-forum
    5: "\\uDB81\\uDE74"          // nf-md-creation
  })
`;

function scanAll(launchMode) {
  return S.buildConfig({
    windowRules: S.scanWindowRules(HYPRLAND_LUA),
    autostart: S.scanAutostart(AUTOSTART_LUA),
    icons: S.scanBarIcons(BAR_CLONE_QML),
    launchMode: launchMode
  });
}

// -------------------------------------------------------------- scanning

test('scanWindowRules finds every pinned class and skips comments', () => {
  const rules = S.scanWindowRules(HYPRLAND_LUA);
  assert.equal(rules.length, 6);
  assert.deepEqual(plain(rules.map(r => r.id)), [1, 2, 3, 4, 4, 5]);
  assert.equal(rules[1].match.class, '(foot|org\\.codeberg\\.dnkl\\.foot)');
  assert.equal(rules[3].comment, 'Slack');
  assert.ok(rules.every(r => r.lineNumber > 0));
  assert.ok(rules.every(r => r.id !== 9), 'a commented-out rule was imported');
});

test('scanWindowRules understands the raw hl.window_rule form too', () => {
  const rules = S.scanWindowRules(
    'hl.window_rule({ match = { initial_class = "^foo$", title = "^bar$" }, workspace = "3 silent" })'
  );
  assert.equal(rules.length, 1);
  assert.equal(rules[0].id, 3);
  assert.equal(rules[0].silent, true);
  assert.equal(rules[0].match.initialClass, '^foo$');
  assert.equal(rules[0].match.title, '^bar$');
});

test('scanAutostart resolves local variables, o.launch and sleep ladders', () => {
  const launches = S.scanAutostart(AUTOSTART_LUA);
  assert.equal(launches.length, 7);
  assert.equal(launches[0].command, 'foot');
  assert.equal(launches[0].delaySec, 0);
  assert.equal(launches[1].command, "chromium --profile-directory='Profile 2'");
  assert.equal(launches[2].delaySec, 4);
  assert.equal(
    launches[2].command,
    "chromium --profile-directory='Profile 2' --app-id=dlijmjnakehgcjngafdkneaigmfcdmhf"
  );
  assert.ok(launches.every(l => l.parsed));
});

test('a "--" inside a command is not mistaken for a Lua comment', () => {
  const launches = S.scanAutostart(AUTOSTART_LUA);
  assert.equal(launches[2].comment, 'ws 3');
  assert.equal(launches[4].comment, 'ws 4 WhatsApp');
});

test('the final workspace dispatch is recognised as landOn, not as an app', () => {
  const launches = S.scanAutostart(AUTOSTART_LUA);
  assert.equal(launches[6].landOn, 1);
});

test('scanBarIcons decodes the clone\'s surrogate-pair escapes', () => {
  const icons = S.scanBarIcons(BAR_CLONE_QML);
  assert.equal(icons[1].codePointAt(0), 0xf00d6);
  assert.equal(icons[2].codePointAt(0), 0xf120);
  assert.equal(icons[3].codePointAt(0), 0xf048b);
  assert.equal(icons[4].codePointAt(0), 0xf028c);
  assert.equal(icons[5].codePointAt(0), 0xf0674);
});

// ------------------------------------------------------------ assembling

test('the whole hand-written layout imports into one coherent config', () => {
  const { config, unmatchedLaunches } = scanAll('autostart');
  assert.equal(unmatchedLaunches.length, 0, 'every launch found its window rule');
  assert.deepEqual(plain(config.workspaces.map(w => w.id)), [1, 2, 3, 4, 5]);
  assert.deepEqual(plain(config.workspaces.map(w => w.apps.length)), [1, 1, 1, 2, 1]);
  assert.equal(config.apply.landOn, 1);

  const slack = config.workspaces[3].apps[0];
  assert.equal(slack.label, 'Slack');
  assert.equal(slack.launch.mode, 'autostart');
  assert.equal(slack.launch.delaySec, 5);
  assert.ok(slack.launch.command.includes('--app=https://app.slack.com/'));
  assert.equal(config.workspaces[3].icon.codePointAt(0), 0xf028c);
});

test('the recommended import turns the exec-once ladder into first-visit launches', () => {
  const { config } = scanAll('onCreatedEmpty');
  for (const workspace of config.workspaces) {
    for (const app of workspace.apps) {
      assert.equal(app.launch.mode, 'onCreatedEmpty');
      assert.equal(app.launch.delaySec, 0, 'first-visit launches need no sleep ladder');
    }
  }
  // Landing on a workspace only makes sense for a login-time restore.
  assert.equal(config.apply.landOn, 0);
});

test('importing with launches off keeps the window rules only', () => {
  const { config } = scanAll('none');
  for (const workspace of config.workspaces) {
    for (const app of workspace.apps) {
      assert.equal(app.launch.mode, 'none');
      assert.ok(app.match.class);
    }
  }
});

test('the imported config validates and generates parseable Lua', () => {
  const { config } = scanAll('onCreatedEmpty');
  const result = S.validate(config);
  assert.equal(result.ok, true, JSON.stringify(plain(result.errors)));
  const lua = S.toLua(config);
  assert.ok(lua.includes('on_created_empty = o.launch("foot")'));
  assert.ok(lua.includes('class = "chrome-web\\\\.whatsapp\\\\.com__-Profile_2"'));
  assert.ok(lua.includes('o.bind("SUPER + 5", "Switch to workspace 5"'));
});

test('an unrecognised launch is reported rather than silently attached', () => {
  const { unmatchedLaunches } = S.buildConfig({
    windowRules: S.scanWindowRules('o.window("foo", { workspace = "1" })'),
    autostart: S.scanAutostart('o.launch_on_start("something-else")'),
    launchMode: 'autostart'
  });
  assert.equal(unmatchedLaunches.length, 1);
  assert.equal(unmatchedLaunches[0].command, 'something-else');
});

test('predictedClass reproduces the classes Chromium actually assigns', () => {
  assert.equal(
    S.predictedClass("chromium --profile-directory='Profile 2' --app=https://web.whatsapp.com/"),
    'chrome-web.whatsapp.com__-Profile_2'
  );
  assert.equal(
    S.predictedClass("chromium --profile-directory='Profile 2' --app-id=dlijmjnakehgcjngafdkneaigmfcdmhf"),
    'chrome-dlijmjnakehgcjngafdkneaigmfcdmhf-Profile_2'
  );
  assert.equal(S.predictedClass('/usr/bin/foot --title x'), 'foot');
});

// ---------------------------------------------------------------- report

test('removalReport lists the exact lines and never claims to edit them', () => {
  const report = S.removalReport({
    windowRules: S.scanWindowRules(HYPRLAND_LUA),
    autostart: S.scanAutostart(AUTOSTART_LUA)
  });
  assert.ok(report.includes('~/.config/hypr/hyprland.lua'));
  assert.ok(report.includes('~/.config/hypr/autostart.lua'));
  assert.ok(report.includes('o.window("chromium", { workspace = "1" })'));
  assert.ok(report.includes('Comment out or delete these lines'));
  assert.ok(/\n\s+\d+:\s/.test(report), 'line numbers are shown');
});

test('removalReport is empty when there is nothing to remove', () => {
  assert.equal(S.removalReport({ windowRules: [], autostart: [] }), '');
  assert.equal(S.removalReport({}), '');
});
