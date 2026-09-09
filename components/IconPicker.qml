pragma ComponentBehavior: Bound

import QtQuick
import qs.Commons
import qs.Ui

// Searchable Nerd Font glyph grid, modelled on the shell's own emoji picker.
//
// The catalogue is the plugin's curated icons.json — every entry was checked
// against the installed JetBrainsMono Nerd Font, so nothing here renders as a
// tofu box. Anything not in the catalogue can still be pasted into the free
// text field at the bottom; a workspace icon is just a string.
Item {
  id: root

  property bool opened: false
  property var icons: []
  property string currentIcon: ""
  property string currentName: ""

  property color background: Color.menu.background
  property color foreground: Color.menu.text
  property color scrim: Color.menu.scrim
  property color selectedBackground: Color.menu.selectedBackground
  property color selectedText: Color.menu.selectedText
  property var borderSpec: Border.surfaceSpec("menu", "border", Color.menu.border, Math.max(1, Style.space(2)))

  property string filterText: ""
  property int selectedIndex: 0
  property string freeText: ""

  signal picked(string glyph, string iconName)
  signal dismissed()

  visible: opened
  z: 50

  readonly property int cellSize: Math.max(Style.space(46), Style.font.displayLarge + Style.spacing.lg)
  readonly property int columns: Math.max(1, Math.floor((card.width - Style.spacing.panelPadding * 2) / cellSize))

  function open(icon, iconName) {
    root.currentIcon = icon || ""
    root.currentName = iconName || ""
    root.freeText = icon || ""
    root.filterText = ""
    root.selectedIndex = 0
    root.opened = true
    root.rebuild()
    Qt.callLater(function () { keys.forceActiveFocus() })
  }

  function close() {
    root.opened = false
    root.dismissed()
  }

  function matches(entry, needle) {
    if (!needle) return true
    var haystack = (entry.name + " " + entry.keywords + " " + entry.group).toLowerCase()
    var words = needle.toLowerCase().split(/\s+/)
    for (var i = 0; i < words.length; i++) {
      if (words[i] && haystack.indexOf(words[i]) === -1) return false
    }
    return true
  }

  function rebuild() {
    results.clear()
    for (var i = 0; i < root.icons.length; i++) {
      var entry = root.icons[i]
      if (!root.matches(entry, root.filterText)) continue
      results.append({ glyph: entry.glyph, iconName: entry.name, group: entry.group })
    }
    if (root.selectedIndex >= results.count) root.selectedIndex = Math.max(0, results.count - 1)
  }

  function setFilter(next) {
    root.filterText = next
    root.selectedIndex = 0
    root.rebuild()
    Qt.callLater(function () { grid.positionViewAtIndex(0, GridView.Beginning) })
  }

  function move(delta) {
    if (results.count === 0) return
    var next = root.selectedIndex + delta
    if (next < 0) next = 0
    if (next >= results.count) next = results.count - 1
    root.selectedIndex = next
    grid.positionViewAtIndex(next, GridView.Contain)
  }

  function activate() {
    if (results.count === 0 || root.selectedIndex < 0) return
    var row = results.get(root.selectedIndex)
    root.picked(row.glyph, row.iconName)
    root.opened = false
  }

  ListModel { id: results }

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
    width: Math.min(Style.space(560), parent.width - Style.space(60))
    height: Math.min(Style.space(520), parent.height - Style.space(60))
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
        if (freeField.activeFocus) return
        if (event.key === Qt.Key_Escape) {
          if (root.filterText) root.setFilter("")
          else root.close()
          event.accepted = true
        } else if (event.key === Qt.Key_Backspace) {
          root.setFilter(root.filterText.slice(0, -1))
          event.accepted = true
        } else if (event.key === Qt.Key_Left) {
          root.move(-1); event.accepted = true
        } else if (event.key === Qt.Key_Right) {
          root.move(1); event.accepted = true
        } else if (event.key === Qt.Key_Up) {
          root.move(-root.columns); event.accepted = true
        } else if (event.key === Qt.Key_Down) {
          root.move(root.columns); event.accepted = true
        } else if (event.key === Qt.Key_PageUp) {
          root.move(-root.columns * 4); event.accepted = true
        } else if (event.key === Qt.Key_PageDown) {
          root.move(root.columns * 4); event.accepted = true
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
            text: root.filterText || "Type to search icons…"
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
          height: parent.height - Style.space(150)

          GridView {
            id: grid
            anchors.fill: parent
            clip: true
            model: results
            cellWidth: root.cellSize
            cellHeight: root.cellSize
            boundsBehavior: Flickable.StopAtBounds

            delegate: Rectangle {
              id: cell
              required property int index
              required property string glyph
              required property string iconName

              width: root.cellSize
              height: root.cellSize
              radius: Style.cornerRadius > 0 ? Style.cornerRadius : Style.space(4)
              color: cell.index === root.selectedIndex ? root.selectedBackground : "transparent"

              Text {
                anchors.centerIn: parent
                textFormat: Text.PlainText
                text: cell.glyph
                color: cell.index === root.selectedIndex ? root.selectedText : root.foreground
                font.family: Style.font.menuFamily
                font.pixelSize: Style.font.displayLarge
              }

              MouseArea {
                anchors.fill: parent
                hoverEnabled: true
                cursorShape: Qt.PointingHandCursor
                onContainsMouseChanged: if (containsMouse) root.selectedIndex = cell.index
                onClicked: {
                  root.selectedIndex = cell.index
                  root.activate()
                }
              }
            }
          }

          Text {
            anchors.centerIn: parent
            visible: results.count === 0
            textFormat: Text.PlainText
            text: "No icon matches “" + root.filterText + "”"
            color: root.foreground
            opacity: 0.6
            font.family: Style.font.menuFamily
            font.pixelSize: Style.font.title
          }
        }

        Text {
          width: parent.width
          textFormat: Text.PlainText
          text: results.count > 0 && root.selectedIndex < results.count
            ? results.get(root.selectedIndex).iconName + "  ·  " + results.get(root.selectedIndex).group
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
            width: Style.space(96)
            height: Style.spacing.controlHeight
            verticalAlignment: Text.AlignVCenter
            text: "Or paste"
            color: root.foreground
            opacity: 0.7
            font.family: Style.font.menuFamily
            font.pixelSize: Style.font.bodySmall
          }

          TextField {
            id: freeField
            width: parent.width - Style.space(96) - useButton.width - clearButton.width - Style.spacing.sm * 3
            foreground: root.foreground
            placeholderText: "Any glyph, or two side by side"
            verticalPadding: Style.spacing.sm
            text: root.freeText
            onTextChanged: root.freeText = text
            onAccepted: {
              root.picked(root.freeText, "")
              root.opened = false
            }
          }

          Button {
            id: useButton
            text: "Use"
            foreground: root.foreground
            onClicked: {
              root.picked(root.freeText, "")
              root.opened = false
            }
          }

          Button {
            id: clearButton
            text: "None"
            tooltipText: "Fall back to the workspace number"
            foreground: root.foreground
            onClicked: {
              root.picked("", "")
              root.opened = false
            }
          }
        }
      }
    }
  }
}
