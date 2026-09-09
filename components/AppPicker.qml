pragma ComponentBehavior: Bound

import QtQuick
import Quickshell
import Quickshell.Io
import qs.Commons
import qs.Ui
import "../AppSearch.js" as AppSearch
import "../Config.js" as Config

// Pick an installed application instead of typing a command.
//
// The entries come from Quickshell's DesktopEntries singleton, read directly.
// The obvious route — `shell.appLibrary` — is gated on a plugin declaring the
// "menu" kind (shell.qml:601-604), and Workspace Studio is a bar widget and an
// overlay; taking that kind to reach a list of .desktop files would also demand
// an entryPoints.menu and would describe the plugin as something it is not.
// The plugin surface is explicitly not a QML sandbox, so the singleton is
// reachable and the ranking is a vendored copy of the launcher's own.
//
// Modelled on IconPicker: the same opened flag, open()/close(), filterText,
// selectedIndex, rebuild()-into-a-ListModel and picked()/dismissed() signals,
// because that is already this plugin's modal idiom and Studio composes
// anyModalOpen from exactly those flags. Keys are handled here rather than by
// PanelKeyCatcher, which swallows j/k/l/h/x as navigation — wrong when the
// thing you are doing is typing a search.
Item {
  id: root

  property bool opened: false
  property string omarchyPath: ""

  property color background: Color.menu.background
  property color foreground: Color.menu.text
  property color scrim: Color.menu.scrim
  property color selectedBackground: Color.menu.selectedBackground
  property color selectedText: Color.menu.selectedText
  property var borderSpec: Border.surfaceSpec("menu", "border", Color.menu.border, Math.max(1, Style.space(2)))

  property string filterText: ""
  property int selectedIndex: 0

  // { id, name, icon, execString, startupClass } — a plain copy, because the
  // DesktopEntry is a C++ object and the picked values are cached in the JSON.
  signal picked(var entry)
  signal manualRequested()
  signal dismissed()

  visible: opened
  z: 50

  // launcher.hides is the same file the shell's own AppLibrary watches. Its
  // ids are apps the user has already said they do not want to see.
  property var hiddenIds: ({})

  FileView {
    id: hidesFile
    path: root.omarchyPath ? root.omarchyPath + "/default/omarchy/launcher.hides" : ""
    printErrors: false
    onLoaded: root.loadHides(text())
    onLoadFailed: root.hiddenIds = ({})
  }

  function loadHides(raw) {
    var map = {}
    var lines = String(raw || "").split("\n")
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i].replace(/#.*$/, "").replace(/^\s+|\s+$/g, "")
      if (line) map[line] = true
    }
    root.hiddenIds = map
  }

  function isHidden(entry) {
    if (!entry) return true
    if (entry.noDisplay) return true
    return root.hiddenIds[String(entry.id || "")] === true
  }

  // AppLibrary.iconSource minus the scanned index, which only matters for apps
  // installed after the shell started.
  function iconFor(name) {
    var value = String(name || "")
    if (value.length === 0) return Quickshell.iconPath("application-x-executable", true)
    if (value.indexOf("file://") === 0 || value.indexOf("image://") === 0) return value
    if (value.charAt(0) === "/") return "file://" + value
    var themed = Quickshell.iconPath(value, true)
    if (themed.length > 0) return themed
    return Quickshell.iconPath("application-x-executable", true)
  }

  function open() {
    root.filterText = ""
    root.selectedIndex = 0
    root.opened = true
    hidesFile.reload()
    root.rebuild()
    Qt.callLater(function () { keys.forceActiveFocus() })
  }

  function close() {
    root.opened = false
    root.dismissed()
  }

  // ~50 visible entries out of 95 installed, so a full re-sort per keystroke is
  // cheaper than any debounce would be.
  function rebuild() {
    results.clear()
    var values = DesktopEntries.applications.values || []
    var rows = AppSearch.sortedEntries(values, root.filterText, function (entry) { return root.isHidden(entry) })
    for (var i = 0; i < rows.length; i++) {
      var entry = rows[i].entry
      var derived = Config.deriveClass({
        id: entry.id,
        name: entry.name,
        execString: entry.execString,
        startupClass: entry.startupClass
      })
      results.append({
        entryId: String(entry.id || ""),
        entryName: AppSearch.entryName(entry),
        entrySubtext: AppSearch.entrySubtext(entry),
        entryIcon: String(entry.icon || ""),
        entryExec: String(entry.execString || ""),
        entryStartupClass: String(entry.startupClass || ""),
        derivedClass: derived["class"],
        derivedSource: derived.source,
        derivedConfidence: derived.confidence
      })
    }
    if (root.selectedIndex >= results.count) root.selectedIndex = Math.max(0, results.count - 1)
  }

  function setFilter(next) {
    root.filterText = next
    root.selectedIndex = 0
    root.rebuild()
    Qt.callLater(function () { list.positionViewAtIndex(0, ListView.Beginning) })
  }

  function move(delta) {
    if (results.count === 0) return
    var next = root.selectedIndex + delta
    if (next < 0) next = 0
    if (next >= results.count) next = results.count - 1
    root.selectedIndex = next
    list.positionViewAtIndex(next, ListView.Contain)
  }

  function activate() {
    if (results.count === 0 || root.selectedIndex < 0) return
    var row = results.get(root.selectedIndex)
    root.opened = false
    root.picked({
      id: row.entryId,
      name: row.entryName,
      icon: row.entryIcon,
      execString: row.entryExec,
      startupClass: row.entryStartupClass,
      "class": row.derivedClass,
      classSource: row.derivedSource,
      confidence: row.derivedConfidence
    })
  }

  ListModel { id: results }

  // Rebuild when apps appear or vanish while the picker is open.
  Connections {
    target: DesktopEntries.applications
    function onValuesChanged() { if (root.opened) root.rebuild() }
  }

  Rectangle {
    anchors.fill: parent
    color: root.scrim
  }

  MouseArea {
    anchors.fill: parent
    onClicked: root.close()
  }

  BorderSurface {
    id: card
    anchors.centerIn: parent
    width: Math.min(Style.space(680), parent.width - Style.space(60))
    height: Math.min(Style.space(560), parent.height - Style.space(60))
    radius: Style.cornerRadius
    color: root.background
    borderSpec: root.borderSpec
    padding: Style.spacing.panelPadding

    MouseArea { anchors.fill: parent; onClicked: {} }

    Item {
      id: keys
      anchors.fill: parent
      focus: root.opened

      Keys.priority: Keys.BeforeItem
      Keys.onPressed: function (event) {
        if (event.key === Qt.Key_Escape) {
          if (root.filterText) root.setFilter("")
          else root.close()
          event.accepted = true
        } else if (event.key === Qt.Key_Backspace) {
          root.setFilter(root.filterText.slice(0, -1))
          event.accepted = true
        } else if (event.key === Qt.Key_Up) {
          root.move(-1); event.accepted = true
        } else if (event.key === Qt.Key_Down) {
          root.move(1); event.accepted = true
        } else if (event.key === Qt.Key_PageUp) {
          root.move(-8); event.accepted = true
        } else if (event.key === Qt.Key_PageDown) {
          root.move(8); event.accepted = true
        } else if (event.key === Qt.Key_Return || event.key === Qt.Key_Enter) {
          root.activate(); event.accepted = true
        } else if (event.text && event.text.length === 1
                   && event.text.charCodeAt(0) >= 32 && event.text.charCodeAt(0) !== 127) {
          root.setFilter(root.filterText + event.text)
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

        Row {
          width: parent.width
          spacing: Style.spacing.sm

          Text {
            textFormat: Text.PlainText
            width: parent.width - counter.width - Style.spacing.sm
            text: root.filterText || "Type to search installed applications…"
            color: root.foreground
            opacity: root.filterText ? 1 : 0.55
            font.family: Style.font.menuFamily
            font.pixelSize: Style.font.heading
            elide: Text.ElideRight
          }

          Text {
            id: counter
            textFormat: Text.PlainText
            text: results.count + ""
            color: root.foreground
            opacity: 0.45
            font.family: Style.font.menuFamily
            font.pixelSize: Style.font.body
          }
        }

        PanelSeparator { width: parent.width; foreground: root.foreground }

        Item {
          width: parent.width
          height: parent.height - Style.space(132)

          ListView {
            id: list
            anchors.fill: parent
            clip: true
            model: results
            spacing: Style.spacing.xxs
            boundsBehavior: Flickable.StopAtBounds

            delegate: Rectangle {
              id: appRow
              required property int index
              required property string entryName
              required property string entrySubtext
              required property string entryIcon
              required property string derivedClass
              required property string derivedConfidence

              width: list.width
              height: Style.spacing.controlHeight + Style.spacing.md
              radius: Style.cornerRadius > 0 ? Style.cornerRadius : Style.space(4)
              color: appRow.index === root.selectedIndex ? root.selectedBackground : "transparent"

              readonly property color rowText: appRow.index === root.selectedIndex ? root.selectedText : root.foreground

              Image {
                id: icon
                width: Style.font.iconLarge
                height: Style.font.iconLarge
                anchors.left: parent.left
                anchors.leftMargin: Style.spacing.sm
                anchors.verticalCenter: parent.verticalCenter
                fillMode: Image.PreserveAspectFit
                // Decode at physical pixels: a logical-size decode leaves PNG
                // icons upscaled and blurry on a HiDPI display.
                sourceSize.width: width * Screen.devicePixelRatio
                sourceSize.height: height * Screen.devicePixelRatio
                source: root.iconFor(appRow.entryIcon)
                asynchronous: true
              }

              Column {
                anchors.left: icon.right
                anchors.leftMargin: Style.spacing.md
                anchors.right: classText.left
                anchors.rightMargin: Style.spacing.md
                anchors.verticalCenter: parent.verticalCenter
                spacing: Style.space(2)

                Text {
                  textFormat: Text.PlainText
                  width: parent.width
                  text: appRow.entryName
                  color: appRow.rowText
                  font.family: Style.font.menuFamily
                  font.pixelSize: Style.font.body
                  elide: Text.ElideRight
                }

                Text {
                  textFormat: Text.PlainText
                  width: parent.width
                  visible: appRow.entrySubtext.length > 0
                  text: appRow.entrySubtext
                  color: appRow.rowText
                  opacity: 0.52
                  font.family: Style.font.menuFamily
                  font.pixelSize: Style.font.caption
                  elide: Text.ElideRight
                }
              }

              Text {
                id: classText
                textFormat: Text.PlainText
                anchors.right: parent.right
                anchors.rightMargin: Style.spacing.sm
                anchors.verticalCenter: parent.verticalCenter
                width: Style.space(230)
                horizontalAlignment: Text.AlignRight
                text: appRow.derivedClass
                color: appRow.derivedConfidence === "low" ? Color.urgent : appRow.rowText
                opacity: appRow.derivedConfidence === "low" ? 0.85 : 0.5
                font.family: Style.font.family
                font.pixelSize: Style.font.caption
                elide: Text.ElideLeft
              }

              MouseArea {
                anchors.fill: parent
                hoverEnabled: true
                cursorShape: Qt.PointingHandCursor
                onContainsMouseChanged: if (containsMouse) root.selectedIndex = appRow.index
                onClicked: {
                  root.selectedIndex = appRow.index
                  root.activate()
                }
              }
            }
          }

          Text {
            anchors.centerIn: parent
            visible: results.count === 0
            textFormat: Text.PlainText
            text: root.filterText
              ? "No application matches “" + root.filterText + "”"
              : "No applications found."
            color: root.foreground
            opacity: 0.6
            font.family: Style.font.menuFamily
            font.pixelSize: Style.font.title
          }
        }

        Text {
          width: parent.width
          textFormat: Text.PlainText
          wrapMode: Text.WordWrap
          text: results.count > 0 && root.selectedIndex < results.count
            ? "Window class " + Config.classSourceLabel(results.get(root.selectedIndex).derivedSource)
              + ". Check it with Grab focused window if it looks wrong."
            : " "
          color: root.foreground
          opacity: 0.6
          font.family: Style.font.menuFamily
          font.pixelSize: Style.font.caption
          elide: Text.ElideRight
        }

        PanelSeparator { width: parent.width; foreground: root.foreground }

        Row {
          width: parent.width
          spacing: Style.spacing.sm

          Text {
            textFormat: Text.PlainText
            width: parent.width - manualButton.width - Style.spacing.sm
            height: Style.spacing.controlHeight
            verticalAlignment: Text.AlignVCenter
            text: "↵ pick      ↑ ↓ move      ⌫ back      esc close"
            color: root.foreground
            opacity: 0.45
            font.family: Style.font.menuFamily
            font.pixelSize: Style.font.caption
            elide: Text.ElideRight
          }

          Button {
            id: manualButton
            text: "Enter a command manually…"
            tooltipText: "Type the command yourself instead; a typed command always wins over a picked app"
            foreground: root.foreground
            bordered: true
            onClicked: {
              root.opened = false
              root.manualRequested()
            }
          }
        }
      }
    }
  }
}
