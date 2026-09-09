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

function normalizeApp(raw) {
  var app = defaultApp();
  if (!isObject(raw)) return app;
  app.label = cleanString(raw.label, 48);
  app.match = normalizeMatch(raw.match);
  app.launch = normalizeLaunch(raw.launch);
  app.rules = normalizeAppRules(raw.rules);
  return app;
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

function resolveCommand(config, app) {
  if (!app || !app.launch) return "";
  var launchers = config && isObject(config.launchers) ? config.launchers : {};
  var prefix = "";
  if (app.launch.launcher && launchers[app.launch.launcher]) {
    prefix = String(launchers[app.launch.launcher].command || "");
  }
  var args = app.launch.args || "";
  var direct = app.launch.command || "";
  if (prefix) return args ? prefix + " " + args : prefix;
  return direct;
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
        errors.push({ path: appWhere + ".launch.command", message: "Launch mode needs a command." });
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
// directory: chrome-<host+path with . and / replaced by _>-Profile_<n>.
// Predicting it is the single biggest usability win over hand-editing, because
// it is otherwise only discoverable from `hyprctl clients`.
function chromiumWebAppClass(url, profileDirectory) {
  var raw = cleanString(url, 512);
  if (!raw) return "";
  var stripped = raw.replace(/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//, "");
  stripped = stripped.replace(/[?#].*$/, "");
  stripped = stripped.replace(/\/+$/, "/");
  var slug = stripped.replace(/[./]/g, "_");
  var profile = cleanString(profileDirectory, 64) || "Default";
  var suffix = profile === "Default" ? "Default" : profile.replace(/\s+/g, "_");
  return "chrome-" + slug + "-" + suffix;
}

// A class string is a regex in Hyprland. Escaping it for an exact match is
// what "Grab focused window" wants by default.
function escapeClassRegex(value) {
  var text = cleanString(value, 512);
  if (!text) return "";
  return "^" + text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "$";
}
