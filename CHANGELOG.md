# Changelog

All notable changes to Workspace Studio are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[semantic versioning](https://semver.org/spec/v2.0.0.html).

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
