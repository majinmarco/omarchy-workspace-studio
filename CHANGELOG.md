# Changelog

All notable changes to Workspace Studio are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[semantic versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.1] — 2026-09-09

### Added

- **A warning when two apps on different workspaces match the same window.**
  Hyprland applies one workspace rule to a matching window, so a `chromium` on
  workspace 1 and a `^chromium$` on workspace 6 do not split the browser between
  them — every window lands on one of the two, and nothing anywhere said so.
  `validate()` now raises a warning on each of the two rows, naming the other
  workspace and the app on it. Fields are compared like for like, and the two
  spellings above compare equal because Hyprland matches a regex against the
  whole property: one leading `^` and one unescaped trailing `$` are stripped
  before the comparison. The same match twice *inside* one workspace stays
  silent — two windows of the same app is what that means — and patterns that
  merely overlap (`(a|b)` against `a`) are out of scope.

### Notes

- Validation only. No change to the generated Lua, the document format or the
  schema; the golden 0.1.0 fixtures still compile byte for byte.

## [0.2.0] — 2026-09-09

Two features: pick apps from the list of installed applications instead of
typing a command, and draw a workspace's layout with the mouse instead of
guessing at layout options.

### Added

- **App picker.** Press **Pick an app…** on an app row, **f** anywhere in the
  editor, or **Add app**, and search the applications installed on the machine.
  The list, its ordering and its icons are the launcher's, because the ranking
  is a vendored copy of Omarchy's own `AppSearch.js` and the entries come
  straight from Quickshell's `DesktopEntries`; `launcher.hides` is honoured, so
  apps already hidden from the launcher stay hidden here. Picking one fills in
  the name, the window class and the launch command.
- **A class-confidence badge.** A desktop entry does not reliably carry the
  Wayland app-id a window rule has to match, so the class is derived by a
  ladder of rules and the row says how far it had to fall — from a web app's
  URL or a `StartupWMClass` (high) down to the executable's name (low). A low
  confidence also raises a validation warning. **Grab focused window** sits
  next to the badge as the escape hatch, and a class you edit yourself is
  marked "you set this" and is never overwritten by a later pick.
- **A layout canvas** for each workspace, between the compositor settings and
  the apps. Split a tile with **+** or by dropping another tile on its edge,
  swap two tiles by dropping one on the middle of the other, drag a divider to
  resize, double-click one to flip it between side-by-side and stacked, and
  click a tile to choose which app lives in it. Seven presets — columns, rows,
  main left/right/top/bottom, grid — rebuild the whole arrangement from the
  app count.
- **Three layout modes.** *Off* emits nothing, and is what every existing
  config stays on. *Tiled* turns the drawing into a `layout` /`layout_opts`
  pair on the workspace rule, so windows still tile. *Exact* emits each
  rectangle as a `float` + `size "W% H%"` + `move "X% Y%"` window rule, which
  reproduces any arrangement but stops those windows tiling.
- **A fidelity note** under the canvas, because Tiled mode cannot render
  everything. Two tiles and a main-plus-stack map onto `master` exactly; other
  arrangements are approximated, and the canvas names what they will be
  approximated as and offers a one-click switch to Exact.
- **A warning when the layout toggle wins.** If
  `~/.local/state/omarchy/workspace-layouts/<id>.lua` exists — written by
  `omarchy-hyprland-workspace-layout-toggle` — Omarchy loads it after this
  plugin's file, and Tiled mode on that workspace will look like it did
  nothing. The canvas now says so.
- `Layout.js`, a pure-JS slicing-tree module (normalize, rectangles,
  splitters, hit-testing, the seven edits, the presets, and the projection onto
  what the compositor can be told), plus `AppSearch.js`. Both are covered by
  `node --test`: 82 cases became 170, including a golden pair — a byte copy of
  a real 0.1.0 document and of the Lua it compiled into — that proves
  everything here is additive.

### Changed

- **A typed command now beats a shared launcher.** The ladder is: a command you
  typed, then a `launchers` entry, then the picked app's
  `gtk-launch '<id>.desktop'`. Previously a launcher prefix beat a typed
  command. No document written by 0.1.0 has a `launchers` entry and no UI ever
  wrote one, so this is invisible in practice — but it is deliberate, so that
  the manual field is always the last word.
- **`layout` and `layout_opts` are whitelisted on the way out.** Hyprland
  accepts `layout = "bogus"` and `layout_opts = { bogus_opt = 1 }` without
  complaint and then ignores them, so a typo used to be a silent no-op with no
  error anywhere. The generator now refuses any layout name outside
  dwindle/master/scrolling, any option outside the seven it knows, and any
  master orientation outside left/right/top/bottom/center.
- The workspace list summary names the layout preset, so a row reads
  `main left · Slack, WhatsApp`.

### Notes

- Both new keys are additive and optional: `apps[].desktop` and
  `workspaces[].arrangement`. Neither is written unless it is used —
  `arrangement` is omitted entirely while the mode is "off" — so a 0.1.0
  document round-trips through 0.2.0 byte for byte and compiles to byte-identical
  Lua. There is a test for exactly that.
- The canvas's data lives under `arrangement` rather than `layout` because
  `layout` was already the layout *name*, and the two coexist on purpose: an
  explicit layout choice beats the canvas.
- The plugin declares no new kinds and no new capabilities. It now reads the
  installed `.desktop` files, indirectly, through the same `DesktopEntries`
  singleton the shell already uses — and writes nothing new.
- Deferred: driving dwindle's guillotine with `preselect` and a
  `window.open` arranger, per-node ratios inside a master stack, and importing
  an existing arrangement from live window geometry. None of them can be done
  reliably yet: the dwindle split tree is private, no `hyprctl` request exposes
  it, and `layoutmsg` only reaches the active workspace — so nothing can drive
  the tiler and then check whether it worked. 0.2.0 stays declarative.

## [0.1.0] — 2026-09-09

First release.

### Added

- **Bar widget** (`Workspaces.qml`): one button per workspace, labelled with the
  icon and name from the config. Left click focuses, right click opens the
  editor. Fourteen presentational settings — display mode, empty-workspace
  handling, focus indicator style/colour/thickness, width mode and minimum,
  spacing, icon size, tooltip mode, right-click and wheel actions — all
  reachable from `omarchy bar set` and from the editor's Bar tab.
- **Editor overlay** (`Studio.qml`): add, remove and reorder workspaces; set
  icon, name, colour, monitor, layout, persistent and default flags, and the
  advanced gap/border/decoration rules; add apps with a window match and a
  launch mode; preview the generated Lua as a diff; apply; revert the last
  apply.
- **Icon picker** over a curated `icons.json` of ~390 Nerd Font glyphs, every
  codepoint verified against the installed font's `cmap` table and named from
  its `post` table, plus a free-text field for anything else.
- **Grab focused window**: reads `hyprctl activewindow -j` and fills in the
  window class, anchored and escaped as a regex. Defaults to `initial_class`,
  which survives apps that rewrite their class after mapping.
- **Import wizard**: reads the `o.window` rules in `hyprland.lua`, the
  `o.launch_on_start` / `o.exec_on_start` ladder in `autostart.lua` (resolving
  `local` variables, `o.launch()` wrappers and `sleep N &&` prefixes) and the
  icon map of a cloned bar widget, matches each launch to its window rule by
  predicting the class Chromium assigns, and offers to convert the exec-once
  ladder into `on_created_empty`. It prints the source lines to remove and never
  edits those files.
- **`bin/workspace-studio-apply`**: reloads Hyprland (`config-only` by default),
  then checks `hyprctl configerrors`, that no bind has an empty key, and that no
  workspace key is bound twice. Notifies and exits non-zero on any of those.
- `config.schema.json` documenting the stored document, and 82 `node --test`
  cases covering Lua quoting and injection, bind generation for fewer than ten
  and exactly ten workspaces, unbinding of removed workspaces, all three launch
  modes, window-rule emission, config migration and validation, and the
  importer.

### Notes

- Keybinds are emitted as keysyms only, never as `code:NN`, and both spellings
  are unbound before rebinding. Hyprland 0.56.2 silently drops `code:NN` bind
  keycodes, after which they match on the modifier mask alone and one
  `SUPER`+key press fires every bind sharing that mask.
- Verified on Hyprland 0.56.2 that `hyprctl reload` does not refire
  `hyprland.start`, so applying never relaunches autostart apps. The generator
  carries no re-entry guard as a result.
