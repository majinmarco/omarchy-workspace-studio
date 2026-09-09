pragma ComponentBehavior: Bound

import QtQuick
import Quickshell.Io
import qs.Commons
import qs.Ui
import "../Layout.js" as Layout

// Draw the workspace instead of describing it.
//
// The model is a binary slicing tree (Layout.js), because a flat list of
// rectangles lets you draw overlaps and gaps that no tiler can render, and it
// has no notion of a splitter. Every state this canvas can reach is a state
// the compositor can be told about.
//
// Rendering flattens rather than nests: the leaf and splitter lists are
// computed in JS and driven through two plain Repeaters. With at most eight
// leaves that is a handful of Items, re-laid-out only when the tree or the
// stage size changes — and it avoids the recursive-delegate lifetime problems
// that already bit AppRow once.
Item {
  id: canvas

  property var workspace: null
  property color foreground: Color.menu.text
  property real monitorAspect: 16 / 9
  // What fraction of the monitor the bar reserves, from hyprctl. Only a hint
  // in tiled mode (the compositor already knows); in exact mode it is the
  // inset the generated move/size percentages have to carry themselves.
  property real barReservePct: 0
  property string home: ""

  // Bumped by the Studio when an app is added or removed, so the tile labels
  // follow the app list.
  property int appsRevision: 0

  signal changed()
  // Emitted only when a leaf appears or disappears, so the Studio can rebuild
  // the app rows. A splitter drag must never fire this.
  signal structureChanged()
  signal addAppRequested()

  implicitHeight: body.implicitHeight

  // ------------------------------------------------------------- model

  // Local revision. Drags mutate the tree many times a second, and routing
  // every frame through the Studio's touched() would re-normalize the whole
  // document and rebuild the workspace list under the cursor.
  property int rev: 0

  readonly property var arrangement: {
    canvas.rev
    canvas.appsRevision
    return canvas.workspace && canvas.workspace.arrangement ? canvas.workspace.arrangement : null
  }
  readonly property string mode: canvas.arrangement ? String(canvas.arrangement.mode) : "none"
  readonly property var tree: canvas.arrangement ? canvas.arrangement.root : null
  readonly property int appCount: canvas.workspace && canvas.workspace.apps ? canvas.workspace.apps.length : 0

  readonly property real reservePct: canvas.mode === "float"
    ? (canvas.arrangement ? Number(canvas.arrangement.topReservePct) || 0 : 0)
    : canvas.barReservePct

  readonly property int gap: Math.max(2, Style.space(4))
  readonly property real reserveHeight: canvas.mode === "float"
    ? stage.height * canvas.reservePct / 100
    : 0

  readonly property var rects: canvas.tree
    ? Layout.computeRects(canvas.tree, stage.width, stage.height - canvas.reserveHeight, canvas.gap)
    : []
  readonly property var splitters: canvas.tree
    ? Layout.computeSplitters(canvas.tree, stage.width, stage.height - canvas.reserveHeight, canvas.gap)
    : []

  readonly property var projection: canvas.tree ? Layout.toWorkspaceLayout(canvas.tree) : null
  readonly property string presetName: canvas.tree ? (Layout.detectPreset(canvas.tree) || "") : ""

  // Drag state. dragPath is the tile the pointer went down on; hoverPath and
  // hoverEdge are where it is now.
  property var dragPath: null
  property var hoverPath: null
  property string hoverEdge: ""
  property real pressX: 0
  property real pressY: 0

  // The app chooser, opened by clicking a tile's body.
  property var chooserPath: null
  property real chooserX: 0
  property real chooserY: 0

  readonly property var modeOptions: [
    { value: "none", label: "Off" },
    { value: "tiled", label: "Tiled" },
    { value: "float", label: "Exact" }
  ]

  // -------------------------------------------------------- operations

  function ensureArrangement(mode) {
    if (!canvas.workspace) return
    if (!canvas.workspace.arrangement) {
      canvas.workspace.arrangement = {
        mode: mode,
        root: Layout.preset("columns", Math.max(1, canvas.appCount)),
        topReservePct: 0
      }
    } else {
      canvas.workspace.arrangement.mode = mode
    }
  }

  function setMode(next) {
    if (!canvas.workspace) return
    if (next === "none") {
      // Config drops the whole key when the mode is none, so the drawing is
      // discarded on save. Say so rather than losing it silently.
      if (canvas.workspace.arrangement) canvas.workspace.arrangement.mode = "none"
    } else {
      canvas.ensureArrangement(next)
      if (next === "float" && canvas.workspace.arrangement.topReservePct === 0 && canvas.barReservePct > 0) {
        canvas.workspace.arrangement.topReservePct = Math.round(canvas.barReservePct * 100) / 100
      }
    }
    canvas.rev++
    canvas.changed()
  }

  // structural: a leaf appeared or vanished, so the Studio has to rebuild.
  function applyTree(next, structural) {
    if (!canvas.workspace || !canvas.workspace.arrangement) return
    canvas.workspace.arrangement.root = next
    canvas.rev++
    canvas.changed()
    if (structural) canvas.structureChanged()
  }

  // A live drag: mutate and repaint, but do not disturb the document yet.
  function previewTree(next) {
    if (!canvas.workspace || !canvas.workspace.arrangement) return
    canvas.workspace.arrangement.root = next
    canvas.rev++
  }

  function applyPreset(name) {
    canvas.ensureArrangement(canvas.mode === "none" ? "tiled" : canvas.mode)
    canvas.applyTree(Layout.preset(name, Math.max(1, canvas.appCount)), true)
  }

  // Split along whichever axis leaves the two halves closest to square, which
  // is what the "+" button on a tile is expected to do.
  function splitAt(path) {
    var rect = canvas.rectFor(path)
    if (!rect) return
    canvas.applyTree(Layout.splitLeaf(canvas.tree, path, rect.w >= rect.h ? "h" : "v", false, -1), true)
  }

  function removeAt(path) {
    var next = Layout.removeLeaf(canvas.tree, path)
    if (!next) {
      // The last tile: turn the canvas off rather than leaving an empty stage.
      canvas.setMode("none")
      return
    }
    canvas.applyTree(next, true)
  }

  function rectFor(path) {
    var key = Layout.pathKey(path)
    for (var i = 0; i < canvas.rects.length; i++) if (canvas.rects[i].key === key) return canvas.rects[i]
    return null
  }

  function appAt(index) {
    if (index < 0 || !canvas.workspace || !canvas.workspace.apps) return null
    return index < canvas.workspace.apps.length ? canvas.workspace.apps[index] : null
  }

  function labelFor(index) {
    var app = canvas.appAt(index)
    if (!app) return "any window"
    return app.label || app.match.class || app.match.initialClass || ("app " + (index + 1))
  }

  function iconFor(index) {
    var app = canvas.appAt(index)
    return app && app.desktop ? String(app.desktop.icon || "") : ""
  }

  function openChooser(path, x, y) {
    canvas.chooserPath = path
    canvas.chooserX = Math.max(0, Math.min(x, stage.width - Style.space(200)))
    canvas.chooserY = Math.max(0, Math.min(y, stage.height - Style.space(60)))
  }

  function chooseApp(index) {
    if (!canvas.chooserPath) return
    canvas.applyTree(Layout.setLeafApp(canvas.tree, canvas.chooserPath, index), false)
    canvas.chooserPath = null
  }

  // ------------------------------------------------- the layout override
  //
  // omarchy-hyprland-workspace-layout-toggle writes
  // ~/.local/state/omarchy/workspace-layouts/<id>.lua, which Omarchy loads
  // AFTER the toggles directory this plugin writes into. If one exists, the
  // layout set here is quietly overridden and Tiled mode appears to do
  // nothing — so say so on the canvas rather than letting it be a mystery.
  property bool layoutOverridden: false

  FileView {
    id: overrideProbe
    path: canvas.home && canvas.workspace
      ? canvas.home + "/.local/state/omarchy/workspace-layouts/" + canvas.workspace.id + ".lua"
      : ""
    printErrors: false
    onLoaded: canvas.layoutOverridden = true
    onLoadFailed: canvas.layoutOverridden = false
  }

  // ------------------------------------------------------------------ UI

  Column {
    id: body
    width: canvas.width
    spacing: Style.spacing.sm

    Row {
      width: parent.width
      spacing: Style.spacing.sm

      PanelSectionHeader {
        text: "Layout"
        width: Style.space(120)
        foreground: canvas.foreground
        fontFamily: Style.font.menuFamily
      }

      ButtonGroup {
        id: modeGroup
        width: Style.space(230)
        height: Style.spacing.controlHeight
        foreground: canvas.foreground
        accent: Color.accent
        options: canvas.modeOptions
        value: canvas.mode
        onChanged: function (next) { canvas.setMode(next) }
      }

      Text {
        textFormat: Text.PlainText
        width: parent.width - Style.space(120) - modeGroup.width - Style.spacing.sm * 2
        height: Style.spacing.controlHeight
        verticalAlignment: Text.AlignVCenter
        text: canvas.mode === "none"
          ? "Off — the compositor arranges this workspace however it likes."
          : (canvas.mode === "tiled"
            ? "Tiled — windows keep tiling; the drawing becomes a layout rule."
            : "Exact — these windows float at exactly these rectangles.")
        color: canvas.foreground
        opacity: 0.5
        font.family: Style.font.menuFamily
        font.pixelSize: Style.font.caption
        elide: Text.ElideRight
      }
    }

    // ---- presets
    Flow {
      width: parent.width
      visible: canvas.mode !== "none"
      spacing: Style.spacing.xs

      Repeater {
        model: [
          { value: "columns", label: "Columns" },
          { value: "rows", label: "Rows" },
          { value: "mainLeft", label: "Main left" },
          { value: "mainRight", label: "Main right" },
          { value: "mainTop", label: "Main top" },
          { value: "mainBottom", label: "Main bottom" },
          { value: "grid", label: "Grid" }
        ]

        Button {
          required property var modelData
          text: modelData.label
          foreground: canvas.foreground
          fontSize: Style.font.caption
          horizontalPadding: Style.spacing.sm
          bordered: true
          selected: canvas.presetName === modelData.value
          onClicked: canvas.applyPreset(modelData.value)
        }
      }
    }

    // ---- the stage
    Item {
      id: stageHolder
      width: parent.width
      visible: canvas.mode !== "none"
      height: visible ? Math.min(Style.space(210), Math.round(width / Math.max(0.2, canvas.monitorAspect))) : 0

      BorderSurface {
        id: stage
        anchors.fill: parent
        radius: Style.cornerRadius
        color: Color.menu.background
        borderSpec: Border.surfaceSpec("menu", "border", Color.menu.border, Math.max(1, Style.space(1)))

        // The strip the bar reserves at the top of the monitor.
        Rectangle {
          width: parent.width
          height: Math.max(1, stage.height * canvas.barReservePct / 100)
          visible: canvas.barReservePct > 0
          color: canvas.foreground
          opacity: 0.12
        }

        // One MouseArea for the whole stage. Press picks up a tile, movement
        // shows where it would land, release swaps or re-parents. Per-tile
        // grabs lose the pointer as soon as it crosses a boundary, which is
        // the entire gesture.
        MouseArea {
          id: stageMouse
          anchors.fill: parent
          hoverEnabled: true

          onPressed: function (mouse) {
            canvas.chooserPath = null
            canvas.pressX = mouse.x
            canvas.pressY = mouse.y
            var hit = Layout.hitTest(canvas.rects, mouse.x, mouse.y - canvas.reserveHeight)
            canvas.dragPath = hit ? hit.path : null
            canvas.hoverPath = null
            canvas.hoverEdge = ""
          }

          onPositionChanged: function (mouse) {
            if (!canvas.dragPath) return
            var hit = Layout.hitTest(canvas.rects, mouse.x, mouse.y - canvas.reserveHeight)
            if (!hit || Layout.samePath(hit.path, canvas.dragPath)) {
              canvas.hoverPath = null
              canvas.hoverEdge = ""
              return
            }
            canvas.hoverPath = hit.path
            canvas.hoverEdge = hit.edge
          }

          onReleased: function (mouse) {
            var from = canvas.dragPath
            var to = canvas.hoverPath
            var edge = canvas.hoverEdge
            canvas.dragPath = null
            canvas.hoverPath = null
            canvas.hoverEdge = ""
            if (!from) return

            var moved = Math.abs(mouse.x - canvas.pressX) + Math.abs(mouse.y - canvas.pressY)
            if (!to) {
              // A click, not a drag: choose what lives in this tile.
              if (moved < Style.space(6)) canvas.openChooser(from, mouse.x, mouse.y)
              return
            }
            if (edge === "c") canvas.applyTree(Layout.swapLeaves(canvas.tree, from, to), false)
            else canvas.applyTree(Layout.moveLeaf(canvas.tree, from, to, edge), false)
          }

          onCanceled: {
            canvas.dragPath = null
            canvas.hoverPath = null
            canvas.hoverEdge = ""
          }
        }

        Repeater {
          model: canvas.rects

          LayoutRect {
            id: tile
            required property var modelData

            x: tile.modelData.x
            y: tile.modelData.y + canvas.reserveHeight
            width: tile.modelData.w
            height: tile.modelData.h
            foreground: canvas.foreground
            label: canvas.labelFor(tile.modelData.app)
            iconName: canvas.iconFor(tile.modelData.app)
            anyWindow: tile.modelData.app < 0
            canSplit: canvas.rects.length < 8 && tile.modelData.path.length < 4
            dragging: canvas.dragPath !== null && Layout.samePath(canvas.dragPath, tile.modelData.path)
            dropEdge: canvas.hoverPath !== null && Layout.samePath(canvas.hoverPath, tile.modelData.path)
              ? canvas.hoverEdge
              : ""

            onSplitRequested: canvas.splitAt(tile.modelData.path)
            onRemoveRequested: canvas.removeAt(tile.modelData.path)
          }
        }

        Repeater {
          model: canvas.splitters

          LayoutSplitter {
            id: divider
            required property var modelData

            // Widened to something a pointer can catch; the painted line
            // inside stays as thin as the gap it sits in.
            readonly property real grab: Math.max(canvas.gap, Style.space(8))

            x: divider.modelData.dir === "v"
              ? divider.modelData.x
              : divider.modelData.x - (divider.grab - canvas.gap) / 2
            y: divider.modelData.dir === "v"
              ? divider.modelData.y + canvas.reserveHeight - (divider.grab - canvas.gap) / 2
              : divider.modelData.y + canvas.reserveHeight
            width: divider.modelData.dir === "v" ? divider.modelData.w : divider.grab
            height: divider.modelData.dir === "v" ? divider.grab : divider.modelData.h

            foreground: canvas.foreground
            dir: divider.modelData.dir
            boxX: divider.modelData.bx
            boxY: divider.modelData.by + canvas.reserveHeight
            boxW: divider.modelData.bw
            boxH: divider.modelData.bh
            gap: canvas.gap

            // Live drags only repaint; the document is touched once, on release.
            onRatioDragged: function (ratio) {
              canvas.previewTree(Layout.setRatio(canvas.tree, divider.modelData.path, ratio))
            }
            onDragFinished: canvas.changed()
            onDirectionToggled: canvas.applyTree(Layout.toggleDir(canvas.tree, divider.modelData.path), false)
          }
        }

        // ---- the app chooser
        BorderSurface {
          id: chooser
          visible: canvas.chooserPath !== null
          x: canvas.chooserX
          y: canvas.chooserY
          width: Style.space(200)
          height: chooserColumn.implicitHeight + contentTopInset + contentBottomInset
          radius: Style.cornerRadius
          color: Color.menu.background
          borderSpec: Border.surfaceSpec("menu", "border", Color.menu.border, Math.max(1, Style.space(2)))
          padding: Style.spacing.sm
          z: 10

          MouseArea { anchors.fill: parent; onClicked: {} }

          Column {
            id: chooserColumn
            x: chooser.contentLeftInset
            y: chooser.contentTopInset
            width: chooser.width - chooser.contentLeftInset - chooser.contentRightInset
            spacing: Style.space(2)

            Repeater {
              model: {
                canvas.appsRevision
                return canvas.appCount
              }

              Button {
                required property int index
                width: chooserColumn.width
                leftAlign: true
                text: canvas.labelFor(index)
                foreground: canvas.foreground
                fontSize: Style.font.caption
                verticalPadding: Style.spacing.xxs
                onClicked: canvas.chooseApp(index)
              }
            }

            Button {
              width: chooserColumn.width
              leftAlign: true
              text: "Any window"
              tooltipText: "Leave this tile for whatever opens here"
              foreground: canvas.foreground
              fontSize: Style.font.caption
              verticalPadding: Style.spacing.xxs
              onClicked: canvas.chooseApp(-1)
            }

            Button {
              width: chooserColumn.width
              leftAlign: true
              text: "Add an app…"
              foreground: canvas.foreground
              fontSize: Style.font.caption
              verticalPadding: Style.spacing.xxs
              onClicked: {
                canvas.chooserPath = null
                canvas.addAppRequested()
              }
            }
          }
        }
      }
    }

    // ---- fidelity
    Row {
      width: parent.width
      visible: canvas.mode !== "none"
      spacing: Style.spacing.sm

      Text {
        id: fidelity
        textFormat: Text.PlainText
        width: parent.width - (switchButton.visible ? switchButton.width + Style.spacing.sm : 0)
        wrapMode: Text.WordWrap
        text: canvas.mode === "float"
          ? "Exact — every rectangle is emitted as a float / size% / move% window rule. These windows will not tile."
          : (canvas.projection && canvas.projection.layout === ""
            ? "One tile — nothing to arrange yet. Split it, or pick a preset."
            : (canvas.projection && canvas.projection.exact
              ? "Exact — the compositor can render this arrangement as drawn."
              : "Approximated as " + (canvas.projection ? canvas.projection.note.replace(/^.* approximated as /, "") : "")
                + ". Hyprland can only be told a layout and a couple of options per workspace."))
        color: canvas.foreground
        opacity: 0.55
        font.family: Style.font.menuFamily
        font.pixelSize: Style.font.caption
      }

      Button {
        id: switchButton
        visible: canvas.mode === "tiled" && canvas.projection !== null && canvas.projection.exact === false
        text: "Use exact instead"
        tooltipText: "Switch to floating windows placed at exactly these rectangles"
        foreground: canvas.foreground
        fontSize: Style.font.caption
        bordered: true
        onClicked: canvas.setMode("float")
      }
    }

    FieldRow {
      label: "Top inset"
      visible: canvas.mode === "float"
      foreground: canvas.foreground

      NumberField {
        label: "%"
        foreground: canvas.foreground
        from: 0
        to: 50
        fieldWidth: Style.space(96)
        value: canvas.arrangement ? Math.round(Number(canvas.arrangement.topReservePct) || 0) : 0
        onModified: function (next) {
          if (!canvas.arrangement) return
          canvas.arrangement.topReservePct = next
          canvas.rev++
          canvas.changed()
        }
      }

      Text {
        textFormat: Text.PlainText
        height: Style.spacing.controlHeight
        verticalAlignment: Text.AlignVCenter
        text: "room left at the top for the bar; your monitor reserves about "
          + (Math.round(canvas.barReservePct * 10) / 10) + "%"
        color: canvas.foreground
        opacity: 0.5
        font.family: Style.font.menuFamily
        font.pixelSize: Style.font.caption
      }
    }

    Text {
      width: parent.width
      visible: canvas.mode === "tiled" && canvas.layoutOverridden
      textFormat: Text.PlainText
      wrapMode: Text.WordWrap
      text: "Heads up: ~/.local/state/omarchy/workspace-layouts/"
        + (canvas.workspace ? canvas.workspace.id : "") + ".lua exists, written by "
        + "omarchy-hyprland-workspace-layout-toggle. Omarchy loads it after this plugin's file, so it wins "
        + "and Tiled mode will look like it did nothing. Delete it, or use Exact instead."
      color: Color.urgent
      font.family: Style.font.menuFamily
      font.pixelSize: Style.font.caption
    }

    Text {
      width: parent.width
      visible: canvas.mode !== "none"
      textFormat: Text.PlainText
      wrapMode: Text.WordWrap
      text: "Drag a tile onto the middle of another to swap them, or onto an edge to move it there. "
        + "Drag a divider to resize, double-click one to flip it. Click a tile to choose what lives in it."
      color: canvas.foreground
      opacity: 0.4
      font.family: Style.font.menuFamily
      font.pixelSize: Style.font.caption
    }
  }
}
