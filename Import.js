// Workspace Studio — first-run importer.
//
// Reads the three places an Omarchy user hand-writes a workspace layout today
// and turns them into a workspace-studio document:
//
//   ~/.config/hypr/hyprland.lua    o.window(...)/hl.window_rule(...)  -> apps[].match
//   ~/.config/hypr/autostart.lua   o.launch_on_start / o.exec_on_start -> apps[].launch
//   a bar clone's Workspaces.qml   the hard-coded icons map            -> workspaces[].icon
//
// It NEVER writes to those files. It reports the exact lines it read so the
// user can remove them themselves, which is what the marketplace's "does not
// overwrite user configuration without explicit consent" rule requires and
// what anyone would want anyway.
//
// Pure JavaScript: no QML globals, no Node globals. Depends on Config.js
// being loaded into the same scope (chromiumWebAppClass, defaultApp, ...).

// Config.js supplies the document constructors this file builds on. Node's vm
// sandbox runs all three scripts in one scope, so they resolve directly; QML
// gives every .js resource its own scope, so Studio.qml calls
// Import.useConfig(Config) once at startup and everything routes through here.
var __config = null;

function useConfig(module) {
  __config = module;
}

function config() {
  if (__config) return __config;
  if (typeof normalize === "function") {
    __config = {
      empty: empty,
      normalize: normalize,
      defaultApp: defaultApp,
      defaultWorkspace: defaultWorkspace,
      chromiumWebAppClass: chromiumWebAppClass
    };
    return __config;
  }
  throw new Error("Import.js needs Config.js: call useConfig(Config) first.");
}

// A tiny evaluator for the subset of Lua string expressions these files use:
// literals, `local name = "..."` variables, `..` concatenation, and the
// o.launch() wrapper. Anything it does not understand is reported as
// unparsed rather than guessed at.
function collectLocals(text) {
  var vars = {};
  var re = /^\s*local\s+([A-Za-z_][A-Za-z0-9_]*)\s*=\s*"((?:[^"\\]|\\.)*)"/gm;
  var match;
  while ((match = re.exec(String(text || ""))) !== null) {
    vars[match[1]] = unescapeLua(match[2]);
  }
  return vars;
}

function unescapeLua(value) {
  return String(value === undefined || value === null ? "" : value)
    .replace(/\\n/g, "\n")
    .replace(/\\t/g, "\t")
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, "\\");
}

// Returns { ok, value, launched } for a concatenation expression.
function evalLuaString(expression, vars) {
  var text = String(expression === undefined || expression === null ? "" : expression).trim();
  var launched = false;

  // Unwrap one level of o.launch( ... ) wherever it appears; the flag tells
  // the caller the command was already uwsm-wrapped in the source.
  var launchRe = /o\.launch\(\s*([\s\S]*?)\s*\)(?=\s*(?:\.\.|$))/;
  var launchMatch = launchRe.exec(text);
  if (launchMatch) {
    launched = true;
    text = text.slice(0, launchMatch.index) + launchMatch[1] + text.slice(launchMatch.index + launchMatch[0].length);
  }

  var parts = splitConcat(text);
  var out = "";
  for (var i = 0; i < parts.length; i++) {
    var part = parts[i].trim();
    if (part === "") continue;
    var literal = /^"((?:[^"\\]|\\.)*)"$/.exec(part);
    if (literal) {
      out += unescapeLua(literal[1]);
      continue;
    }
    if (Object.prototype.hasOwnProperty.call(vars || {}, part)) {
      out += vars[part];
      continue;
    }
    return { ok: false, value: text, launched: launched };
  }
  return { ok: true, value: out, launched: launched };
}

// Split on `..` that is not inside a string literal.
function splitConcat(text) {
  var parts = [];
  var current = "";
  var inString = false;
  var escaped = false;
  for (var i = 0; i < text.length; i++) {
    var ch = text.charAt(i);
    if (inString) {
      current += ch;
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') { inString = true; current += ch; continue; }
    if (ch === "." && text.charAt(i + 1) === "." && text.charAt(i + 2) !== ".") {
      parts.push(current);
      current = "";
      i++;
      continue;
    }
    current += ch;
  }
  parts.push(current);
  return parts;
}

// Lua's "--" only starts a comment outside a string literal, and these lines
// are full of "--app-id=" and "--profile-directory=". Scan for it properly.
function lineComment(line) {
  var text = String(line || "");
  var inString = false;
  var escaped = false;
  for (var i = 0; i < text.length; i++) {
    var ch = text.charAt(i);
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') { inString = true; continue; }
    if (ch === "-" && text.charAt(i + 1) === "-") {
      return text.slice(i + 2).replace(/^\s+|\s+$/g, "");
    }
  }
  return "";
}

// --------------------------------------------------------- window rules

// Finds every rule that pins a window class to a workspace, in either the
// Omarchy sugar (`o.window`) or the raw form (`hl.window_rule`).
function scanWindowRules(text) {
  var lines = String(text || "").split("\n");
  var vars = collectLocals(text);
  var out = [];

  for (var i = 0; i < lines.length; i++) {
    var line = lines[i];
    if (/^\s*--/.test(line)) continue;

    var comment = lineComment(line);

    var entry = null;
    var sugar = /o\.window\(\s*"((?:[^"\\]|\\.)*)"\s*,\s*\{([\s\S]*?)\}\s*\)/.exec(line);
    if (sugar) {
      entry = { match: { class: unescapeLua(sugar[1]) }, body: sugar[2] };
    } else {
      var sugarTable = /o\.window\(\s*\{([\s\S]*?)\}\s*,\s*\{([\s\S]*?)\}\s*\)/.exec(line);
      if (sugarTable) {
        entry = { match: parseMatchTable(sugarTable[1]), body: sugarTable[2] };
      } else {
        var raw = /hl\.window_rule\(\s*\{([\s\S]*)\}\s*\)/.exec(line);
        if (raw) {
          var inner = raw[1];
          var matchTable = /match\s*=\s*\{([\s\S]*?)\}/.exec(inner);
          entry = { match: matchTable ? parseMatchTable(matchTable[1]) : {}, body: inner };
        }
      }
    }
    if (!entry) continue;

    var workspace = /workspace\s*=\s*"([^"]*)"/.exec(entry.body);
    if (!workspace) continue;
    var target = workspace[1];
    var silent = / silent\s*$/.test(target);
    var id = parseInt(target, 10);
    if (!isFinite(id) || id < 1 || id > 12) continue;

    out.push({
      id: id,
      match: entry.match,
      silent: silent,
      comment: comment,
      line: line.replace(/\s+$/, ""),
      lineNumber: i + 1
    });
  }

  // vars is collected for symmetry with the autostart scan; window rules in
  // the wild are always literal.
  void vars;
  return out;
}

function parseMatchTable(body) {
  var out = {};
  var map = {
    "class": "class",
    "title": "title",
    "initial_class": "initialClass",
    "initialClass": "initialClass",
    "initial_title": "initialTitle",
    "initialTitle": "initialTitle"
  };
  var re = /([A-Za-z_]+)\s*=\s*"((?:[^"\\]|\\.)*)"/g;
  var match;
  while ((match = re.exec(String(body || ""))) !== null) {
    var key = map[match[1]];
    if (key) out[key] = unescapeLua(match[2]);
  }
  return out;
}

// ------------------------------------------------------------ autostart

function scanAutostart(text) {
  var lines = String(text || "").split("\n");
  var vars = collectLocals(text);
  var out = [];

  for (var i = 0; i < lines.length; i++) {
    var line = lines[i];
    if (/^\s*--/.test(line)) continue;

    var comment = lineComment(line);

    var call = /o\.(launch_on_start|exec_on_start)\(\s*([\s\S]*?)\s*\)\s*(?:--.*)?$/.exec(line);
    if (!call) continue;

    var evaluated = evalLuaString(call[2], vars);
    var command = evaluated.value;
    var delaySec = 0;

    var sleep = /^sleep\s+(\d+)\s*&&\s*/.exec(command);
    if (sleep) {
      delaySec = parseInt(sleep[1], 10) || 0;
      command = command.slice(sleep[0].length);
    }
    command = command.replace(/^uwsm-app\s+--\s+/, "").replace(/^\s+|\s+$/g, "");

    // The final "land on workspace N" dispatch is apply.landOn, not an app.
    var landOn = /^hyprctl\s+dispatch\s+workspace\s+(\d+)$/.exec(command);

    out.push({
      kind: call[1],
      command: command,
      delaySec: delaySec,
      landOn: landOn ? parseInt(landOn[1], 10) : 0,
      parsed: evaluated.ok,
      comment: comment,
      line: line.replace(/\s+$/, ""),
      lineNumber: i + 1
    });
  }
  return out;
}

// ------------------------------------------------------- bar clone icons

// A hand-edited clone of omarchy.workspaces carries its icons as a literal
// map keyed by workspace id. That map is exactly what this plugin generalises,
// so importing it reproduces the user's current bar on the first run.
function scanBarIcons(text) {
  var out = {};
  var block = /icons\s*:\s*\(\{([\s\S]*?)\}\)/.exec(String(text || ""));
  if (!block) return out;
  var re = /(\d+)\s*:\s*"((?:[^"\\]|\\.)*)"/g;
  var match;
  while ((match = re.exec(block[1])) !== null) {
    out[parseInt(match[1], 10)] = decodeQmlEscapes(match[2]);
  }
  return out;
}

// QML string literals spell supplementary-plane glyphs as surrogate pairs.
function decodeQmlEscapes(value) {
  return String(value || "").replace(/\\u([0-9a-fA-F]{4})/g, function (_, hex) {
    return String.fromCharCode(parseInt(hex, 16));
  });
}

// ------------------------------------------------------------- assembling

// Guess the window class a launch command will produce, so a launch can be
// attached to the window rule that routes it.
function predictedClass(command) {
  var text = String(command || "");
  var profile = "";
  var profileMatch = /--profile-directory=(?:'([^']*)'|"([^"]*)"|(\S+))/.exec(text);
  if (profileMatch) profile = profileMatch[1] || profileMatch[2] || profileMatch[3] || "";

  var app = /--app=(?:'([^']*)'|"([^"]*)"|(\S+))/.exec(text);
  if (app) return config().chromiumWebAppClass(app[1] || app[2] || app[3], profile);

  var appId = /--app-id=(?:'([^']*)'|"([^"]*)"|(\S+))/.exec(text);
  if (appId) {
    var id = appId[1] || appId[2] || appId[3];
    var suffix = profile ? profile.replace(/\s+/g, "_") : "Default";
    return "chrome-" + id + "-" + suffix;
  }

  var first = text.replace(/^\s+/, "").split(/\s+/)[0] || "";
  return first.split("/").pop();
}

// A rule's class is a regex; strip the regex furniture to compare it with a
// concrete class string.
function looseClass(pattern) {
  return String(pattern || "")
    .replace(/^\^|\$$/g, "")
    .replace(/\\/g, "")
    .toLowerCase();
}

function classesRelated(ruleClass, candidate) {
  var a = looseClass(ruleClass);
  var b = String(candidate || "").toLowerCase();
  if (!a || !b) return false;
  if (a === b) return true;
  if (a.indexOf(b) !== -1 || b.indexOf(a) !== -1) return true;
  // "(foot|org\.codeberg\.dnkl\.foot)" against "foot"
  var alternatives = a.replace(/^\(|\)$/g, "").split("|");
  for (var i = 0; i < alternatives.length; i++) {
    if (alternatives[i] && (alternatives[i] === b || b.indexOf(alternatives[i]) !== -1)) return true;
  }
  return false;
}

// Build a config from whatever was found. `sources` is
// { windowRules[], autostart[], icons{}, launchMode }.
function buildConfig(sources) {
  var input = sources || {};
  var rules = input.windowRules || [];
  var launches = input.autostart || [];
  var icons = input.icons || {};
  // onCreatedEmpty is the recommended default: no boot cost and no sleep
  // races. "autostart" reproduces the user's existing exec-once ladder.
  var mode = input.launchMode === "autostart" ? "autostart" : (input.launchMode === "none" ? "none" : "onCreatedEmpty");

  var built = config().empty();
  var byId = {};
  var i;

  function ensure(id) {
    if (!byId[id]) {
      byId[id] = config().defaultWorkspace(id);
      built.workspaces.push(byId[id]);
    }
    return byId[id];
  }

  for (var key in icons) {
    if (!Object.prototype.hasOwnProperty.call(icons, key)) continue;
    var iconId = parseInt(key, 10);
    if (!isFinite(iconId) || iconId < 1 || iconId > 12) continue;
    ensure(iconId).icon = String(icons[key] || "");
  }

  for (i = 0; i < rules.length; i++) {
    var rule = rules[i];
    var workspace = ensure(rule.id);
    var app = config().defaultApp();
    app.label = rule.comment || "";
    if (rule.match.class) app.match.class = rule.match.class;
    if (rule.match.title) app.match.title = rule.match.title;
    if (rule.match.initialClass) app.match.initialClass = rule.match.initialClass;
    if (rule.match.initialTitle) app.match.initialTitle = rule.match.initialTitle;
    app.rules.silent = rule.silent === true;
    workspace.apps.push(app);
  }

  var unmatched = [];
  for (i = 0; i < launches.length; i++) {
    var launch = launches[i];
    if (launch.landOn) {
      built.apply.landOn = launch.landOn;
      continue;
    }
    if (!launch.command) continue;

    var candidate = predictedClass(launch.command);
    var placed = false;
    for (var w = 0; w < built.workspaces.length && !placed; w++) {
      var target = built.workspaces[w];
      for (var a = 0; a < target.apps.length && !placed; a++) {
        var existing = target.apps[a];
        if (existing.launch.mode !== "none") continue;
        if (!classesRelated(existing.match.class || existing.match.initialClass, candidate)) continue;
        existing.launch.mode = mode;
        existing.launch.command = launch.command;
        existing.launch.delaySec = mode === "autostart" ? launch.delaySec : 0;
        if (!existing.label && launch.comment) existing.label = launch.comment;
        placed = true;
      }
    }
    if (!placed) unmatched.push(launch);
  }

  if (built.apply.landOn && mode !== "autostart") built.apply.landOn = 0;

  return { config: config().normalize(built), unmatchedLaunches: unmatched };
}

// The report the wizard shows and the user acts on. Nothing here edits a file.
function removalReport(sources) {
  var input = sources || {};
  var lines = [];

  function block(path, entries) {
    if (!entries || entries.length === 0) return;
    lines.push("# " + path);
    for (var i = 0; i < entries.length; i++) {
      lines.push("  " + entries[i].lineNumber + ":  " + entries[i].line.replace(/^\s+/, ""));
    }
    lines.push("");
  }

  block(input.windowRulesPath || "~/.config/hypr/hyprland.lua", input.windowRules);
  block(input.autostartPath || "~/.config/hypr/autostart.lua", input.autostart);

  if (lines.length === 0) return "";
  return "Comment out or delete these lines, then run `hyprctl reload`.\n" +
    "Workspace Studio now owns the same rules; leaving both in place would\n" +
    "register every window rule twice and launch every app twice.\n\n" +
    lines.join("\n");
}
