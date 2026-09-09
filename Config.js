// Workspace Studio — configuration model.
//
// Pure JavaScript, no QML globals and no Node globals, so the exact same file
// backs the QML editor (`import "Config.js" as Config`) and the `node --test`
// suite (loaded through `node:vm`). Everything here is total: nothing throws,
// every entry point tolerates garbage input and returns a well-formed config.
//
// The document this file describes lives at
// ~/.config/omarchy/workspace-studio.json and is the single source of truth
// for the compositor layer. Purely presentational bar options live in the
// plugin's inline ~/.config/omarchy/shell.json entry instead.

var CONFIG_VERSION = 1;

var MAX_WORKSPACES = 12;
var MAX_NAME_LENGTH = 24;
var MAX_ICON_LENGTH = 8;

var LAYOUTS = ["", "dwindle", "master", "scrolling"];
var LAUNCH_MODES = ["none", "onCreatedEmpty", "autostart"];
var RELOAD_MODES = ["config-only", "full", "eval-only"];
var COLORS = ["default", "accent", "urgent"];
var MATCH_KEYS = ["class", "title", "initialClass", "initialTitle"];

// How validate() names a match field in a sentence.
var MATCH_LABELS = {
  "class": "class",
  "title": "title",
  "initialClass": "initial class",
  "initialTitle": "initial title"
};

// Which rule in deriveClass() produced app.match.class. Stored so the editor
// can show how much to trust it, and so a class the user edited by hand is
// never silently overwritten by a later pick.
var CLASS_SOURCES = ["", "startupClass", "webapp", "appId", "tui", "reverseDns", "exec", "id", "manual"];

// How the canvas asks the compositor to arrange a workspace.
//   none   emit nothing at all, and omit the key entirely on serialize
//   tiled  project the tree onto hl.workspace_rule layout / layout_opts
//   float  emit every leaf's rectangle as float + size% + move% window rules
var LAYOUT_MODES = ["none", "tiled", "float"];

// Hyprland validates neither layout names nor layout_opts keys: `layout =
// "bogus"` and `layout_opts = { bogus_opt = 1 }` both pass --verify-config and
// then do nothing, with no error anywhere. So the whitelist has to live here.
var LAYOUT_OPT_KEYS = [
  "orientation", "mfact", "force_split", "default_split_ratio",
  "split_bias", "slave_count_for_center_master", "column_width"
];
var MASTER_ORIENTATIONS = ["left", "right", "top", "bottom", "center"];

// Keysyms only. Hyprland 0.56.2 silently drops "code:NN" bind keycodes: they
// land in the bind table with key="" / keycode=0 and then match on the
// modifier mask alone, firing every bind that shares that mask. See README.
var DEFAULT_KEYSYMS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0", "minus", "equal"];

// ---------------------------------------------------------------- coercion

function isObject(value) {
  return value !== null && typeof value === "object" && !isArray(value);
}

function isArray(value) {
  return Object.prototype.toString.call(value) === "[object Array]";
}

function clampInt(value, min, max, fallback) {
  var n = parseInt(value, 10);
  if (!isFinite(n)) return fallback;
  if (n < min) return min;
  if (n > max) return max;
  return n;
}

function clampReal(value, min, max, fallback) {
  var n = Number(value);
  if (!isFinite(n)) return fallback;
  if (n < min) return min;
  if (n > max) return max;
  return n;
}

function toBool(value, fallback) {
  if (value === true || value === false) return value;
  if (value === undefined || value === null) return fallback;
  var s = String(value).toLowerCase();
  if (s === "true" || s === "1" || s === "yes" || s === "on") return true;
  if (s === "false" || s === "0" || s === "no" || s === "off") return false;
  return fallback;
}

// Strings reaching this function end up inside generated Lua source, inside a
// tooltip, or inside a shell command. Control characters have no legitimate
// use in any of those places and newlines would break out of a Lua string
// literal, so they are stripped here as well as rejected in HyprGen.luaQuote.
function cleanString(value, maxLength) {
  if (value === undefined || value === null) return "";
  var text = String(value);
  text = text.replace(/[\u0000-\u001f\u007f-\u009f]/g, "");
  text = text.replace(/[\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, "");
  text = text.replace(/^\s+|\s+$/g, "");
  var limit = parseInt(maxLength, 10);
  if (isFinite(limit) && limit > 0 && text.length > limit) text = text.slice(0, limit);
  return text;
}

function oneOf(value, allowed, fallback) {
  var text = value === undefined || value === null ? "" : String(value);
  for (var i = 0; i < allowed.length; i++) {
    if (allowed[i] === text) return text;
  }
  return fallback;
}

function cloneJson(value) {
  try {
    return JSON.parse(JSON.stringify(value));
  } catch (error) {
    return null;
  }
}

// ------------------------------------------------------------ layout module
//
// The slicing-tree maths lives in Layout.js, and QML gives each .js resource
// its own scope, so it has to be handed over explicitly the way Import.js is
// handed this module (Studio.qml, Component.onCompleted).
//
// The fallback matters: with no module injected, an arrangement is PRESERVED
// verbatim rather than validated or dropped, so a host that forgets to wire it
// up (the bar widget, which only ever reads) can never destroy the user's tree.
var layoutApi = null;

function useLayout(module) {
  layoutApi = module || null;
}

// ---------------------------------------------------------------- defaults

function defaultApp() {
  return {
    label: "",
    match: { class: "", title: "", initialClass: "", initialTitle: "" },
    launch: { mode: "none", launcher: "", command: "", args: "", delaySec: 0 },
    rules: { float: null, size: "", move: "", silent: false }
  };
}

function defaultWorkspace(id) {
  return {
    id: clampInt(id, 1, MAX_WORKSPACES, 1),
    name: "",
    icon: "",
    iconName: "",
    color: "default",
    monitor: "",
    persistent: false,
    "default": false,
    layout: "",
    layoutOpts: {},
    advanced: {
      gapsIn: null,
      gapsOut: null,
      borderSize: null,
      decorate: null,
      noRounding: null,
      noBorder: null,
      noShadow: null
    },
    apps: []
  };
}

function defaultBinds() {
  return {
    enabled: true,
    focusMods: "SUPER",
    moveMods: "SUPER + SHIFT",
    moveSilentMods: "SUPER + SHIFT + ALT",
    keysyms: DEFAULT_KEYSYMS.slice(0),
    unbindUnused: true
  };
}

function defaultApply() {
  return { reloadMode: "config-only", landOn: 0 };
}

function defaults() {
  var workspaces = [];
  for (var i = 1; i <= 5; i++) workspaces.push(defaultWorkspace(i));
  return {
    version: CONFIG_VERSION,
    workspaces: workspaces,
    launchers: {},
    binds: defaultBinds(),
    apply: defaultApply()
  };
}

// An empty document: used when the user starts from scratch instead of
// importing. Distinct from defaults() so the first-run wizard can tell
// "nothing configured yet" from "five blank workspaces".
function empty() {
  return {
    version: CONFIG_VERSION,
    workspaces: [],
    launchers: {},
    binds: defaultBinds(),
    apply: defaultApply()
  };
}

// ------------------------------------------------------------- normalizing

function normalizeMatch(raw) {
  var out = { class: "", title: "", initialClass: "", initialTitle: "" };
  if (!isObject(raw)) return out;
  for (var i = 0; i < MATCH_KEYS.length; i++) {
    var key = MATCH_KEYS[i];
    out[key] = cleanString(raw[key], 512);
  }
  return out;
}

function normalizeLaunch(raw) {
  var out = { mode: "none", launcher: "", command: "", args: "", delaySec: 0 };
  if (!isObject(raw)) return out;
  out.mode = oneOf(raw.mode, LAUNCH_MODES, "none");
  out.launcher = cleanString(raw.launcher, 64);
  out.command = cleanString(raw.command, 1024);
  out.args = cleanString(raw.args, 1024);
  out.delaySec = clampInt(raw.delaySec, 0, 120, 0);
  return out;
}

function normalizeAppRules(raw) {
  var out = { float: null, size: "", move: "", silent: false };
  if (!isObject(raw)) return out;
  if (raw.float === true || raw.float === false) out.float = raw.float;
  out.size = cleanString(raw.size, 32);
  out.move = cleanString(raw.move, 32);
  out.silent = toBool(raw.silent, false);
  return out;
}

// The desktop entry an app was picked from. Optional and additive: absent in
// every document written before v0.2, and returned as `undefined` rather than
// null so JSON.stringify drops the key instead of writing "desktop": null.
//
// `id` is single-quoted into a shell command on the way out (gtk-launch), so
// the characters that could break out of that quoting are rejected here rather
// than escaped — a rejected id surfaces in the editor, a mangled one does not.
function normalizeDesktop(raw) {
  if (!isObject(raw)) return undefined;

  var id = cleanString(raw.id, 128);
  if (id.slice(-8) === ".desktop") id = id.slice(0, -8);
  if (!id) return undefined;
  if (id.indexOf("/") !== -1 || id.indexOf("..") !== -1 || id.indexOf("'") !== -1) return undefined;

  var out = { id: id, name: cleanString(raw.name, 128), icon: "", classSource: "" };

  var icon = cleanString(raw.icon, 128);
  if (icon && (/^[A-Za-z0-9._+-]+$/.test(icon) || icon.charAt(0) === "/")) out.icon = icon;

  out.classSource = oneOf(raw.classSource, CLASS_SOURCES, "");
  return out;
}

function normalizeApp(raw) {
  var app = defaultApp();
  if (!isObject(raw)) return app;
  app.label = cleanString(raw.label, 48);
  app.match = normalizeMatch(raw.match);
  app.launch = normalizeLaunch(raw.launch);
  app.rules = normalizeAppRules(raw.rules);
  var desktop = normalizeDesktop(raw.desktop);
  if (desktop) app.desktop = desktop;
  return app;
}

// The canvas's arrangement for one workspace. Additive and omitted entirely
// while the mode is "none", which is what keeps every pre-v0.2 document
// byte-identical through parse -> serialize.
//
// NOTE ON THE KEY NAME: the v0.2 analysis called this `workspace.layout`, but
// that name was already taken by the layout-name string ("dwindle" / "master")
// that every existing document carries. The two have to coexist — an explicit
// layout choice deliberately beats the canvas — so the canvas's data lives
// under `arrangement`.
function normalizeArrangement(raw, appCount) {
  if (!isObject(raw)) return undefined;
  var mode = oneOf(raw.mode, LAYOUT_MODES, "none");
  if (mode === "none") return undefined;

  var reserve = clampReal(raw.topReservePct, 0, 50, 0);
  reserve = Math.round(reserve * 100) / 100;

  var root = null;
  if (layoutApi && typeof layoutApi.normalizeTree === "function") {
    root = layoutApi.normalizeTree(raw.root, appCount);
  } else {
    // No module: preserve rather than validate. Losing the user's drawing
    // because a host forgot one wiring call would be much worse than carrying
    // an unvalidated tree through a read-only path.
    root = cloneJson(raw.root);
  }
  if (!root) return undefined;

  return { mode: mode, root: root, topReservePct: reserve };
}

function normalizeLayoutOpts(raw) {
  var out = {};
  if (!isObject(raw)) return out;
  for (var key in raw) {
    if (!Object.prototype.hasOwnProperty.call(raw, key)) continue;
    var cleanKey = cleanString(key, 32).replace(/[^A-Za-z0-9_]/g, "");
    if (!cleanKey) continue;
    var value = raw[key];
    if (value === true || value === false) out[cleanKey] = value;
    else if (typeof value === "number" && isFinite(value)) out[cleanKey] = value;
    else out[cleanKey] = cleanString(value, 64);
  }
  return out;
}

function normalizeAdvanced(raw) {
  var out = defaultWorkspace(1).advanced;
  if (!isObject(raw)) return out;
  out.gapsIn = raw.gapsIn === null || raw.gapsIn === undefined || raw.gapsIn === "" ? null : clampInt(raw.gapsIn, 0, 200, null);
  out.gapsOut = raw.gapsOut === null || raw.gapsOut === undefined || raw.gapsOut === "" ? null : clampInt(raw.gapsOut, 0, 200, null);
  out.borderSize = raw.borderSize === null || raw.borderSize === undefined || raw.borderSize === "" ? null : clampInt(raw.borderSize, 0, 40, null);
  out.decorate = raw.decorate === true || raw.decorate === false ? raw.decorate : null;
  out.noRounding = raw.noRounding === true || raw.noRounding === false ? raw.noRounding : null;
  out.noBorder = raw.noBorder === true || raw.noBorder === false ? raw.noBorder : null;
  out.noShadow = raw.noShadow === true || raw.noShadow === false ? raw.noShadow : null;
  return out;
}

function normalizeWorkspace(raw, fallbackId) {
  var ws = defaultWorkspace(fallbackId);
  if (!isObject(raw)) return ws;
  ws.id = clampInt(raw.id, 1, MAX_WORKSPACES, fallbackId);
  ws.name = cleanString(raw.name, MAX_NAME_LENGTH);
  ws.icon = cleanString(raw.icon, MAX_ICON_LENGTH);
  ws.iconName = cleanString(raw.iconName, 64);
  ws.color = normalizeColor(raw.color);
  ws.monitor = cleanString(raw.monitor, 64);
  ws.persistent = toBool(raw.persistent, false);
  ws["default"] = toBool(raw["default"], false);
  ws.layout = oneOf(raw.layout, LAYOUTS, "");
  ws.layoutOpts = normalizeLayoutOpts(raw.layoutOpts);
  ws.advanced = normalizeAdvanced(raw.advanced);
  ws.apps = [];
  if (isArray(raw.apps)) {
    for (var i = 0; i < raw.apps.length; i++) ws.apps.push(normalizeApp(raw.apps[i]));
  }
  // After the apps, because a leaf pointing past the end of apps[] is clamped.
  var arrangement = normalizeArrangement(raw.arrangement, ws.apps.length);
  if (arrangement) ws.arrangement = arrangement;
  return ws;
}

function normalizeColor(raw) {
  var text = cleanString(raw, 16);
  if (!text) return "default";
  for (var i = 0; i < COLORS.length; i++) if (COLORS[i] === text) return text;
  if (/^#[0-9a-fA-F]{6}$/.test(text)) return text.toLowerCase();
  return "default";
}

function normalizeLaunchers(raw) {
  var out = {};
  if (!isObject(raw)) return out;
  for (var key in raw) {
    if (!Object.prototype.hasOwnProperty.call(raw, key)) continue;
    var id = cleanString(key, 64).replace(/[^A-Za-z0-9._-]/g, "");
    if (!id) continue;
    var entry = raw[key];
    if (!isObject(entry)) continue;
    var command = cleanString(entry.command, 1024);
    if (!command) continue;
    out[id] = { label: cleanString(entry.label, 64) || id, command: command };
  }
  return out;
}

function normalizeBinds(raw) {
  var binds = defaultBinds();
  if (!isObject(raw)) return binds;
  binds.enabled = toBool(raw.enabled, true);
  binds.focusMods = cleanModifiers(raw.focusMods, "SUPER");
  binds.moveMods = cleanModifiers(raw.moveMods, "SUPER + SHIFT");
  binds.moveSilentMods = cleanModifiers(raw.moveSilentMods, "SUPER + SHIFT + ALT");
  binds.unbindUnused = toBool(raw.unbindUnused, true);
  if (isArray(raw.keysyms) && raw.keysyms.length > 0) {
    var keysyms = [];
    for (var i = 0; i < raw.keysyms.length && i < MAX_WORKSPACES; i++) {
      var sym = cleanKeysym(raw.keysyms[i]);
      keysyms.push(sym || DEFAULT_KEYSYMS[i] || "");
    }
    for (var j = keysyms.length; j < MAX_WORKSPACES; j++) keysyms.push(DEFAULT_KEYSYMS[j]);
    binds.keysyms = keysyms;
  }
  return binds;
}

// A keysym is an X11 symbol name: letters, digits and underscore only. This
// also structurally forbids the "code:NN" form, which is the whole point.
function cleanKeysym(raw) {
  var text = cleanString(raw, 32).replace(/[^A-Za-z0-9_]/g, "");
  if (/^code/i.test(text)) return "";
  return text;
}

// Modifier lists are re-emitted into bind strings, so restrict them to the
// known Hyprland modifier names joined by " + ".
function cleanModifiers(raw, fallback) {
  var allowed = ["SUPER", "SHIFT", "ALT", "CTRL", "CONTROL", "MOD2", "MOD3", "MOD5"];
  var text = cleanString(raw, 64).toUpperCase();
  if (!text) return fallback;
  var parts = text.split("+");
  var out = [];
  for (var i = 0; i < parts.length; i++) {
    var part = parts[i].replace(/[^A-Z0-9]/g, "");
    if (!part) continue;
    var ok = false;
    for (var j = 0; j < allowed.length; j++) if (allowed[j] === part) ok = true;
    if (!ok) return fallback;
    out.push(part);
  }
  return out.length ? out.join(" + ") : fallback;
}

function normalizeApply(raw) {
  var apply = defaultApply();
  if (!isObject(raw)) return apply;
  apply.reloadMode = oneOf(raw.reloadMode, RELOAD_MODES, "config-only");
  apply.landOn = clampInt(raw.landOn, 0, MAX_WORKSPACES, 0);
  return apply;
}

// Canonical form: every field present, every value in range, workspaces sorted
// by id with duplicates dropped. Generation is deterministic downstream of
// this, so the emitted Lua diffs cleanly between applies.
function normalize(raw) {
  var config = isObject(raw) ? raw : {};
  var out = {
    version: CONFIG_VERSION,
    workspaces: [],
    launchers: normalizeLaunchers(config.launchers),
    binds: normalizeBinds(config.binds),
    apply: normalizeApply(config.apply)
  };

  var seen = {};
  var list = isArray(config.workspaces) ? config.workspaces : [];
  for (var i = 0; i < list.length && out.workspaces.length < MAX_WORKSPACES; i++) {
    var ws = normalizeWorkspace(list[i], i + 1);
    if (seen[ws.id]) continue;
    seen[ws.id] = true;
    out.workspaces.push(ws);
  }
  out.workspaces.sort(function (a, b) { return a.id - b.id; });

  if (out.apply.landOn && !seen[out.apply.landOn]) out.apply.landOn = 0;
  return out;
}

// ------------------------------------------------------------- migration

// Bring any older or hand-edited document up to the current version. Unknown
// future versions are normalized rather than rejected so a downgrade never
// destroys the user's file silently — validate() reports the mismatch.
function migrate(raw) {
  var config = isObject(raw) ? cloneJson(raw) : null;
  if (!config) return defaults();

  // v0 (unversioned) documents used a flat { icons: {id: glyph} } map, the
  // shape of the hand-written bar clone this plugin generalises.
  if (config.version === undefined && isObject(config.icons)) {
    var workspaces = [];
    for (var key in config.icons) {
      if (!Object.prototype.hasOwnProperty.call(config.icons, key)) continue;
      var ws = defaultWorkspace(parseInt(key, 10) || 1);
      ws.icon = String(config.icons[key] || "");
      workspaces.push(ws);
    }
    config = { version: CONFIG_VERSION, workspaces: workspaces };
  }

  return normalize(config);
}

function parse(text) {
  if (text === undefined || text === null) return null;
  var raw = String(text);
  if (raw.replace(/\s+/g, "") === "") return null;
  var parsed = null;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    return null;
  }
  if (!isObject(parsed)) return null;
  return migrate(parsed);
}

function serialize(config) {
  return JSON.stringify(normalize(config), null, 2) + "\n";
}

// ------------------------------------------------------------- validation

function appHasMatch(app) {
  if (!app || !app.match) return false;
  for (var i = 0; i < MATCH_KEYS.length; i++) {
    if (app.match[MATCH_KEYS[i]]) return true;
  }
  return false;
}

// Mirrors HyprGen.commandFor exactly. If these two ever disagree, validate()
// and the generator disagree about whether an app "has a command", which shows
// up as an Apply that silently does nothing.
//
//   1. a typed command        the manual escape hatch, so it wins outright
//   2. a shared launcher      prefix + args
//   3. a picked desktop entry gtk-launch '<id>.desktop'
//
// This reorders 1 and 2 relative to v0.1, where a launcher prefix beat a typed
// command. `launchers` is empty in every document written so far and no UI
// writes it, so the change is invisible in practice — but it is deliberate.
function resolveCommand(config, app) {
  if (!app || !app.launch) return "";
  var direct = app.launch.command || "";
  if (direct) return direct;

  var launchers = config && isObject(config.launchers) ? config.launchers : {};
  if (app.launch.launcher && launchers[app.launch.launcher] && launchers[app.launch.launcher].command) {
    var prefix = String(launchers[app.launch.launcher].command);
    var args = app.launch.args || "";
    return args ? prefix + " " + args : prefix;
  }

  return desktopCommand(app);
}

// `gtk-launch` rather than `uwsm app <id>`: uwsm's desktop-id regex rejects ids
// containing spaces, and this machine has "Google Maps.desktop". It is also
// exactly what the Omarchy launcher runs (AppLibrary.qml:85). The .desktop
// suffix is kept or ids like org.telegram.desktop do not resolve.
function desktopCommand(app) {
  if (!app || !isObject(app.desktop) || !app.desktop.id) return "";
  var id = String(app.desktop.id);
  // Belt and braces: normalizeDesktop already refuses these, and a smuggled id
  // must not be able to close the single quote it is about to sit inside.
  if (/['\n\r\u0000-\u001f]/.test(id) || id.indexOf("/") !== -1) return "";
  return "gtk-launch " + shellQuoteSingle(id + ".desktop");
}

// Mirrors the shell's Util.shellQuote (Commons/Util.qml:49-51).
function shellQuoteSingle(value) {
  return "'" + String(value === undefined || value === null ? "" : value).replace(/'/g, "'\\''") + "'";
}

// How a row is named in a message: its label, then whatever the picked desktop
// entry knows, then its position — the same fallback ladder the rest of
// validate() uses, spelled once because the conflict messages name two rows.
function appDescription(app, index) {
  if (app && app.label) return String(app.label);
  if (app && isObject(app.desktop) && (app.desktop.name || app.desktop.id)) {
    return String(app.desktop.name || app.desktop.id);
  }
  return "app " + (index + 1);
}

// Hyprland matches window-rule regexes against the whole property, so `chromium`
// and `^chromium$` select exactly the same windows. Strip one leading `^` and
// one trailing `$` (unless it is escaped, and so a literal dollar) to compare
// the two spellings. Only exact equality after this: patterns that merely
// overlap — `(a|b)` against `a` — are deliberately out of scope.
function canonicalMatch(value) {
  var pattern = value === undefined || value === null ? "" : String(value);
  if (pattern.charAt(0) === "^") pattern = pattern.substring(1);
  var last = pattern.length - 1;
  if (last >= 0 && pattern.charAt(last) === "$" && pattern.charAt(last - 1) !== "\\") {
    pattern = pattern.substring(0, last);
  }
  return pattern;
}

// Two rows on different workspaces that match the same window property are a
// silent trap: Hyprland applies one workspace rule to a matching window and the
// other row never sees it, with no error anywhere. Within a single workspace the
// same match twice is legitimate — two windows of the same app — so only pairs
// that straddle workspaces warn. Fields are compared like for like: a class is
// never compared against a title.
function matchConflictWarnings(config) {
  var out = [];
  var groups = {};
  var i, a, k, key, bucket;

  for (i = 0; i < config.workspaces.length; i++) {
    for (a = 0; a < config.workspaces[i].apps.length; a++) {
      var match = config.workspaces[i].apps[a].match;
      if (!isObject(match)) continue;
      for (k = 0; k < MATCH_KEYS.length; k++) {
        key = MATCH_KEYS[k];
        var canonical = canonicalMatch(match[key]);
        if (!canonical) continue;
        // Keyed by field and pattern together, so a class never groups with a
        // title. The space also keeps the key from colliding with an
        // Object.prototype name like "constructor".
        bucket = key + " " + canonical;
        if (!groups[bucket]) groups[bucket] = [];
        groups[bucket].push({ wsIndex: i, appIndex: a });
      }
    }
  }

  for (i = 0; i < config.workspaces.length; i++) {
    var ws = config.workspaces[i];
    for (a = 0; a < ws.apps.length; a++) {
      var app = ws.apps[a];
      if (!isObject(app.match)) continue;
      for (k = 0; k < MATCH_KEYS.length; k++) {
        key = MATCH_KEYS[k];
        var mine = canonicalMatch(app.match[key]);
        if (!mine) continue;
        bucket = key + " " + mine;
        var rows = groups[bucket];
        var other = null;
        for (var r = 0; rows && r < rows.length && !other; r++) {
          if (config.workspaces[rows[r].wsIndex].id !== ws.id) other = rows[r];
        }
        if (!other) continue;
        var otherWs = config.workspaces[other.wsIndex];
        out.push({
          path: "workspaces[" + i + "].apps[" + a + "].match." + key,
          message: "The " + MATCH_LABELS[key] + " match for " + appDescription(app, a) +
            " is the same as " + appDescription(otherWs.apps[other.appIndex], other.appIndex) +
            " on workspace " + otherWs.id + ", so Hyprland sends every matching window to only one of them."
        });
      }
    }
  }

  return out;
}

// Returns { ok, errors[], warnings[] }. Errors block Apply; warnings do not.
function validate(raw) {
  var errors = [];
  var warnings = [];
  var config = normalize(raw);

  if (isObject(raw) && raw.version !== undefined && raw.version !== CONFIG_VERSION) {
    warnings.push({ path: "version", message: "Document version " + raw.version + " was migrated to " + CONFIG_VERSION + "." });
  }

  if (config.workspaces.length === 0) {
    errors.push({ path: "workspaces", message: "Add at least one workspace." });
  }
  if (config.workspaces.length > 10) {
    warnings.push({
      path: "workspaces",
      message: "More than 10 workspaces: ids 11 and 12 bind to " +
        config.binds.keysyms[10] + " / " + config.binds.keysyms[11] + " instead of a digit."
    });
  }

  var defaultsPerMonitor = {};
  for (var i = 0; i < config.workspaces.length; i++) {
    var ws = config.workspaces[i];
    var where = "workspaces[" + i + "]";

    if (ws.icon && ws.icon.length > MAX_ICON_LENGTH) {
      errors.push({ path: where + ".icon", message: "Icon is too long." });
    }
    if (ws.layoutOpts && !ws.layout) {
      for (var unusedKey in ws.layoutOpts) {
        if (Object.prototype.hasOwnProperty.call(ws.layoutOpts, unusedKey)) {
          warnings.push({ path: where + ".layoutOpts", message: "Layout options need a layout to be set." });
          break;
        }
      }
    }
    if (ws["default"]) {
      var monitorKey = ws.monitor || "*";
      if (defaultsPerMonitor[monitorKey]) {
        errors.push({
          path: where + ".default",
          message: "Workspace " + ws.id + " and " + defaultsPerMonitor[monitorKey] +
            " are both the default for " + (ws.monitor || "every monitor") + "."
        });
      } else {
        defaultsPerMonitor[monitorKey] = ws.id;
      }
    }

    for (var a = 0; a < ws.apps.length; a++) {
      var app = ws.apps[a];
      var appWhere = where + ".apps[" + a + "]";
      var command = resolveCommand(config, app);

      if (!appHasMatch(app) && app.launch.mode === "none") {
        errors.push({
          path: appWhere,
          message: "App " + (app.label || a + 1) + " on workspace " + ws.id +
            " does nothing: give it a window match or a launch command."
        });
      }
      if (app.launch.mode !== "none" && !command) {
        errors.push({ path: appWhere + ".launch.command", message: "Launch mode needs a command, or an app picked from the list." });
      }
      if (app.desktop && app.desktop.id && app.launch.command) {
        warnings.push({
          path: appWhere + ".launch.command",
          message: "The typed command overrides the picked app for " +
            (app.label || app.desktop.name || app.desktop.id) + "."
        });
      }
      if (app.desktop && (app.desktop.classSource === "id" || app.desktop.classSource === "exec")) {
        warnings.push({
          path: appWhere + ".match.class",
          message: "The window class for " + (app.label || app.desktop.name || app.desktop.id) +
            " was guessed. Open it once and press Grab focused window to confirm."
        });
      }
      if (app.launch.launcher && !config.launchers[app.launch.launcher]) {
        errors.push({ path: appWhere + ".launch.launcher", message: "Unknown launcher '" + app.launch.launcher + "'." });
      }
      if (!appHasMatch(app) && app.launch.mode !== "none") {
        warnings.push({
          path: appWhere,
          message: "App " + (app.label || a + 1) + " launches but has no window match, so it will not be pinned to workspace " + ws.id + "."
        });
      }
      if (app.rules.size && !/^-?\d+%?\s+-?\d+%?$/.test(app.rules.size)) {
        errors.push({ path: appWhere + ".rules.size", message: "Size must look like '800 600'." });
      }
      if (app.rules.move && !/^-?\d+%?\s+-?\d+%?$/.test(app.rules.move)) {
        errors.push({ path: appWhere + ".rules.move", message: "Position must look like '100 100'." });
      }
      if (app.launch.mode === "autostart" && app.launch.delaySec > 60) {
        warnings.push({ path: appWhere + ".launch.delaySec", message: "A delay over a minute is probably a mistake." });
      }
    }

    if (ws.arrangement && ws.arrangement.mode === "tiled" && ws.layout) {
      warnings.push({
        path: where + ".layout",
        message: "Workspace " + ws.id + " has an explicit layout, so the canvas arrangement is not emitted."
      });
    }
    if (ws.arrangement && ws.arrangement.mode === "float") {
      warnings.push({
        path: where + ".arrangement",
        message: "Workspace " + ws.id + " uses exact placement, so its windows float instead of tiling."
      });
    }

    var onCreatedEmpty = 0;
    for (var b = 0; b < ws.apps.length; b++) {
      if (ws.apps[b].launch.mode === "onCreatedEmpty") onCreatedEmpty++;
    }
    if (onCreatedEmpty > 1) {
      warnings.push({
        path: where,
        message: "Workspace " + ws.id + " launches " + onCreatedEmpty +
          " apps on first visit; they are chained into one command."
      });
    }
  }

  var conflicts = matchConflictWarnings(config);
  for (var c = 0; c < conflicts.length; c++) warnings.push(conflicts[c]);

  if (config.binds.enabled && !config.binds.focusMods) {
    errors.push({ path: "binds.focusMods", message: "Focus modifiers cannot be empty." });
  }

  return { ok: errors.length === 0, errors: errors, warnings: warnings };
}

// ------------------------------------------------------------- editing aids

function workspaceIndexById(config, id) {
  if (!config || !isArray(config.workspaces)) return -1;
  for (var i = 0; i < config.workspaces.length; i++) {
    if (config.workspaces[i].id === id) return i;
  }
  return -1;
}

function nextFreeId(config) {
  var used = {};
  if (config && isArray(config.workspaces)) {
    for (var i = 0; i < config.workspaces.length; i++) used[config.workspaces[i].id] = true;
  }
  for (var id = 1; id <= MAX_WORKSPACES; id++) if (!used[id]) return id;
  return 0;
}

function addWorkspace(config, id) {
  var next = normalize(config);
  // A caller that does not care which id it gets passes 0 (or nothing); a
  // clamp would turn that into 1, which is usually already taken.
  var requested = parseInt(id, 10);
  var wanted = isFinite(requested) && requested >= 1 && requested <= MAX_WORKSPACES
    ? requested
    : nextFreeId(next);
  if (!wanted || workspaceIndexById(next, wanted) !== -1) return next;
  next.workspaces.push(defaultWorkspace(wanted));
  return normalize(next);
}

function removeWorkspace(config, id) {
  var next = normalize(config);
  var out = [];
  for (var i = 0; i < next.workspaces.length; i++) {
    if (next.workspaces[i].id !== id) out.push(next.workspaces[i]);
  }
  next.workspaces = out;
  return normalize(next);
}

// Reordering swaps the *ids* of two adjacent rows, keeping everything else
// attached to the row. That is what "move workspace 3 up" means to a user:
// the icons and apps move, the SUPER+N key stays where it is on the keyboard.
function moveWorkspace(config, id, delta) {
  var next = normalize(config);
  var index = workspaceIndexById(next, id);
  if (index === -1) return next;
  var target = index + (delta < 0 ? -1 : 1);
  if (target < 0 || target >= next.workspaces.length) return next;
  var a = next.workspaces[index];
  var b = next.workspaces[target];
  var swap = a.id;
  a.id = b.id;
  b.id = swap;
  return normalize(next);
}

// Chromium derives a web app's window class from the URL and the profile
// directory. Predicting it is the single biggest usability win over
// hand-editing, because it is otherwise only discoverable from
// `hyprctl clients` while the window happens to be open.
//
// The shape below was read off three live windows on a real machine:
//
//   https://web.whatsapp.com/            -> chrome-web.whatsapp.com__-Profile_2
//   https://app.slack.com/client/T6.../  -> chrome-app.slack.com__client_T6..._-Profile_2
//   https://claude.ai/                   -> chrome-claude.ai__-Profile_2
//
// So: dots in the host are KEPT, every "/" becomes "_", and the host/path
// boundary contributes one extra "_" of its own.
function chromiumWebAppClass(url, profileDirectory) {
  var raw = cleanString(url, 512);
  if (!raw) return "";
  var stripped = raw.replace(/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//, "");
  stripped = stripped.replace(/[?#].*$/, "");
  var slash = stripped.indexOf("/");
  var host = slash === -1 ? stripped : stripped.slice(0, slash);
  var path = slash === -1 ? "/" : stripped.slice(slash);
  if (!path) path = "/";
  var slug = host + "_" + path.replace(/\//g, "_");
  var profile = cleanString(profileDirectory, 64) || "Default";
  var suffix = profile.replace(/\s+/g, "_");
  return "chrome-" + slug + "-" + suffix;
}

// A class string is a regex in Hyprland. Escaping it for an exact match is
// what "Grab focused window" wants by default.
function escapeClassRegex(value) {
  var text = cleanString(value, 512);
  if (!text) return "";
  return "^" + text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "$";
}

// ------------------------------------------------- desktop entry -> class
//
// A window rule matches a Wayland app-id; a desktop entry does not carry one
// reliably. Of the 74 entries in /usr/share/applications on a stock Omarchy,
// 20 set StartupWMClass and 54 do not, chromium.desktop ships the
// unsubstituted placeholder "@@startup_wm_class", a Chromium PWA advertises
// "crx_<id>" while the compositor sees "chrome-<id>-Profile_N", and every
// Omarchy webapp entry sets nothing at all.
//
// So this is a ladder of rules ordered most-specific first, each one calibrated
// against a window that was actually open on a real machine, and each one
// reporting how much it should be trusted. The UI shows the confidence next to
// "Grab focused window", which is the ground truth whenever this guesses wrong.
//
// `entry` is a plain object shaped like a Quickshell DesktopEntry:
// { id, name, icon, execString, startupClass }.
function deriveClass(entry) {
  var miss = { "class": "", source: "", confidence: "" };
  if (!isObject(entry)) return miss;

  var id = cleanString(entry.id, 128);
  if (id.slice(-8) === ".desktop") id = id.slice(0, -8);
  var exec = cleanString(entry.execString, 1024);
  var startup = cleanString(entry.startupClass, 128);

  // 1. An Omarchy webapp. The profile directory is not knowable from the entry
  //    (omarchy-launch-webapp passes no --profile-directory and Chromium uses
  //    `last_used`), so the profile tail is a wildcard — the same shape
  //    Omarchy's own browser.lua rules use.
  var webapp = exec.match(/^omarchy-launch-webapp\s+(?:"([^"]*)"|'([^']*)'|(\S+))/);
  if (webapp) {
    var url = webapp[1] || webapp[2] || webapp[3] || "";
    var slug = stripProfileTail(chromiumWebAppClass(url, ""));
    if (slug) return wildcardProfile(slug, "webapp", "high");
  }

  // 2. A terminal app launched with an explicit app-id. This has to come
  //    BEFORE the Chromium rules: Omarchy's TUI entries are
  //    `xdg-terminal-exec --app-id=TUI.tile -e ...`, and a rule looking only
  //    for --app-id would claim them as Chromium web apps.
  var explicitAppId = exec.match(/(?:xdg-terminal-exec|omarchy-launch-tui)[^\n]*?--app-id=(?:"([^"]*)"|'([^']*)'|(\S+))/);
  if (explicitAppId) {
    var termId = explicitAppId[1] || explicitAppId[2] || explicitAppId[3] || "";
    if (termId) return { "class": escapeClassRegex(termId), source: "tui", confidence: "high" };
  }

  // 3. Omarchy's TUI launcher with no app-id names the window
  //    org.omarchy.<command> (omarchy-launch-tui:10).
  var tui = exec.match(/^omarchy-launch-tui\s+(\S+)/);
  if (tui) {
    var base = String(tui[1]).replace(/^.*\//, "");
    return { "class": escapeClassRegex("org.omarchy." + base), source: "tui", confidence: "high" };
  }

  // 4. A Chromium app-id window. NEVER StartupWMClass here: it says
  //    crx_<id>, which is not what the compositor sees. Guarded on the
  //    executable actually being a Chromium-family browser, because
  //    --app-id is not a flag only Chromium has.
  var argv0Raw = (exec.split(/\s+/)[0] || "").replace(/^.*\//, "");
  var isBrowser = /^(chromium|chrome|google-chrome|brave|vivaldi|thorium|microsoft-edge)/i.test(argv0Raw);
  var appId = exec.match(/--app-id=([A-Za-z0-9]+)/);
  if (isBrowser && appId) return wildcardProfile("chrome-" + appId[1], "appId", "high");

  // 5. A Chromium --app=URL window.
  var appUrl = exec.match(/--app=(?:"([^"]*)"|'([^']*)'|(\S+))/);
  if (appUrl) {
    var slug3 = stripProfileTail(chromiumWebAppClass(appUrl[1] || appUrl[2] || appUrl[3] || "", ""));
    if (slug3) return wildcardProfile(slug3, "webapp", "high");
  }

  // 6. StartupWMClass, when it is not chromium.desktop's unsubstituted
  //    placeholder. Emitted case-insensitively on the first letter, because
  //    spotify.desktop says "spotify" and the live window says "Spotify".
  if (startup && !/^@@/.test(startup)) {
    return { "class": caseInsensitiveFirst(startup), source: "startupClass", confidence: "high" };
  }

  // 7. A reverse-DNS id is nearly always the app-id too (org.gnome.Nautilus).
  if (/^[A-Za-z0-9]+(\.[A-Za-z0-9_-]+){2,}$/.test(id)) {
    return { "class": escapeClassRegex(id), source: "reverseDns", confidence: "medium" };
  }

  // 8. The executable's basename. Right for foot and chromium, wrong for
  //    anything launched through a wrapper.
  var argv0 = argv0Raw.replace(/-(?:stable|bin|git)$/, "");
  if (argv0) return { "class": escapeClassRegex(argv0), source: "exec", confidence: "low" };

  // 9. The id itself.
  if (id) return { "class": escapeClassRegex(id), source: "id", confidence: "low" };
  return miss;
}

// chromiumWebAppClass() always appends a profile directory, and "Default" is
// what it uses when none is given. The real profile is not knowable from a
// desktop entry — omarchy-launch-webapp passes no --profile-directory and
// Chromium picks `last_used` — so the tail is removed and wildcarded instead.
function stripProfileTail(slug) {
  var text = String(slug || "");
  return text.slice(-8) === "-Default" ? text.slice(0, -8) : text;
}

// "chrome-web.whatsapp.com__" -> "^chrome-web\.whatsapp\.com__-.*$".
// The escape runs first so the wildcard is the only unescaped metacharacter.
function wildcardProfile(slug, source, confidence) {
  var escaped = escapeClassRegex(slug);
  if (!escaped) return { "class": "", source: "", confidence: "" };
  return {
    "class": escaped.replace(/\$$/, "-.*$"),
    source: source,
    confidence: confidence
  };
}

// Hyprland's regex flavour has no portable inline (?i), so only the first
// letter — which is where the desktop-entry/compositor disagreements live — is
// widened into a character class.
function caseInsensitiveFirst(value) {
  var escaped = escapeClassRegex(value);
  if (!escaped) return "";
  var body = escaped.slice(1, escaped.length - 1);
  var head = body.charAt(0);
  if (!/[A-Za-z]/.test(head)) return escaped;
  return "^[" + head.toUpperCase() + head.toLowerCase() + "]" + body.slice(1) + "$";
}

function classConfidence(source) {
  switch (String(source)) {
    case "webapp":
    case "appId":
    case "tui":
    case "startupClass":
      return "high";
    case "reverseDns":
      return "medium";
    case "exec":
    case "id":
      return "low";
    case "manual":
      return "manual";
    default:
      return "";
  }
}

// A short phrase for the badge next to the class field.
function classSourceLabel(source) {
  switch (String(source)) {
    case "webapp": return "from the web app URL";
    case "appId": return "from the Chromium app id";
    case "tui": return "from the terminal app id";
    case "startupClass": return "from StartupWMClass";
    case "reverseDns": return "from the entry id";
    case "exec": return "guessed from the command";
    case "id": return "guessed from the entry id";
    case "manual": return "you set this";
    default: return "";
  }
}
