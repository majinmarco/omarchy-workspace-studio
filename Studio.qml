pragma ComponentBehavior: Bound

import QtQuick
import Quickshell
import Quickshell.Io
import Quickshell.Wayland
import Quickshell.Hyprland
import qs.Commons
import qs.Ui
import "components"
import "Config.js" as Config
import "HyprGen.js" as HyprGen
import "Import.js" as Importer
import "Layout.js" as Layout

// Workspace Studio — the editor.
//
// A fullscreen overlay on the shell's menu surface tokens, opened by right
// clicking the bar widget or by `omarchy-shell shell toggle
// majinmarco.workspace-studio '{}'`.
//
// It owns two files and nothing else:
//
//   ~/.config/omarchy/workspace-studio.json                     the source of truth
//   ~/.local/state/omarchy/toggles/hypr/zz-workspace-studio.lua the compiled fragment
//
// Neither is written until Apply, and Preview shows the exact diff first. The
// user's own ~/.config/hypr/*.lua files are read for the import wizard and
// never written.
Item {
  id: root

  // Injected by the shell for overlay-kind plugins.
  property string omarchyPath: Quickshell.env("OMARCHY_PATH")
  property var shell: null
  property var manifest: null

  property bool opened: false

  readonly property string home: Quickshell.env("HOME")
  readonly property string pluginId: (manifest && manifest.id) || "majinmarco.workspace-studio"
  readonly property string sourceDir: (manifest && manifest.__sourceDir)
    || (home + "/.config/omarchy/plugins/majinmarco.workspace-studio")
  readonly property string configPath: home + "/.config/omarchy/workspace-studio.json"
  readonly property string luaPath: home + "/.local/state/omarchy/toggles/hypr/zz-workspace-studio.lua"
  readonly property string backupPath: luaPath + ".bak"

  // ---------------------------------------------------------------- state

  property var config: Config.defaults()
  property bool dirty: false
  property bool everSaved: false
  property int selectedIndex: 0
  property int cursorIndex: 0
  property string tab: "workspaces"
  property string statusText: ""
  property bool statusIsError: false
  property var validation: ({ ok: true, errors: [], warnings: [] })

  property var monitors: []
  // Aspect and reserved-strip fraction of the first monitor, so the layout
  // canvas is the shape of the screen rather than a generic 16:9 box.
  property real monitorAspect: 16 / 9
  property real barReservePct: 0
  property var icons: []
  property var barSettings: ({})
  property string diskLua: ""
  property bool backupExists: false
  property int appsRevision: 0

  // Import wizard inputs, filled by the three FileViews below.
  property string hyprlandLua: ""
  property string autostartLua: ""
  property string cloneQml: ""
  property string clashingWidgetId: ""
  property bool importOffered: false

  readonly property color background: Color.menu.background
  readonly property color foreground: Color.menu.text
  readonly property color scrim: Color.menu.scrim
  readonly property var borderSpec: Border.surfaceSpec("menu", "border", Color.menu.border, Math.max(1, Style.space(2)))

  readonly property bool anyModalOpen: iconPicker.opened || preview.opened || wizard.opened
    || confirmDelete.opened || appPicker.opened
  readonly property var workspaces: config && config.workspaces ? config.workspaces : []
  readonly property var selectedWorkspace: selectedIndex >= 0 && selectedIndex < workspaces.length
    ? workspaces[selectedIndex]
    : null

  readonly property var tabOptions: [
    { value: "workspaces", label: "Workspaces" },
    { value: "bar", label: "Bar" },
    { value: "keys", label: "Keys & apply" }
  ]

  // ------------------------------------------------------------ lifecycle

  function open(payloadJson) {
    root.opened = true
    root.reloadEverything()
    Qt.callLater(function () { keyCatcher.forceActiveFocus() })
  }

  function close() {
    root.opened = false
  }

  function dismiss() {
    root.opened = false
    if (root.shell && typeof root.shell.hide === "function") root.shell.hide(root.pluginId)
  }

  function toggle() {
    if (root.opened) root.dismiss()
    else root.open("{}")
  }

  function reloadEverything() {
    configFile.reload()
    luaFile.reload()
    shellConfigFile.reload()
    hyprlandFile.reload()
    autostartFile.reload()
    cloneFile.reload()
    monitorsProcess.running = true
    backupProbe.running = true
  }

  function loadConfig(text) {
    var parsed = Config.parse(text)
    if (parsed) {
      root.config = parsed
      root.everSaved = true
    } else {
      // No file yet. Start from an empty document so the import wizard can
      // tell "nothing configured" from "five blank workspaces".
      root.config = Config.empty()
      root.everSaved = false
    }
    root.dirty = false
    root.selectedIndex = 0
    root.appsRevision++
    root.revalidate()
    importProbe.restart()
  }

  function revalidate() {
    root.validation = Config.validate(root.config)
  }

  // The config object is mutated in place by the detail controls, because
  // replacing it would rebuild every delegate and take the text cursor with
  // it. touched() is how they say "something changed".
  function touched() {
    root.dirty = true
    root.config = Config.normalize(root.config)
    root.revalidate()
    root.rebuildRows()
  }

  function rebuildRows() {
    rows.clear()
    // Called from onConfigChanged, which can fire before the `workspaces`
    // binding has been established, so read the config directly.
    var list = root.config && root.config.workspaces ? root.config.workspaces : []
    for (var i = 0; i < list.length; i++) {
      var workspace = list[i]
      rows.append({
        rowWorkspaceId: workspace.id,
        rowKeyLabel: root.keyLabelFor(workspace.id),
        rowIcon: workspace.icon,
        rowName: workspace.name,
        rowSummary: root.summaryFor(workspace)
      })
    }
    if (root.selectedIndex >= rows.count) root.selectedIndex = Math.max(0, rows.count - 1)
    if (root.cursorIndex >= rows.count) root.cursorIndex = Math.max(0, rows.count - 1)
  }

  onConfigChanged: rebuildRows()

  function keyLabelFor(id) {
    var keysyms = root.config && root.config.binds ? root.config.binds.keysyms : []
    var sym = keysyms && keysyms[id - 1] ? keysyms[id - 1] : String(id)
    return sym
  }

  function summaryFor(workspace) {
    var bits = []
    if (workspace.monitor) bits.push(workspace.monitor)
    if (workspace.layout) bits.push(workspace.layout)
    if (workspace.arrangement && workspace.arrangement.mode !== "none") {
      var preset = Layout.detectPreset(workspace.arrangement.root)
      var shape = preset ? Layout.presetLabel(preset) : "custom"
      bits.push(workspace.arrangement.mode === "float" ? shape + " (exact)" : shape)
    }
    if (workspace.persistent) bits.push("persistent")
    if (workspace["default"]) bits.push("default")
    var apps = []
    var list = workspace.apps || []
    for (var i = 0; i < list.length; i++) {
      var app = list[i]
      apps.push(app.label || app.match.class || app.match.initialClass || app.match.title || "app")
    }
    if (apps.length) bits.push(apps.join(", "))
    return bits.join("  ·  ")
  }

  function isLive(id) {
    var values = Hyprland.workspaces.values
    for (var i = 0; i < values.length; i++) if (values[i].id === id) return true
    return false
  }

  // ------------------------------------------------------------- editing

  function selectRow(index) {
    if (index < 0 || index >= root.workspaces.length) return
    root.selectedIndex = index
    root.cursorIndex = index
    // No appsRevision bump: the detail pane already depends on the workspace
    // object, so changing the selection rebuilds its app rows on its own.
    // Bumping here as well tore every row down twice.
  }

  function addWorkspace() {
    var before = root.workspaces.length
    root.config = Config.addWorkspace(root.config, 0)
    if (root.workspaces.length === before) {
      root.setStatus("Twelve workspaces is the ceiling.", true)
      return
    }
    root.dirty = true
    root.revalidate()
    root.rebuildRows()
    root.selectRow(root.workspaces.length - 1)
  }

  function removeWorkspace(id) {
    root.config = Config.removeWorkspace(root.config, id)
    root.dirty = true
    root.revalidate()
    root.rebuildRows()
    root.selectRow(Math.min(root.selectedIndex, root.workspaces.length - 1))
  }

  function moveWorkspace(id, delta) {
    root.config = Config.moveWorkspace(root.config, id, delta)
    root.dirty = true
    root.revalidate()
    root.rebuildRows()
    root.selectRow(Math.max(0, Math.min(root.workspaces.length - 1, root.selectedIndex + delta)))
  }

  function addApp() {
    if (!root.selectedWorkspace) return
    root.selectedWorkspace.apps.push(Config.defaultApp())
    root.appsRevision++
    root.touched()
  }

  // Layout leaves address apps by array index, so removing an app from under
  // the tree would silently re-point every leaf after it. Re-index first, then
  // splice; Config.normalize would only clamp the now-out-of-range tail.
  function removeApp(index) {
    if (!root.selectedWorkspace) return
    var arrangement = root.selectedWorkspace.arrangement
    if (arrangement && arrangement.root) {
      arrangement.root = Layout.reindexAfterAppRemoval(arrangement.root, index)
    }
    root.selectedWorkspace.apps.splice(index, 1)
    root.appsRevision++
    root.touched()
  }

  // "Grab focused window" is how anyone actually discovers a class like
  // chrome-web.whatsapp.com__-Profile_2. index -1 means "into a new app".
  property int grabTargetIndex: -1
  function grabWindow(index) {
    if (!root.selectedWorkspace) return
    root.grabTargetIndex = index
    root.setStatus("Reading the focused window…", false)
    activeWindowProcess.running = true
  }

  function applyGrab(json) {
    var info = null
    try {
      info = JSON.parse(json)
    } catch (error) {
      root.setStatus("Could not read the focused window.", true)
      return
    }
    if (!info || !info.class) {
      root.setStatus("No focused window to grab.", true)
      return
    }
    if (!root.selectedWorkspace) return

    var app = root.grabTargetIndex >= 0 && root.grabTargetIndex < root.selectedWorkspace.apps.length
      ? root.selectedWorkspace.apps[root.grabTargetIndex]
      : Config.defaultApp()
    var isNew = app !== root.selectedWorkspace.apps[root.grabTargetIndex]

    // initialClass is the safer default: some apps rewrite their class after
    // mapping, and the rule is evaluated at map time.
    var source = info.initialClass || info.class
    app.match.class = ""
    app.match.initialClass = Config.escapeClassRegex(source)
    if (!app.label) app.label = info.initialTitle || info.title || source

    if (isNew) root.selectedWorkspace.apps.push(app)
    root.appsRevision++
    root.touched()
    root.setStatus("Grabbed " + source + ".", false)
  }

  // Picking an app is the same shape as grabbing a window: -1 means "into a
  // new row", anything else re-points an existing one.
  property int pickTargetIndex: -1
  function pickApp(index) {
    if (!root.selectedWorkspace) return
    root.pickTargetIndex = index
    appPicker.open()
  }

  function applyPick(entry) {
    if (!root.selectedWorkspace || !entry || !entry.id) return

    var existing = root.pickTargetIndex >= 0 && root.pickTargetIndex < root.selectedWorkspace.apps.length
    var app = existing ? root.selectedWorkspace.apps[root.pickTargetIndex] : Config.defaultApp()

    app.desktop = {
      id: String(entry.id),
      name: String(entry.name || ""),
      icon: String(entry.icon || ""),
      classSource: String(entry.classSource || "")
    }

    // Never overwrite a class the user typed or grabbed themselves. The only
    // classes this replaces are ones a previous pick derived.
    var current = app.match.class || app.match.initialClass
    var wasDerived = existing && app.desktop && app.desktop.classSource !== "manual"
    if (!current || wasDerived) {
      app.match.class = String(entry["class"] || "")
      app.match.initialClass = ""
    } else {
      app.desktop.classSource = "manual"
    }

    if (!app.label) app.label = String(entry.name || entry.id)

    if (!existing) {
      root.selectedWorkspace.apps.push(app)
      // A new row is a new leaf target, so the app list has to rebuild.
      root.appsRevision++
    }
    root.touched()
    root.setStatus("Picked " + (entry.name || entry.id) + ".", false)
  }

  function setIcon(glyph, iconName) {
    if (!root.selectedWorkspace) return
    root.selectedWorkspace.icon = glyph
    root.selectedWorkspace.iconName = iconName
    root.touched()
  }

  function setStatus(text, isError) {
    root.statusText = text
    root.statusIsError = isError === true
    statusTimer.restart()
  }

  // ------------------------------------------------------- bar settings

  function updateBarSetting(key, value) {
    var entry = { id: root.pluginId }
    for (var existing in root.barSettings) {
      if (existing !== "id") entry[existing] = root.barSettings[existing]
    }
    entry[key] = value

    var next = {}
    for (var copied in entry) if (copied !== "id") next[copied] = entry[copied]
    root.barSettings = next

    if (root.shell && typeof root.shell.updateEntryInline === "function") {
      root.shell.updateEntryInline(root.pluginId, entry)
      root.setStatus("Bar setting saved.", false)
    } else {
      root.setStatus("The shell would not let this plugin save bar settings.", true)
    }
  }

  function loadBarSettings(text) {
    var parsed = null
    try {
      parsed = JSON.parse(text)
    } catch (error) {
      return
    }
    if (!parsed || !parsed.bar || !parsed.bar.layout) return

    var sections = ["left", "center", "right"]
    var found = null
    var clash = ""
    for (var s = 0; s < sections.length; s++) {
      var list = parsed.bar.layout[sections[s]]
      if (!list) continue
      for (var i = 0; i < list.length; i++) {
        var id = list[i] ? list[i].id : ""
        if (id === root.pluginId) found = list[i]
        // Another workspace indicator on the bar means two rows of buttons.
        else if (id === "omarchy.workspaces" || /workspaces$/.test(String(id))) clash = id
      }
    }
    root.clashingWidgetId = clash

    var settings = {}
    if (found) {
      for (var key in found) if (key !== "id") settings[key] = found[key]
    }
    root.barSettings = settings
  }

  // ------------------------------------------------------------- preview

  function generatedLua() {
    try {
      return HyprGen.toLua(root.config, { version: (root.manifest && root.manifest.version) || "0.1.0" })
    } catch (error) {
      root.setStatus(String(error.message || error), true)
      return ""
    }
  }

  function openPreview() {
    var lua = root.generatedLua()
    if (!lua) return
    preview.luaText = lua
    preview.diff = HyprGen.diffLines(root.diskLua, lua)
    preview.targetPath = root.luaPath
    preview.open()
  }

  // --------------------------------------------------------------- apply

  function apply() {
    root.revalidate()
    if (!root.validation.ok) {
      root.setStatus(root.validation.errors[0].message, true)
      root.tab = "workspaces"
      return
    }
    var lua = root.generatedLua()
    if (!lua) return

    // Keep a copy of whatever is on disk so "Revert last apply" is real.
    if (root.diskLua) backupFile.setText(root.diskLua)

    configFile.setText(Config.serialize(root.config))
    luaFile.setText(lua)
    root.diskLua = lua
    root.dirty = false
    root.everSaved = true
    root.backupExists = root.backupExists || root.diskLua !== ""

    root.setStatus("Reloading Hyprland…", false)
    applyProcess.command = [
      "bash",
      root.sourceDir + "/bin/workspace-studio-apply",
      root.config.apply.reloadMode
    ]
    applyProcess.running = true
  }

  function revert() {
    if (!root.backupExists) {
      root.setStatus("Nothing to revert to yet.", true)
      return
    }
    revertProcess.running = true
  }

  // ---------------------------------------------------------------- import

  function importSources() {
    return {
      windowRules: Importer.scanWindowRules(root.hyprlandLua),
      autostart: Importer.scanAutostart(root.autostartLua),
      icons: Importer.scanBarIcons(root.cloneQml)
    }
  }

  function iconCount(icons) {
    var n = 0
    for (var key in icons) if (Object.prototype.hasOwnProperty.call(icons, key)) n++
    return n
  }

  function openImport() {
    var sources = root.importSources()
    wizard.windowRules = sources.windowRules
    wizard.autostart = sources.autostart
    wizard.barIcons = sources.icons
    wizard.barIconCount = root.iconCount(sources.icons)
    wizard.clashingWidgetId = root.clashingWidgetId
    wizard.removalReport = Importer.removalReport({
      windowRules: sources.windowRules,
      autostart: sources.autostart
    })
    wizard.open()
  }

  // The three source files load asynchronously and independently, so the
  // offer waits for them to settle. Without this the wizard opens with
  // whichever FileView happened to finish first and reports "0 window rules".
  Timer {
    id: importProbe
    interval: 250
    onTriggered: root.maybeOfferImport()
  }

  // Offered once per open, and only when there is genuinely no config yet.
  function maybeOfferImport() {
    if (root.everSaved || root.importOffered) return
    if (!root.hyprlandLua && !root.autostartLua && !root.cloneQml) return
    var sources = root.importSources()
    if (sources.windowRules.length === 0 && sources.autostart.length === 0 && root.iconCount(sources.icons) === 0) return
    root.importOffered = true
    root.openImport()
  }

  function runImport(launchMode) {
    var sources = root.importSources()
    sources.launchMode = launchMode
    var result = Importer.buildConfig(sources)
    root.config = result.config
    root.dirty = true
    root.appsRevision++
    root.revalidate()
    root.rebuildRows()
    root.selectRow(0)
    wizard.close()
    root.tab = "workspaces"
    var missed = result.unmatchedLaunches.length
    root.setStatus(missed === 0
      ? "Imported. Check it over, then press Apply."
      : "Imported. " + missed + " launch" + (missed === 1 ? "" : "es") + " had no matching window rule and were left out.",
      false)
  }

  // ------------------------------------------------------------- plumbing

  ListModel { id: rows }

  Timer {
    id: statusTimer
    interval: 6000
    onTriggered: root.statusText = ""
  }

  FileView {
    id: configFile
    path: root.configPath
    atomicWrites: true
    printErrors: false
    onLoaded: root.loadConfig(text())
    onLoadFailed: root.loadConfig("")
  }

  FileView {
    id: luaFile
    path: root.luaPath
    atomicWrites: true
    printErrors: false
    onLoaded: root.diskLua = text()
    onLoadFailed: root.diskLua = ""
  }

  FileView {
    id: backupFile
    path: root.backupPath
    atomicWrites: true
    printErrors: false
  }

  FileView {
    id: shellConfigFile
    path: root.home + "/.config/omarchy/shell.json"
    printErrors: false
    onLoaded: root.loadBarSettings(text())
  }

  FileView {
    id: hyprlandFile
    path: root.home + "/.config/hypr/hyprland.lua"
    printErrors: false
    onLoaded: { root.hyprlandLua = text(); importProbe.restart() }
    onLoadFailed: { root.hyprlandLua = ""; importProbe.restart() }
  }

  FileView {
    id: autostartFile
    path: root.home + "/.config/hypr/autostart.lua"
    printErrors: false
    onLoaded: { root.autostartLua = text(); importProbe.restart() }
    onLoadFailed: { root.autostartLua = ""; importProbe.restart() }
  }

  // A hand-edited clone of omarchy.workspaces, if the user made one. Its
  // hard-coded icon map is exactly what this plugin generalises.
  FileView {
    id: cloneFile
    path: root.home + "/.config/omarchy/plugins/" + Quickshell.env("USER") + ".workspaces/Workspaces.qml"
    printErrors: false
    onLoaded: { root.cloneQml = text(); importProbe.restart() }
    onLoadFailed: { root.cloneQml = ""; importProbe.restart() }
  }

  FileView {
    id: iconsFile
    path: root.sourceDir + "/icons.json"
    printErrors: false
    onLoaded: {
      try {
        var parsed = JSON.parse(text())
        root.icons = parsed && parsed.icons ? parsed.icons : []
      } catch (error) {
        root.icons = []
      }
    }
  }

  Process {
    id: monitorsProcess
    command: ["hyprctl", "monitors", "-j"]
    stdout: StdioCollector { id: monitorsOut; waitForEnd: true }
    onExited: function (code) {
      if (code !== 0) return
      try {
        var list = JSON.parse(monitorsOut.text)
        var names = []
        for (var i = 0; i < list.length; i++) if (list[i].name) names.push(list[i].name)
        root.monitors = names
        if (list.length > 0) {
          var first = list[0]
          var scale = Number(first.scale) || 1
          var logicalW = (Number(first.width) || 1920) / scale
          var logicalH = (Number(first.height) || 1080) / scale
          if (logicalW > 0 && logicalH > 0) root.monitorAspect = logicalW / logicalH
          // reserved is [left, top, right, bottom] in logical pixels.
          var reserved = first.reserved && first.reserved.length > 1 ? Number(first.reserved[1]) || 0 : 0
          root.barReservePct = logicalH > 0 ? Math.round(reserved / logicalH * 10000) / 100 : 0
        }
      } catch (error) {
        root.monitors = []
      }
    }
  }

  Process {
    id: activeWindowProcess
    command: ["hyprctl", "activewindow", "-j"]
    stdout: StdioCollector { id: activeWindowOut; waitForEnd: true }
    onExited: function (code) {
      if (code === 0) root.applyGrab(activeWindowOut.text)
      else root.setStatus("hyprctl activewindow failed.", true)
    }
  }

  Process {
    id: backupProbe
    command: ["test", "-f", root.backupPath]
    onExited: function (code) { root.backupExists = code === 0 }
  }

  Process {
    id: applyProcess
    stdout: StdioCollector { id: applyOut; waitForEnd: true }
    stderr: StdioCollector { id: applyErr; waitForEnd: true }
    onExited: function (code) {
      luaFile.reload()
      root.backupExists = true
      if (code === 0) {
        root.setStatus("Applied. " + (applyOut.text || "").split("\n")[0], false)
      } else {
        root.setStatus("Apply reported a problem: " + ((applyErr.text || applyOut.text || "").split("\n")[0] || "exit " + code), true)
      }
      if (root.shell && typeof root.shell.call === "function") {
        // Nudge every monitor's bar instance to re-read the JSON.
        root.shell.call(root.pluginId, "refresh", "")
      }
    }
  }

  Process {
    id: revertProcess
    command: ["bash", root.sourceDir + "/bin/workspace-studio-apply", "--revert", root.config.apply.reloadMode]
    stdout: StdioCollector { id: revertOut; waitForEnd: true }
    onExited: function (code) {
      luaFile.reload()
      root.setStatus(code === 0
        ? "Reverted to the previous generated config."
        : "Revert failed: " + ((revertOut.text || "").split("\n")[0] || "exit " + code), code !== 0)
    }
  }

  IpcHandler {
    target: "majinmarco.workspace-studio.studio"
    function open(): void { root.open("{}") }
    function close(): void { root.dismiss() }
    function apply(): void { root.apply() }
  }

  // ------------------------------------------------------------------ UI

  PanelWindow {
    id: panel
    visible: root.opened
    anchors { top: true; bottom: true; left: true; right: true }
    color: "transparent"
    WlrLayershell.namespace: "workspace-studio"
    WlrLayershell.layer: WlrLayer.Overlay
    WlrLayershell.keyboardFocus: WlrKeyboardFocus.Exclusive
    exclusionMode: ExclusionMode.Ignore

    Rectangle { anchors.fill: parent; color: root.scrim }
    MouseArea { anchors.fill: parent; onClicked: root.dismiss() }

    BorderSurface {
      id: card
      anchors.centerIn: parent
      width: Math.min(Style.space(1180), parent.width - Style.gapsOut * 4)
      height: Math.min(Style.space(760), parent.height - Style.gapsOut * 4)
      radius: Style.cornerRadius
      color: root.background
      borderSpec: root.borderSpec
      padding: Style.spacing.panelPadding

      MouseArea { anchors.fill: parent; onClicked: {} }

      PanelKeyCatcher {
        id: keyCatcher
        anchors.fill: parent
        // Text fields and modals take the keyboard for themselves.
        blocked: root.anyModalOpen || hotkeys.editing

        onCloseRequested: root.dismiss()
        onMoveRequested: function (dx, dy) {
          if (root.tab !== "workspaces" || dy === 0) return
          var next = root.cursorIndex + dy
          if (next < 0 || next >= root.workspaces.length) return
          root.selectRow(next)
          list.positionViewAtIndex(next, ListView.Contain)
        }
        onDeleteRequested: {
          if (root.tab === "workspaces" && root.selectedWorkspace) confirmDelete.opened = true
        }
        onTabRequested: function (direction) {
          var index = 0
          for (var i = 0; i < root.tabOptions.length; i++) {
            if (root.tabOptions[i].value === root.tab) index = i
          }
          index = (index + direction + root.tabOptions.length) % root.tabOptions.length
          root.tab = root.tabOptions[index].value
        }
        onTextKey: function (text) {
          if (text === "a") root.addWorkspace()
          else if (text === "e") root.addApp()
          else if (text === "i" && root.selectedWorkspace) iconPicker.open(root.selectedWorkspace.icon, root.selectedWorkspace.iconName)
          else if (text === "g") root.grabWindow(-1)
          else if (text === "f") root.pickApp(-1)
          else if (text === "p") root.openPreview()
          else if (text === "u") root.revert()
          else if (text === "J" && root.selectedWorkspace) root.moveWorkspace(root.selectedWorkspace.id, 1)
          else if (text === "K" && root.selectedWorkspace) root.moveWorkspace(root.selectedWorkspace.id, -1)
          else if (text === "?") root.tab = "keys"
        }

        // Modified keys never reach PanelKeyCatcher's vocabulary, so they are
        // handled by a focused child: key events travel up from the focus item.
        Item {
          id: hotkeys
          anchors.fill: parent
          focus: root.opened && !root.anyModalOpen

          property bool editing: false

          Keys.onPressed: function (event) {
            if ((event.modifiers & Qt.ControlModifier)
                && (event.key === Qt.Key_Return || event.key === Qt.Key_Enter)) {
              root.apply()
              event.accepted = true
            }
          }

          Column {
            anchors.fill: parent
            anchors.topMargin: card.contentTopInset
            anchors.rightMargin: card.contentRightInset
            anchors.bottomMargin: card.contentBottomInset
            anchors.leftMargin: card.contentLeftInset
            spacing: Style.spacing.md

            // ---------------------------------------------------- header
            Row {
              id: header
              width: parent.width
              spacing: Style.spacing.controlGap

              Column {
                width: parent.width - tabs.width - closeButton.width - Style.spacing.controlGap * 2
                spacing: Style.spacing.xxs

                Text {
                  textFormat: Text.PlainText
                  text: "Workspace Studio"
                  color: root.foreground
                  font.family: Style.font.menuFamily
                  font.pixelSize: Style.font.heading
                }

                Text {
                  textFormat: Text.PlainText
                  text: root.workspaces.length + (root.workspaces.length === 1 ? " workspace" : " workspaces")
                    + (root.dirty ? "  ·  unsaved changes" : "")
                  color: root.dirty ? Color.accent : root.foreground
                  opacity: root.dirty ? 1 : 0.55
                  font.family: Style.font.menuFamily
                  font.pixelSize: Style.font.caption
                }
              }

              ButtonGroup {
                id: tabs
                width: Style.space(330)
                height: Style.spacing.controlHeight
                foreground: root.foreground
                accent: Color.accent
                options: root.tabOptions
                value: root.tab
                onChanged: function (next) { root.tab = next }
              }

              PanelActionButton {
                id: closeButton
                iconText: "󰅖"
                tooltipText: "Close"
                foreground: root.foreground
                size: Style.spacing.controlHeight
                onClicked: root.dismiss()
              }
            }

            PanelSeparator { width: parent.width; foreground: root.foreground }

            // ------------------------------------------- import banner
            BorderSurface {
              width: parent.width
              visible: root.clashingWidgetId !== "" || (!root.everSaved && (root.hyprlandLua !== "" || root.cloneQml !== ""))
              height: visible ? Style.space(44) : 0
              radius: Style.cornerRadius
              color: Style.selectedFillFor(Color.accent, Color.accent, Color.urgent)
              borderSpec: Border.controlSpec("normal", Color.accent, Color.accent)
              padding: Style.spacing.sm

              Row {
                anchors.verticalCenter: parent.verticalCenter
                anchors.left: parent.left
                anchors.right: parent.right
                anchors.leftMargin: Style.spacing.sm
                anchors.rightMargin: Style.spacing.sm
                spacing: Style.spacing.sm

                Text {
                  textFormat: Text.PlainText
                  height: Style.spacing.controlHeight
                  verticalAlignment: Text.AlignVCenter
                  width: parent.width - importButton.width - Style.spacing.sm
                  text: root.everSaved
                    ? "“" + root.clashingWidgetId + "” is also on your bar and draws its own workspace buttons."
                    : "You already have a workspace layout in ~/.config/hypr. Import it?"
                  color: root.foreground
                  font.family: Style.font.menuFamily
                  font.pixelSize: Style.font.bodySmall
                  elide: Text.ElideRight
                }

                Button {
                  id: importButton
                  text: "Review…"
                  foreground: root.foreground
                  bordered: true
                  onClicked: root.openImport()
                }
              }
            }

            // ------------------------------------------------- content
            Item {
              width: parent.width
              height: parent.height - header.height - footer.height - Style.space(52)

              // ------ workspaces tab
              Item {
                anchors.fill: parent
                visible: root.tab === "workspaces"

                Item {
                  id: listColumn
                  width: Math.round(parent.width * 0.42)
                  height: parent.height

                  ListView {
                    id: list
                    anchors.fill: parent
                    anchors.bottomMargin: Style.spacing.controlHeight + Style.spacing.md
                    clip: true
                    spacing: Style.spacing.xxs
                    model: rows
                    boundsBehavior: Flickable.StopAtBounds

                    delegate: WorkspaceRow {
                      id: row
                      required property int index
                      required property int rowWorkspaceId
                      required property string rowKeyLabel
                      required property string rowIcon
                      required property string rowName
                      required property string rowSummary

                      width: list.width - Style.spacing.sm
                      workspaceId: row.rowWorkspaceId
                      keyLabel: row.rowKeyLabel
                      icon: row.rowIcon
                      name: row.rowName
                      summary: row.rowSummary
                      selected: row.index === root.selectedIndex
                      hasCursor: row.index === root.cursorIndex
                      live: root.isLive(row.rowWorkspaceId)
                      canMoveUp: row.index > 0
                      canMoveDown: row.index < rows.count - 1
                      foreground: root.foreground

                      onActivated: root.selectRow(row.index)
                      onMoveRequested: function (delta) { root.moveWorkspace(row.rowWorkspaceId, delta) }
                      onRemoveRequested: {
                        root.selectRow(row.index)
                        confirmDelete.opened = true
                      }
                    }
                  }

                  Row {
                    anchors.bottom: parent.bottom
                    anchors.left: parent.left
                    spacing: Style.spacing.sm

                    Button {
                      text: "Add workspace"
                      iconText: "󰐕"
                      foreground: root.foreground
                      bordered: true
                      onClicked: root.addWorkspace()
                    }

                    Text {
                      textFormat: Text.PlainText
                      height: Style.spacing.controlHeight
                      verticalAlignment: Text.AlignVCenter
                      text: "a  add      x  remove      J / K  reorder"
                      color: root.foreground
                      opacity: 0.4
                      font.family: Style.font.menuFamily
                      font.pixelSize: Style.font.caption
                    }
                  }
                }

                DetailPane {
                  id: detail
                  anchors.left: listColumn.right
                  anchors.leftMargin: Style.spacing.panelGap
                  anchors.right: parent.right
                  anchors.top: parent.top
                  anchors.bottom: parent.bottom
                  visible: root.selectedWorkspace !== null
                  workspace: root.selectedWorkspace || Config.defaultWorkspace(1)
                  monitors: root.monitors
                  monitorAspect: root.monitorAspect
                  barReservePct: root.barReservePct
                  home: root.home
                  foreground: root.foreground
                  appsRevision: root.appsRevision

                  onChanged: root.touched()
                  onIconPickRequested: {
                    if (root.selectedWorkspace) iconPicker.open(root.selectedWorkspace.icon, root.selectedWorkspace.iconName)
                  }
                  onAddAppRequested: root.addApp()
                  onRemoveAppRequested: function (index) { root.removeApp(index) }
                  onGrabRequested: function (index) { root.grabWindow(index) }
                  onPickRequested: function (index) { root.pickApp(index) }
                  onLayoutChanged: root.touched()
                  // A leaf appeared or vanished, so the app rows have to
                  // rebuild. A splitter drag never reaches this.
                  onLayoutStructureChanged: root.appsRevision++
                }

                Text {
                  anchors.centerIn: parent
                  visible: root.workspaces.length === 0
                  textFormat: Text.PlainText
                  text: "No workspaces yet — press a, or import your existing layout."
                  color: root.foreground
                  opacity: 0.55
                  font.family: Style.font.menuFamily
                  font.pixelSize: Style.font.title
                }
              }

              // ------ bar tab
              BarSettings {
                anchors.fill: parent
                visible: root.tab === "bar"
                settings: root.barSettings
                foreground: root.foreground
                onSettingChanged: function (key, value) { root.updateBarSetting(key, value) }
              }

              // ------ keys & apply tab
              Flickable {
                anchors.fill: parent
                visible: root.tab === "keys"
                contentWidth: width
                contentHeight: keysColumn.implicitHeight
                clip: true
                boundsBehavior: Flickable.StopAtBounds

                Column {
                  id: keysColumn
                  width: parent.width
                  spacing: Style.spacing.md

                  PanelSectionHeader {
                    text: "Keybinds"
                    foreground: root.foreground
                    fontFamily: Style.font.menuFamily
                  }

                  Toggle {
                    width: Style.space(420)
                    label: "Bind the workspace keys"
                    description: "SUPER+N to focus, SUPER+SHIFT+N to move a window there"
                    checked: root.config.binds.enabled
                    foreground: root.foreground
                    onClicked: {
                      root.config.binds.enabled = !root.config.binds.enabled
                      root.touched()
                    }
                  }

                  Toggle {
                    width: Style.space(420)
                    label: "Unbind workspaces you removed"
                    description: "Omarchy binds ten by default; without this a deleted workspace keeps its key"
                    checked: root.config.binds.unbindUnused
                    foreground: root.foreground
                    onClicked: {
                      root.config.binds.unbindUnused = !root.config.binds.unbindUnused
                      root.touched()
                    }
                  }

                  Text {
                    width: parent.width
                    textFormat: Text.PlainText
                    wrapMode: Text.WordWrap
                    text: "Keys are emitted as keysyms (1…9, 0, minus, equal), never as code:NN. "
                      + "Hyprland 0.56.2 silently drops code:NN bind keycodes: they land in the bind table with an empty key "
                      + "and then match on the modifier mask alone, so one SUPER+key press fires every bind that shares the mask."
                    color: root.foreground
                    opacity: 0.55
                    font.family: Style.font.menuFamily
                    font.pixelSize: Style.font.caption
                  }

                  PanelSeparator { width: parent.width; foreground: root.foreground }

                  PanelSectionHeader {
                    text: "Applying"
                    foreground: root.foreground
                    fontFamily: Style.font.menuFamily
                  }

                  FieldRow {
                    label: "Reload"
                    foreground: root.foreground

                    Dropdown {
                      width: Style.space(300)
                      showLabel: false
                      foreground: root.foreground
                      options: [
                        { value: "config-only", label: "config-only (recommended)" },
                        { value: "full", label: "full reload (also re-applies monitors)" }
                      ]
                      value: root.config.apply.reloadMode === "full" ? "full" : "config-only"
                      onChanged: function (next) {
                        root.config.apply.reloadMode = next
                        root.touched()
                      }
                    }
                  }

                  FieldRow {
                    label: "Land on"
                    foreground: root.foreground

                    NumberField {
                      label: ""
                      foreground: root.foreground
                      from: 0
                      to: 12
                      fieldWidth: Style.space(96)
                      value: root.config.apply.landOn
                      onModified: function (next) {
                        root.config.apply.landOn = next
                        root.touched()
                      }
                    }

                    Text {
                      textFormat: Text.PlainText
                      height: Style.spacing.controlHeight
                      verticalAlignment: Text.AlignVCenter
                      text: "workspace to focus after a login restore; 0 = don't"
                      color: root.foreground
                      opacity: 0.5
                      font.family: Style.font.menuFamily
                      font.pixelSize: Style.font.caption
                    }
                  }

                  Text {
                    width: parent.width
                    textFormat: Text.PlainText
                    wrapMode: Text.WordWrap
                    text: "Apply writes two files — " + root.configPath + " and " + root.luaPath
                      + " — and reloads Hyprland. Nothing else of yours is touched. "
                      + "Rules registered at runtime cannot be removed, so a real apply is always a reload."
                    color: root.foreground
                    opacity: 0.55
                    font.family: Style.font.menuFamily
                    font.pixelSize: Style.font.caption
                  }

                  PanelSeparator { width: parent.width; foreground: root.foreground }

                  PanelSectionHeader {
                    text: "Keyboard"
                    foreground: root.foreground
                    fontFamily: Style.font.menuFamily
                  }

                  Text {
                    width: parent.width
                    textFormat: Text.PlainText
                    wrapMode: Text.WordWrap
                    text: "j / k  move        J / K  reorder        a  add workspace        x  remove\n"
                      + "e  add app         f  find an app          i  pick icon           g  grab focused window\n"
                      + "p  preview         u  revert              ctrl+enter  apply        tab  switch tab        esc  close"
                    color: root.foreground
                    opacity: 0.6
                    font.family: Style.font.family
                    font.pixelSize: Style.font.caption
                  }

                  PanelSeparator { width: parent.width; foreground: root.foreground }

                  Text {
                    width: parent.width
                    textFormat: Text.PlainText
                    wrapMode: Text.WordWrap
                    text: "Import your hand-written layout again, or check what is still in ~/.config/hypr:"
                    color: root.foreground
                    opacity: 0.55
                    font.family: Style.font.menuFamily
                    font.pixelSize: Style.font.caption
                  }

                  Button {
                    text: "Open the import wizard"
                    foreground: root.foreground
                    bordered: true
                    onClicked: root.openImport()
                  }

                  Item { width: 1; height: Style.spacing.lg }
                }
              }
            }

            // ---------------------------------------------------- footer
            Column {
              id: footer
              width: parent.width
              spacing: Style.spacing.sm

              PanelSeparator { width: parent.width; foreground: root.foreground }

              Row {
                width: parent.width
                spacing: Style.spacing.controlGap

                Text {
                  textFormat: Text.PlainText
                  width: parent.width - previewButton.width - revertButton.width - applyButton.width
                    - Style.spacing.controlGap * 3
                  height: Style.spacing.controlHeight
                  verticalAlignment: Text.AlignVCenter
                  text: root.statusText !== ""
                    ? root.statusText
                    : (root.validation.ok
                      ? (root.validation.warnings.length > 0
                        ? root.validation.warnings[0].message
                        : "Left click a workspace to focus it; right click the bar to come back here.")
                      : root.validation.errors[0].message)
                  color: root.statusIsError || !root.validation.ok ? Color.urgent : root.foreground
                  opacity: root.statusText !== "" || !root.validation.ok ? 1 : 0.55
                  font.family: Style.font.menuFamily
                  font.pixelSize: Style.font.bodySmall
                  elide: Text.ElideRight
                }

                Button {
                  id: previewButton
                  text: "Preview"
                  foreground: root.foreground
                  bordered: true
                  onClicked: root.openPreview()
                }

                Button {
                  id: revertButton
                  text: "Revert last apply"
                  foreground: root.foreground
                  bordered: true
                  enabled: root.backupExists
                  opacity: root.backupExists ? 1 : 0.4
                  onClicked: root.revert()
                }

                Button {
                  id: applyButton
                  text: "Apply"
                  foreground: root.foreground
                  accent: Color.accent
                  active: root.dirty && root.validation.ok
                  bordered: true
                  enabled: root.validation.ok
                  opacity: root.validation.ok ? 1 : 0.4
                  onClicked: root.apply()
                }
              }
            }
          }
        }
      }

      // ------------------------------------------------------- modals

      ConfirmDialog {
        id: confirmDelete
        anchors.fill: parent
        message: root.selectedWorkspace
          ? "Remove workspace " + root.selectedWorkspace.id + "?"
          : "Remove this workspace?"
        confirmText: "Remove"
        onCanceled: confirmDelete.opened = false
        onConfirmed: {
          confirmDelete.opened = false
          if (root.selectedWorkspace) root.removeWorkspace(root.selectedWorkspace.id)
        }
      }

      IconPicker {
        id: iconPicker
        anchors.fill: parent
        icons: root.icons
        foreground: root.foreground
        background: root.background
        onPicked: function (glyph, iconName) { root.setIcon(glyph, iconName) }
        onDismissed: Qt.callLater(function () { keyCatcher.forceActiveFocus() })
      }

      AppPicker {
        id: appPicker
        anchors.fill: parent
        omarchyPath: root.omarchyPath
        foreground: root.foreground
        background: root.background
        onPicked: function (entry) { root.applyPick(entry) }
        onManualRequested: {
          // The escape hatch: make sure there is a row to type into, then say
          // where the cursor should go.
          if (root.pickTargetIndex < 0) root.addApp()
          root.setStatus("Type the command in the app's command field; a typed command always wins.", false)
          Qt.callLater(function () { keyCatcher.forceActiveFocus() })
        }
        onDismissed: Qt.callLater(function () { keyCatcher.forceActiveFocus() })
      }

      PreviewPane {
        id: preview
        anchors.fill: parent
        foreground: root.foreground
        background: root.background
        onDismissed: Qt.callLater(function () { keyCatcher.forceActiveFocus() })
        onApplyRequested: {
          preview.opened = false
          root.apply()
        }
      }

      ImportWizard {
        id: wizard
        anchors.fill: parent
        foreground: root.foreground
        background: root.background
        onDismissed: Qt.callLater(function () { keyCatcher.forceActiveFocus() })
        onImportRequested: function (launchMode) { root.runImport(launchMode) }
      }
    }
  }

  Component.onCompleted: {
    // QML gives each .js resource its own scope, so the importer has to be
    // handed the config module explicitly.
    Importer.useConfig(Config)
    // Same reason: the layout maths lives in Layout.js and both the config
    // model and the generator have to be handed it explicitly.
    Config.useLayout(Layout)
    HyprGen.useLayoutModule(Layout)
    root.rebuildRows()
  }
}
