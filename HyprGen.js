// Workspace Studio — Hyprland Lua generator.
//
// Pure JavaScript, no QML globals and no Node globals: the QML editor imports
// it (`import "HyprGen.js" as HyprGen`) and `node --test` loads the identical
// file through `node:vm`.
//
// SECURITY: the output of toLua() is executed by Hyprland as Lua source. Every
// value that originates from the user — names, icons, monitor names, window
// classes, regexes, shell commands — MUST go through luaQuote() on the way in.
// luaQuote escapes backslash and double quote and refuses control characters
// and newlines outright, so no input can close the string literal and start
// emitting statements. There is no code path in this file that interpolates an
// untrusted value into the output without it; adding one is a security bug.

var GENERATOR_NAME = "workspace-studio";
var GENERATOR_VERSION = "0.2.1";

var GENERATED_PATH = "~/.local/state/omarchy/toggles/hypr/zz-workspace-studio.lua";
var CONFIG_PATH = "~/.config/omarchy/workspace-studio.json";

// Omarchy's stock bindings declare ten workspaces. Anything we do not claim has
// to be unbound explicitly or the default stays live for a workspace the user
// has deleted.
var STOCK_WORKSPACE_COUNT = 10;
var STOCK_KEYSYMS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0", "minus", "equal"];

var WRAP_COLUMN = 100;

// Hyprland accepts `layout = "bogus"` and `layout_opts = { bogus_opt = 1 }`
// without a word of complaint — layout_opts is a bare string map — and then
// does nothing. A typo would otherwise be a silent no-op with no error
// anywhere, so the generator refuses what the compositor will not.
var EMITTABLE_LAYOUTS = ["dwindle", "master", "scrolling"];
var LAYOUT_OPT_KEYS = [
  "orientation", "mfact", "force_split", "default_split_ratio",
  "split_bias", "slave_count_for_center_master", "column_width"
];
var MASTER_ORIENTATIONS = ["left", "right", "top", "bottom", "center"];

// The slicing-tree maths lives in Layout.js. QML gives each .js resource its
// own scope, so it is handed over explicitly (Studio.qml, Component.onCompleted).
// With no module injected the generator emits nothing for an arrangement, which
// is byte-identical to v0.1 — the safe direction to fail in.
//
// Named apart from Config.useLayout because node:vm runs both scripts in one
// shared scope and the later definition would otherwise shadow the earlier.
var layoutModule = null;

function useLayoutModule(module) {
  layoutModule = module || null;
}

// -------------------------------------------------------------- quoting

function LuaQuoteError(message) {
  this.name = "LuaQuoteError";
  this.message = message;
}
LuaQuoteError.prototype = new Error();

// The one and only way a user-supplied string may enter generated Lua.
//
// Rejects (rather than strips) anything that could terminate a line or smuggle
// a terminal escape, because a rejection surfaces in the editor as a validation
// error the user can fix, whereas silent stripping would quietly change what
// their window rule matches.
function luaQuote(value) {
  if (value === undefined || value === null) return '""';
  if (typeof value === "number") {
    if (!isFinite(value)) throw new LuaQuoteError("Refusing to emit a non-finite number.");
    return '"' + String(value) + '"';
  }
  if (value === true || value === false) return '"' + String(value) + '"';
  if (typeof value !== "string") {
    throw new LuaQuoteError("Refusing to emit a " + typeof value + " as a Lua string.");
  }

  for (var i = 0; i < value.length; i++) {
    var code = value.charCodeAt(i);
    if (code === 0x0a || code === 0x0d) {
      throw new LuaQuoteError("Refusing to emit a newline inside generated Lua.");
    }
    if (code < 0x20 || code === 0x7f || (code >= 0x80 && code <= 0x9f)) {
      throw new LuaQuoteError("Refusing to emit control character U+" +
        ("000" + code.toString(16).toUpperCase()).slice(-4) + " inside generated Lua.");
    }
    // Bidi overrides render as one thing and mean another; never in code we write.
    if (code === 0x200e || code === 0x200f || (code >= 0x202a && code <= 0x202e) ||
        (code >= 0x2066 && code <= 0x2069)) {
      throw new LuaQuoteError("Refusing to emit a bidirectional control character inside generated Lua.");
    }
  }

  return '"' + value.replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"';
}

// Numbers and booleans are emitted bare, never quoted, and never derived from
// a string the user typed without passing through parseInt first.
function luaNumber(value) {
  var n = Number(value);
  if (!isFinite(n)) throw new LuaQuoteError("Refusing to emit a non-finite number.");
  return String(Math.round(n) === n ? Math.round(n) : n);
}

function luaBool(value) {
  return value ? "true" : "false";
}

// A Lua identifier used as a table key. Only ever called with literals from
// this file plus layout-option keys, which Config.js has already reduced to
// [A-Za-z0-9_]; the guard here is a second, independent boundary.
function luaKey(value) {
  var text = String(value === undefined || value === null ? "" : value);
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(text)) {
    throw new LuaQuoteError("Refusing to emit '" + text + "' as a Lua table key.");
  }
  return text;
}

// -------------------------------------------------------------- helpers

function isObject(value) {
  return value !== null && typeof value === "object" &&
    Object.prototype.toString.call(value) !== "[object Array]";
}

function isArray(value) {
  return Object.prototype.toString.call(value) === "[object Array]";
}

function keysymFor(config, id) {
  var list = config && config.binds && isArray(config.binds.keysyms) ? config.binds.keysyms : STOCK_KEYSYMS;
  var sym = list[id - 1];
  if (typeof sym !== "string" || sym === "") sym = STOCK_KEYSYMS[id - 1] || "";
  // Structural refusal of the broken form, independent of Config.js.
  if (/^code/i.test(sym) || !/^[A-Za-z0-9_]+$/.test(sym)) return "";
  return sym;
}

function workspaceList(config) {
  return config && isArray(config.workspaces) ? config.workspaces : [];
}

// Resolve an app's launch command. Three tiers, manual first so the escape
// hatch always wins:
//
//   1. app.launch.command   a typed command, used verbatim
//   2. app.launch.launcher  a shared prefix from config.launchers, plus args
//   3. app.desktop.id       gtk-launch '<id>.desktop'
//
// Config.resolveCommand implements the identical ladder; the two must agree or
// validate() and this generator disagree about whether an app has a command.
function commandFor(config, app) {
  if (!app || !app.launch) return "";
  var direct = app.launch.command ? String(app.launch.command) : "";
  if (direct) return direct;

  var launchers = config && isObject(config.launchers) ? config.launchers : {};
  var id = app.launch.launcher || "";
  if (id && launchers[id] && launchers[id].command) {
    var prefix = String(launchers[id].command);
    var args = app.launch.args ? String(app.launch.args) : "";
    return args ? prefix + " " + args : prefix;
  }

  return hyprDesktopCommand(app);
}

// `uwsm app <id>` rejects desktop ids containing spaces, and this machine has
// "Google Maps.desktop"; `gtk-launch` is what the Omarchy launcher itself uses
// for exactly that reason (AppLibrary.qml:81-86). The whole thing still goes
// through o.launch(), so the generated file stays honest about the wrapper.
//
// The id is quoted for the SHELL here; luaQuote then quotes the result for Lua.
// Two different layers, two different escapes.
function hyprDesktopCommand(app) {
  if (!app || !isObject(app.desktop) || !app.desktop.id) return "";
  var id = String(app.desktop.id);
  if (/['\n\r]/.test(id) || id.indexOf("/") !== -1) return "";
  for (var i = 0; i < id.length; i++) {
    var code = id.charCodeAt(i);
    if (code < 0x20 || code === 0x7f) return "";
  }
  return "gtk-launch " + hyprShellQuoteSingle(id + ".desktop");
}

function hyprShellQuoteSingle(value) {
  return "'" + String(value === undefined || value === null ? "" : value).replace(/'/g, "'\\''") + "'";
}

// ---------------------------------------------------------- layout mapping

function isEmittableLayout(name) {
  var text = String(name || "");
  for (var i = 0; i < EMITTABLE_LAYOUTS.length; i++) if (EMITTABLE_LAYOUTS[i] === text) return true;
  return false;
}

// Drops anything outside the whitelist, and anything the named option cannot
// legally hold. Returns a fresh object; never throws.
function filterLayoutOpts(raw) {
  var out = {};
  if (!isObject(raw)) return out;
  for (var key in raw) {
    if (!Object.prototype.hasOwnProperty.call(raw, key)) continue;
    var allowed = false;
    for (var i = 0; i < LAYOUT_OPT_KEYS.length; i++) if (LAYOUT_OPT_KEYS[i] === key) allowed = true;
    if (!allowed) continue;

    var value = raw[key];
    if (key === "orientation") {
      var ok = false;
      for (var j = 0; j < MASTER_ORIENTATIONS.length; j++) if (MASTER_ORIENTATIONS[j] === String(value)) ok = true;
      if (!ok) continue;
      out[key] = String(value);
      continue;
    }
    if (value === true || value === false) { out[key] = value; continue; }
    var n = Number(value);
    if (isFinite(n) && String(value).replace(/\s/g, "") !== "") { out[key] = n; continue; }
  }
  return out;
}

// What the compositor should be told about a workspace's arrangement, or null.
// An explicit layout choice on the workspace always beats the canvas.
function arrangementLayout(workspace) {
  if (!layoutModule || typeof layoutModule.toWorkspaceLayout !== "function") return null;
  if (!isObject(workspace) || !isObject(workspace.arrangement)) return null;
  if (workspace.arrangement.mode !== "tiled") return null;
  if (workspace.layout) return null;
  var projected = layoutModule.toWorkspaceLayout(workspace.arrangement.root);
  if (!projected || !isEmittableLayout(projected.layout)) return null;
  return { layout: projected.layout, layoutOpts: filterLayoutOpts(projected.layoutOpts) };
}

// app index -> { float, size, move } from the canvas, for mode "float" only.
// The first leaf wins when an app appears twice: a window rule cannot tell two
// windows of the same app apart, so the second rectangle is unreachable.
function arrangementFloatRects(workspace) {
  var out = {};
  if (!layoutModule || typeof layoutModule.toFloatRects !== "function") return out;
  if (!isObject(workspace) || !isObject(workspace.arrangement)) return out;
  if (workspace.arrangement.mode !== "float") return out;
  var rects = layoutModule.toFloatRects(workspace.arrangement.root, workspace.arrangement.topReservePct);
  if (!isArray(rects)) return out;
  for (var i = 0; i < rects.length; i++) {
    var r = rects[i];
    var index = parseInt(r.app, 10);
    if (!isFinite(index) || index < 0) continue;
    if (out[index] !== undefined) continue;
    out[index] = {
      size: pct(r.wPct) + " " + pct(r.hPct),
      move: pct(r.xPct) + " " + pct(r.yPct)
    };
  }
  return out;
}

// Percentages reach Lua as a quoted string ("50% 92%"), so the number itself
// is rebuilt from a parsed float and can never carry anything but digits.
function pct(value) {
  var n = Number(value);
  if (!isFinite(n)) n = 0;
  if (n < 0) n = 0;
  if (n > 100) n = 100;
  return String(Math.round(n * 100) / 100) + "%";
}

// `o.launch(cmd)` prefixes uwsm-app so GUI processes land in the right systemd
// scope. Emitting the call rather than the expansion keeps the generated file
// honest if Omarchy ever changes what o.launch does.
function launchExpr(command) {
  return "o.launch(" + luaQuote(command) + ")";
}

// A table literal from an ordered list of [key, renderedValue] pairs. Wraps
// onto multiple lines past WRAP_COLUMN so long rules stay readable and diff
// one field at a time.
function renderTable(prefix, fields, suffix) {
  var inline = prefix + "{ ";
  var parts = [];
  for (var i = 0; i < fields.length; i++) {
    parts.push(luaKey(fields[i][0]) + " = " + fields[i][1]);
  }
  inline += parts.join(", ") + " }" + suffix;
  if (inline.length <= WRAP_COLUMN || parts.length < 2) return [inline];

  var lines = [prefix + "{"];
  for (var j = 0; j < parts.length; j++) {
    lines.push("  " + parts[j] + (j === parts.length - 1 ? "" : ","));
  }
  lines.push("}" + suffix);
  return lines;
}

// ------------------------------------------------------- workspace rules

// `on_created_empty` takes a single command. Several apps on one workspace are
// chained with " & " so each is backgrounded by the shell Hyprland spawns; the
// editor warns when this happens.
function onCreatedEmptyExpr(config, workspace) {
  var exprs = [];
  for (var i = 0; i < workspace.apps.length; i++) {
    var app = workspace.apps[i];
    if (!app.launch || app.launch.mode !== "onCreatedEmpty") continue;
    var command = commandFor(config, app);
    if (!command) continue;
    exprs.push(launchExpr(command));
  }
  if (exprs.length === 0) return "";
  if (exprs.length === 1) return exprs[0];
  return exprs.join(' .. " & " .. ');
}

function workspaceRuleFields(config, workspace) {
  var fields = [["workspace", luaQuote(String(workspace.id))]];

  if (workspace.name) fields.push(["default_name", luaQuote(workspace.name)]);
  if (workspace.monitor) fields.push(["monitor", luaQuote(workspace.monitor)]);
  if (workspace.persistent) fields.push(["persistent", luaBool(true)]);
  if (workspace["default"]) fields.push(["default", luaBool(true)]);
  var derived = arrangementLayout(workspace);
  var layoutName = workspace.layout || (derived ? derived.layout : "");
  var layoutOpts = workspace.layout
    ? filterLayoutOpts(workspace.layoutOpts)
    : (derived ? derived.layoutOpts : {});

  if (layoutName && isEmittableLayout(layoutName)) {
    fields.push(["layout", luaQuote(layoutName)]);

    var optKeys = [];
    for (var key in layoutOpts) {
      if (Object.prototype.hasOwnProperty.call(layoutOpts, key)) optKeys.push(key);
    }
    optKeys.sort();
    if (optKeys.length) {
      var opts = [];
      for (var i = 0; i < optKeys.length; i++) {
        var value = layoutOpts[optKeys[i]];
        var rendered = value === true || value === false
          ? luaBool(value)
          : (typeof value === "number" ? luaNumber(value) : luaQuote(value));
        opts.push(luaKey(optKeys[i]) + " = " + rendered);
      }
      fields.push(["layout_opts", "{ " + opts.join(", ") + " }"]);
    }
  }

  var advanced = isObject(workspace.advanced) ? workspace.advanced : {};
  if (advanced.gapsIn !== null && advanced.gapsIn !== undefined) fields.push(["gaps_in", luaNumber(advanced.gapsIn)]);
  if (advanced.gapsOut !== null && advanced.gapsOut !== undefined) fields.push(["gaps_out", luaNumber(advanced.gapsOut)]);
  if (advanced.borderSize !== null && advanced.borderSize !== undefined) fields.push(["border_size", luaNumber(advanced.borderSize)]);
  if (advanced.decorate === true || advanced.decorate === false) fields.push(["decorate", luaBool(advanced.decorate)]);
  if (advanced.noRounding === true || advanced.noRounding === false) fields.push(["no_rounding", luaBool(advanced.noRounding)]);
  if (advanced.noBorder === true || advanced.noBorder === false) fields.push(["no_border", luaBool(advanced.noBorder)]);
  if (advanced.noShadow === true || advanced.noShadow === false) fields.push(["no_shadow", luaBool(advanced.noShadow)]);

  var onCreated = onCreatedEmptyExpr(config, workspace);
  if (onCreated) fields.push(["on_created_empty", onCreated]);

  return fields;
}

function workspaceRuleLines(config) {
  var lines = [];
  var list = workspaceList(config);
  for (var i = 0; i < list.length; i++) {
    var fields = workspaceRuleFields(config, list[i]);
    // A rule carrying only `workspace` tells Hyprland nothing; skip it so the
    // generated file stays a faithful picture of what was actually configured.
    if (fields.length < 2) continue;
    lines = lines.concat(renderTable("hl.workspace_rule(", fields, ")"));
  }
  return lines;
}

// ---------------------------------------------------------- window rules

var MATCH_FIELD_MAP = [
  ["class", "class"],
  ["title", "title"],
  ["initialClass", "initial_class"],
  ["initialTitle", "initial_title"]
];

function windowRuleLines(config) {
  var lines = [];
  var list = workspaceList(config);
  for (var i = 0; i < list.length; i++) {
    var workspace = list[i];
    // Layered UNDER app.rules below, so a hand-typed size still wins.
    var floats = arrangementFloatRects(workspace);
    for (var a = 0; a < workspace.apps.length; a++) {
      var app = workspace.apps[a];
      var match = [];
      for (var m = 0; m < MATCH_FIELD_MAP.length; m++) {
        var from = MATCH_FIELD_MAP[m][0];
        var to = MATCH_FIELD_MAP[m][1];
        if (app.match && app.match[from]) {
          match.push(luaKey(to) + " = " + luaQuote(app.match[from]));
        }
      }
      if (match.length === 0) continue;

      var target = String(workspace.id) + (app.rules && app.rules.silent ? " silent" : "");
      var fields = [
        ["name", luaQuote("wsstudio:ws" + workspace.id + ":" + (a + 1))],
        ["match", "{ " + match.join(", ") + " }"],
        ["workspace", luaQuote(target)]
      ];
      var placed = floats[a];
      if (app.rules) {
        if (app.rules.float === true || (placed && app.rules.float !== false)) fields.push(["float", luaBool(true)]);
        else if (app.rules.float === false) fields.push(["tile", luaBool(true)]);
        var size = app.rules.size || (placed && app.rules.float !== false ? placed.size : "");
        var move = app.rules.move || (placed && app.rules.float !== false ? placed.move : "");
        if (size) fields.push(["size", luaQuote(size)]);
        if (move) fields.push(["move", luaQuote(move)]);
      }
      if (workspace.monitor) fields.push(["monitor", luaQuote(workspace.monitor)]);

      lines = lines.concat(renderTable("hl.window_rule(", fields, ")"));
    }
  }
  return lines;
}

// ------------------------------------------------------------- autostart

// Verified on Hyprland 0.56.2: `hl.on("hyprland.start")` fires only when the
// compositor starts. `hyprctl reload` and `hyprctl reload config-only`
// re-execute this chunk and fire "config.reloaded", but NOT "hyprland.start" —
// so re-applying the config does not relaunch autostart apps and no guard is
// needed here. See README, "Does applying relaunch my apps?".
function autostartLines(config) {
  var lines = [];
  var maxDelay = 0;
  var list = workspaceList(config);

  for (var i = 0; i < list.length; i++) {
    var workspace = list[i];
    for (var a = 0; a < workspace.apps.length; a++) {
      var app = workspace.apps[a];
      if (!app.launch || app.launch.mode !== "autostart") continue;
      var command = commandFor(config, app);
      if (!command) continue;
      var delay = Number(app.launch.delaySec) || 0;
      if (delay > maxDelay) maxDelay = delay;
      if (delay > 0) {
        lines.push("o.exec_on_start(" + luaQuote("sleep " + luaNumber(delay) + " && ") + " .. " + launchExpr(command) + ")");
      } else {
        lines.push("o.launch_on_start(" + luaQuote(command) + ")");
      }
    }
  }

  var landOn = config && config.apply ? Number(config.apply.landOn) || 0 : 0;
  if (landOn > 0 && lines.length > 0) {
    var settle = maxDelay + 2;
    lines.push("o.exec_on_start(" +
      luaQuote("sleep " + luaNumber(settle) + " && hyprctl dispatch workspace " + luaNumber(landOn)) + ")");
  }

  return lines;
}

// ----------------------------------------------------------------- binds

function bindLines(config) {
  var binds = config && isObject(config.binds) ? config.binds : {};
  if (binds.enabled === false) return [];

  var focusMods = binds.focusMods || "SUPER";
  var moveMods = binds.moveMods || "SUPER + SHIFT";
  var silentMods = binds.moveSilentMods || "SUPER + SHIFT + ALT";
  var lines = [];
  var claimed = {};
  var list = workspaceList(config);

  for (var i = 0; i < list.length; i++) {
    var id = list[i].id;
    var keysym = keysymFor(config, id);
    if (!keysym) continue;
    claimed[id] = true;

    // Unbind both spellings so this file is correct on a stock Omarchy config
    // (which declares the binds as code:NN) and on one already patched to
    // keysyms. hl.unbind on a key that is not bound is a no-op.
    lines = lines.concat(unbindPair(focusMods, keysym, id));
    lines = lines.concat(unbindPair(moveMods, keysym, id));
    lines = lines.concat(unbindPair(silentMods, keysym, id));

    // Descriptions match Omarchy's own wording so `omarchy menu keybindings`
    // keeps reading correctly; a Lua bind is otherwise opaque in `hyprctl binds`.
    lines.push("o.bind(" + luaQuote(focusMods + " + " + keysym) + ", " +
      luaQuote("Switch to workspace " + id) + ", " +
      "hl.dsp.focus({ workspace = " + luaQuote(String(id)) + " }))");
    lines.push("o.bind(" + luaQuote(moveMods + " + " + keysym) + ", " +
      luaQuote("Move window to workspace " + id) + ", " +
      "hl.dsp.window.move({ workspace = " + luaQuote(String(id)) + " }))");
    lines.push("o.bind(" + luaQuote(silentMods + " + " + keysym) + ", " +
      luaQuote("Move window silently to workspace " + id) + ", " +
      "hl.dsp.window.move({ workspace = " + luaQuote(String(id)) + ", follow = false }))");
    lines.push("");
  }

  if (binds.unbindUnused !== false) {
    var orphans = [];
    for (var id2 = 1; id2 <= STOCK_WORKSPACE_COUNT; id2++) {
      if (claimed[id2]) continue;
      var sym = STOCK_KEYSYMS[id2 - 1];
      if (!sym) continue;
      orphans = orphans.concat(unbindPair(focusMods, sym, id2));
      orphans = orphans.concat(unbindPair(moveMods, sym, id2));
      orphans = orphans.concat(unbindPair(silentMods, sym, id2));
    }
    if (orphans.length) {
      lines.push("-- Workspaces this config does not define: drop Omarchy's stock binds.");
      lines = lines.concat(orphans);
      lines.push("");
    }
  }

  while (lines.length && lines[lines.length - 1] === "") lines.pop();
  return lines;
}

function unbindPair(mods, keysym, id) {
  return [
    "hl.unbind(" + luaQuote(mods + " + code:" + luaNumber(id + 9)) + ")",
    "hl.unbind(" + luaQuote(mods + " + " + keysym) + ")"
  ];
}

// ------------------------------------------------------------------ main

function header(options) {
  var version = (options && options.version) || GENERATOR_VERSION;
  return [
    "-- GENERATED BY " + GENERATOR_NAME + " v" + version + " -- DO NOT EDIT.",
    "--",
    "-- Source of truth: " + CONFIG_PATH,
    "-- This file:       " + GENERATED_PATH,
    "-- Regenerate:      open the bar widget's editor (right-click) and press Apply.",
    "-- Remove:          delete this file and run `hyprctl reload`.",
    "--",
    "-- Loaded last, from ~/.local/state/omarchy/toggles/hypr, by the",
    "-- `require(\"default.hypr.toggles\")` at the end of ~/.config/hypr/hyprland.lua,",
    "-- so the unbinds below reliably win over earlier config.",
    ""
  ];
}

function section(title) {
  var rule = "-- --- " + title + " ";
  while (rule.length < 72) rule += "-";
  return [rule];
}

// config -> Lua source string. Deterministic: same config, same bytes.
function toLua(config, options) {
  var lines = header(options);

  var workspaceRules = workspaceRuleLines(config);
  if (workspaceRules.length) {
    lines = lines.concat(section("workspace rules"), workspaceRules, [""]);
  }

  var windowRules = windowRuleLines(config);
  if (windowRules.length) {
    lines = lines.concat(section("window rules"), windowRules, [""]);
  }

  var autostart = autostartLines(config);
  if (autostart.length) {
    lines = lines.concat(section("autostart"), [
      "-- hl.on(\"hyprland.start\") does not refire on `hyprctl reload`, so",
      "-- re-applying this config never relaunches these."
    ], autostart, [""]);
  }

  var binds = bindLines(config);
  if (binds.length) {
    lines = lines.concat(section("workspace binds"), [
      "-- Keysyms only. Hyprland 0.56.2 silently drops \"code:NN\" bind keycodes:",
      "-- they land in the bind table with key=\"\" / keycode=0 and match on the",
      "-- modifier mask alone, firing every bind that shares that mask. Both",
      "-- spellings are unbound first so this file is correct either way.",
      ""
    ], binds, [""]);
  }

  return lines.join("\n").replace(/\n{3,}/g, "\n\n") + "\n";
}

// ------------------------------------------------------------------ diff

// Minimal LCS line diff, enough for the editor's preview pane. Returns
// [{ type: " " | "+" | "-", text }]. Inputs are bounded by the size of a
// generated config, so the O(n*m) table is fine.
function diffLines(before, after) {
  var a = String(before === undefined || before === null ? "" : before).split("\n");
  var b = String(after === undefined || after === null ? "" : after).split("\n");
  if (a.length === 1 && a[0] === "") a = [];
  if (b.length === 1 && b[0] === "") b = [];

  var table = [];
  for (var i = 0; i <= a.length; i++) {
    table.push([]);
    for (var j = 0; j <= b.length; j++) table[i].push(0);
  }
  for (var x = a.length - 1; x >= 0; x--) {
    for (var y = b.length - 1; y >= 0; y--) {
      table[x][y] = a[x] === b[y] ? table[x + 1][y + 1] + 1 : Math.max(table[x + 1][y], table[x][y + 1]);
    }
  }

  var out = [];
  var p = 0;
  var q = 0;
  while (p < a.length && q < b.length) {
    if (a[p] === b[q]) { out.push({ type: " ", text: a[p] }); p++; q++; }
    else if (table[p + 1][q] >= table[p][q + 1]) { out.push({ type: "-", text: a[p] }); p++; }
    else { out.push({ type: "+", text: b[q] }); q++; }
  }
  while (p < a.length) { out.push({ type: "-", text: a[p] }); p++; }
  while (q < b.length) { out.push({ type: "+", text: b[q] }); q++; }
  return out;
}

function diffStats(diff) {
  var added = 0;
  var removed = 0;
  for (var i = 0; i < diff.length; i++) {
    if (diff[i].type === "+") added++;
    else if (diff[i].type === "-") removed++;
  }
  return { added: added, removed: removed, changed: added + removed > 0 };
}
