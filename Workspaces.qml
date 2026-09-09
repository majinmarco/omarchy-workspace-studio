pragma ComponentBehavior: Bound

import QtQuick
import QtQuick.Layouts
import Quickshell
import Quickshell.Io
import Quickshell.Hyprland
import qs.Commons
import qs.Ui
import "Config.js" as Config

// Workspace Studio — the bar surface.
//
// Draws one button per workspace, labelled with the icon and name from
// ~/.config/omarchy/workspace-studio.json. Left click focuses; right click
// opens the editor overlay. Everything presentational comes from this
// widget's inline shell.json entry via setting(), so `omarchy bar set` and
// the editor's Bar tab drive the same values.
//
// The config file is watched, not polled: a FileView reload is an ordinary
// property change inside a live component, so applying an icon repaints the
// bar with no plugin reload and no shell restart.
BarWidget {
  id: root

  // The clone this generalises left moduleName pointing at omarchy.workspaces
  // and could therefore never read its own settings. It must be the plugin id.
  moduleName: "majinmarco.workspace-studio"

  readonly property string configPath: Quickshell.env("HOME") + "/.config/omarchy/workspace-studio.json"
  property var config: null

  // ------------------------------------------------------------- settings

  // showMode and showEmpty carry an "auto" default so the two boolean
  // shortcuts (showNames, dimEmpty) that `omarchy bar set` users reach for
  // first still mean something.
  readonly property string showMode: {
    var mode = root.setting("showMode", "auto")
    if (mode !== "auto" && mode !== "") return mode
    return root.setting("showNames", false) ? "iconAndName" : "icon"
  }
  readonly property string showEmpty: {
    var mode = root.setting("showEmpty", "auto")
    if (mode !== "auto" && mode !== "") return mode
    return root.setting("dimEmpty", true) ? "dim" : "always"
  }
  readonly property real emptyOpacity: Util.clamp(Number(root.setting("emptyOpacity", 0.5)) || 0.5, 0, 1)
  readonly property bool includeUnconfigured: root.setting("includeUnconfigured", true) !== false
  readonly property string focusStyle: root.setting("focusStyle", "underline")
  readonly property string focusIndicatorColorName: root.setting("focusIndicatorColor", "foreground")
  readonly property int focusIndicatorThickness: Math.max(1, Math.min(8, Number(root.setting("focusIndicatorThickness", 2)) || 2))
  readonly property bool autoWidth: root.setting("slotWidthMode", "auto") !== "fixed"
  readonly property int slotMinWidth: Math.max(12, Math.min(120, Number(root.setting("slotMinWidth", 26)) || 26))
  readonly property int slotSpacing: Math.max(0, Math.min(24, Number(root.setting("slotSpacing", 6))))
  readonly property string tooltipMode: root.setting("tooltipMode", "name")
  readonly property string rightClickAction: root.setting("rightClick", "openStudio")
  readonly property string wheelAction: root.setting("wheelAction", "none")

  readonly property real iconFontSize: {
    var token = root.setting("iconFontSize", "body")
    var numeric = Number(token)
    if (isFinite(numeric) && numeric > 0) return numeric
    if (token === "caption") return Style.font.caption
    if (token === "bodySmall") return Style.font.bodySmall
    if (token === "subtitle") return Style.font.subtitle
    if (token === "title") return Style.font.title
    if (token === "heading") return Style.font.heading
    if (token === "icon") return Style.font.icon
    if (token === "iconLarge") return Style.font.iconLarge
    return Style.font.body
  }

  readonly property color focusIndicatorColor: {
    if (root.focusIndicatorColorName === "accent") return Color.accent
    if (root.focusIndicatorColorName === "urgent") return root.bar ? root.bar.urgent : Color.urgent
    return root.bar ? root.bar.barForeground : Color.foreground
  }

  // ---------------------------------------------------------------- model

  function entryFor(id) {
    if (!root.config || !root.config.workspaces) return null
    var list = root.config.workspaces
    for (var i = 0; i < list.length; i++) {
      if (list[i].id === id) return list[i]
    }
    return null
  }

  function workspaceById(id) {
    var values = Hyprland.workspaces.values
    for (var i = 0; i < values.length; i++) {
      if (values[i].id === id) return values[i]
    }
    return null
  }

  function isOccupied(id) {
    var workspace = root.workspaceById(id)
    return workspace !== null && workspace.toplevels.values.length > 0
  }

  // Configured workspaces always appear; live ones join them unless the user
  // asked for exactly the configured set. "hide" drops empties, but never a
  // workspace marked persistent — that flag is the compositor-level way of
  // saying "always keep this one around".
  function workspaceIds() {
    var ids = []
    var i = 0
    if (root.config && root.config.workspaces) {
      for (i = 0; i < root.config.workspaces.length; i++) {
        ids.push(root.config.workspaces[i].id)
      }
    }
    if (ids.length === 0 && !root.config) ids = [1, 2, 3, 4, 5]

    if (root.includeUnconfigured) {
      var values = Hyprland.workspaces.values
      for (i = 0; i < values.length; i++) {
        var id = values[i].id
        if (id > 0 && id <= 12 && ids.indexOf(id) === -1) ids.push(id)
      }
    }

    if (root.showEmpty === "hide") {
      var kept = []
      for (i = 0; i < ids.length; i++) {
        var entry = root.entryFor(ids[i])
        var focused = Hyprland.focusedWorkspace !== null && Hyprland.focusedWorkspace.id === ids[i]
        if (focused || root.isOccupied(ids[i]) || (entry && entry.persistent)) kept.push(ids[i])
      }
      ids = kept
    }

    ids.sort(function (left, right) { return left - right })
    return ids
  }

  function numberLabel(id) {
    return id === 10 ? "0" : String(id)
  }

  function labelFor(id) {
    var entry = root.entryFor(id)
    var icon = entry && entry.icon ? entry.icon : ""
    var name = entry && entry.name ? entry.name : ""
    var number = root.numberLabel(id)

    if (root.showMode === "number") return number
    if (root.showMode === "name") return name || number
    if (root.showMode === "iconAndNumber") return icon ? icon + " " + number : number
    if (root.showMode === "iconAndName") {
      if (icon && name) return icon + " " + name
      return icon || name || number
    }
    return icon || number
  }

  function tooltipFor(id) {
    if (root.tooltipMode === "none") return ""
    var entry = root.entryFor(id)
    var number = "Workspace " + root.numberLabel(id)
    if (root.tooltipMode === "number") return number
    var name = entry && entry.name ? entry.name : ""
    if (root.tooltipMode === "name") return name ? name + " — " + number : number
    var apps = []
    if (entry && entry.apps) {
      for (var i = 0; i < entry.apps.length; i++) {
        var app = entry.apps[i]
        var appLabel = app.label || (app.match ? (app.match.class || app.match.initialClass || app.match.title) : "")
        if (appLabel) apps.push(appLabel)
      }
    }
    var head = name ? name + " — " + number : number
    return apps.length ? head + "\n" + apps.join(", ") : head
  }

  function tintFor(id) {
    var entry = root.entryFor(id)
    var base = root.bar ? root.bar.barForeground : Color.foreground
    if (!entry || !entry.color || entry.color === "default") return base
    if (entry.color === "accent") return Color.accent
    if (entry.color === "urgent") return root.bar ? root.bar.urgent : Color.urgent
    return /^#[0-9a-fA-F]{6}$/.test(entry.color) ? entry.color : base
  }

  // -------------------------------------------------------------- actions

  function focusWorkspace(id) {
    if (!root.bar) return
    root.bar.run("hyprctl dispatch " + Util.shellQuote("hl.dsp.focus({ workspace = \"" + id + "\" })"))
  }

  function moveWindowTo(id) {
    if (!root.bar) return
    root.bar.run("hyprctl dispatch " + Util.shellQuote("hl.dsp.window.move({ workspace = \"" + id + "\" })"))
  }

  function openStudio() {
    if (root.bar && root.bar.shell && typeof root.bar.shell.toggle === "function") {
      root.bar.shell.toggle(root.moduleName, "{}")
    }
  }

  function handlePress(id, button) {
    if (button === Qt.RightButton) {
      if (root.rightClickAction === "openStudio") root.openStudio()
      else if (root.rightClickAction === "moveWindowHere") root.moveWindowTo(id)
      return
    }
    if (button === Qt.MiddleButton) return
    root.focusWorkspace(id)
  }

  function handleWheel(delta) {
    if (root.wheelAction === "none" || delta === 0) return
    var step = delta > 0 ? -1 : 1
    var ids = root.workspaceIds()
    if (root.wheelAction === "cycleOccupied") {
      var occupied = []
      for (var i = 0; i < ids.length; i++) {
        if (root.isOccupied(ids[i])) occupied.push(ids[i])
      }
      ids = occupied
    }
    if (ids.length === 0) return
    var current = Hyprland.focusedWorkspace ? ids.indexOf(Hyprland.focusedWorkspace.id) : -1
    var next = current === -1 ? 0 : (current + step + ids.length) % ids.length
    root.focusWorkspace(ids[next])
  }

  // Called by the editor over IPC after it writes the JSON, and by the bar's
  // own broadcast, so every monitor's instance re-reads at once.
  function refresh() {
    configFile.reload()
  }

  // ------------------------------------------------------------- plumbing

  FileView {
    id: configFile
    path: root.configPath
    watchChanges: true
    printErrors: false
    onFileChanged: reload()
    onLoaded: root.config = Config.parse(text())
    // A missing file is the normal first-run state, not an error: the widget
    // falls back to numbers until the editor writes one.
    onLoadFailed: root.config = null
  }

  IpcHandler {
    target: "majinmarco.workspace-studio"
    function refresh(): void { root.broadcast("refresh") }
    function open(): void { root.openStudio() }
  }

  readonly property real trailingGap: root.vertical ? 0 : Style.spaceReal(1.5)
  implicitWidth: grid.implicitWidth + trailingGap
  implicitHeight: grid.implicitHeight

  GridLayout {
    id: grid
    anchors.fill: parent
    anchors.rightMargin: root.trailingGap
    columns: root.vertical ? 1 : Math.max(1, root.workspaceIds().length)
    columnSpacing: root.vertical ? 0 : Style.space(root.slotSpacing)
    rowSpacing: root.vertical ? Style.space(2) : 0

    Repeater {
      model: root.workspaceIds()

      WidgetButton {
        id: button
        required property int modelData

        readonly property bool occupied: root.isOccupied(modelData)
        readonly property bool focused: Hyprland.focusedWorkspace !== null && Hyprland.focusedWorkspace.id === modelData
        readonly property string label: root.focusStyle === "marker" && focused ? "\uDB85\uDCFB" : root.labelFor(modelData)

        bar: root.bar
        text: label
        fontSize: root.iconFontSize
        foreground: focused && root.focusStyle === "accent" ? root.focusIndicatorColor : root.tintFor(modelData)
        tooltipText: root.tooltipFor(modelData)
        opacity: occupied || focused || root.showEmpty !== "dim" ? 1 : root.emptyOpacity
        horizontalMargin: 6
        verticalPadding: 6
        // Auto width so a two-glyph or icon-plus-name label fits; the stock
        // widget's fixed slot is one setting away.
        fixedWidth: root.vertical
          ? root.barSize
          : (root.autoWidth
            ? Math.max(Style.space(root.slotMinWidth), labelWidth + Style.spaceReal(6) * 2)
            : Style.space(root.slotMinWidth))
        fixedHeight: root.barSize

        onPressed: function (b) { root.handlePress(modelData, b) }
        onWheelMoved: function (delta) { root.handleWheel(delta) }

        // focusStyle: fill — a pill behind the glyph. z below the label.
        Rectangle {
          z: -1
          visible: button.focused && root.focusStyle === "fill"
          anchors.centerIn: parent
          width: parent.width
          height: parent.height - Style.space(4)
          radius: Style.cornerRadius > 0 ? Style.cornerRadius : height / 2
          color: Style.selectedFillFor(root.focusIndicatorColor, Color.accent, Color.urgent)
        }

        // focusStyle: underline — the rule the hand-written clone settled on.
        Rectangle {
          visible: button.focused && root.focusStyle === "underline"
          width: root.vertical ? root.focusIndicatorThickness : Math.max(button.labelWidth, Style.space(8))
          height: root.vertical ? Math.max(button.labelWidth, Style.space(8)) : root.focusIndicatorThickness
          radius: 1
          color: root.focusIndicatorColor
          anchors.horizontalCenter: root.vertical ? undefined : parent.horizontalCenter
          anchors.bottom: root.vertical ? undefined : parent.bottom
          anchors.bottomMargin: root.vertical ? 0 : 3
          anchors.verticalCenter: root.vertical ? parent.verticalCenter : undefined
          anchors.right: root.vertical ? parent.right : undefined
          anchors.rightMargin: root.vertical ? 3 : 0
        }
      }
    }
  }
}
