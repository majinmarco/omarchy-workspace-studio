pragma ComponentBehavior: Bound

import QtQuick
import qs.Commons
import qs.Ui

// The generated Lua, before it is written. Two views: a diff against the file
// currently on disk, and the whole file.
//
// This is the plugin's answer to "does not overwrite user configuration
// without explicit consent" — you can read exactly what Apply is about to do,
// down to the line, before pressing it.
Item {
  id: root

  property bool opened: false
  property var diff: []
  property string luaText: ""
  property string targetPath: ""
  property bool showFullFile: false

  property color background: Color.menu.background
  property color foreground: Color.menu.text
  property color scrim: Color.menu.scrim
  property var borderSpec: Border.surfaceSpec("menu", "border", Color.menu.border, Math.max(1, Style.space(2)))

  signal dismissed()
  signal applyRequested()

  visible: opened
  z: 40

  readonly property int addedCount: {
    var n = 0
    for (var i = 0; i < root.diff.length; i++) if (root.diff[i].type === "+") n++
    return n
  }
  readonly property int removedCount: {
    var n = 0
    for (var i = 0; i < root.diff.length; i++) if (root.diff[i].type === "-") n++
    return n
  }

  function open() {
    root.opened = true
    root.rebuild()
    Qt.callLater(function () { keys.forceActiveFocus() })
  }

  function close() {
    root.opened = false
    root.dismissed()
  }

  function rebuild() {
    lines.clear()
    var i
    if (root.showFullFile) {
      var full = root.luaText.split("\n")
      for (i = 0; i < full.length; i++) lines.append({ mark: " ", body: full[i] })
      return
    }
    for (i = 0; i < root.diff.length; i++) {
      lines.append({ mark: root.diff[i].type, body: root.diff[i].text })
    }
  }

  onShowFullFileChanged: if (opened) rebuild()

  function markColor(mark) {
    if (mark === "+") return Qt.rgba(0.45, 0.78, 0.5, 1)
    if (mark === "-") return Color.urgent
    return root.foreground
  }

  ListModel { id: lines }

  Rectangle { anchors.fill: parent; color: root.scrim }
  MouseArea { anchors.fill: parent; onClicked: root.close() }

  BorderSurface {
    id: card
    anchors.centerIn: parent
    width: Math.min(Style.space(880), parent.width - Style.space(48))
    height: Math.min(Style.space(620), parent.height - Style.space(48))
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
        if (event.key === Qt.Key_Escape) { root.close(); event.accepted = true }
        else if (event.text === "f") { root.showFullFile = !root.showFullFile; event.accepted = true }
        else if (event.key === Qt.Key_Return || event.key === Qt.Key_Enter) {
          root.applyRequested(); event.accepted = true
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
          spacing: Style.spacing.controlGap

          Column {
            width: parent.width - viewToggle.width - closeButton.width - Style.spacing.controlGap * 2
            spacing: Style.spacing.xxs

            Text {
              textFormat: Text.PlainText
              text: root.showFullFile ? "Generated Hyprland config" : "Changes to the generated Hyprland config"
              color: root.foreground
              font.family: Style.font.menuFamily
              font.pixelSize: Style.font.title
            }

            Text {
              textFormat: Text.PlainText
              width: parent.width
              text: root.targetPath + (root.showFullFile
                ? ""
                : "   ·   +" + root.addedCount + " / -" + root.removedCount)
              color: root.foreground
              opacity: 0.55
              font.family: Style.font.menuFamily
              font.pixelSize: Style.font.caption
              elide: Text.ElideMiddle
            }
          }

          Button {
            id: viewToggle
            text: root.showFullFile ? "Show diff" : "Show whole file"
            foreground: root.foreground
            bordered: true
            onClicked: root.showFullFile = !root.showFullFile
          }

          Button {
            id: closeButton
            text: "Close"
            foreground: root.foreground
            bordered: true
            onClicked: root.close()
          }
        }

        PanelSeparator { width: parent.width; foreground: root.foreground }

        ListView {
          id: listing
          width: parent.width
          height: parent.height - Style.space(112)
          clip: true
          model: lines
          boundsBehavior: Flickable.StopAtBounds

          delegate: Row {
            id: lineRow
            required property string mark
            required property string body

            width: listing.width
            spacing: Style.spacing.sm

            Text {
              textFormat: Text.PlainText
              width: Style.space(14)
              text: lineRow.mark
              color: root.markColor(lineRow.mark)
              opacity: lineRow.mark === " " ? 0.3 : 1
              font.family: Style.font.family
              font.pixelSize: Style.font.bodySmall
            }

            Text {
              textFormat: Text.PlainText
              width: listing.width - Style.space(14) - Style.spacing.sm
              text: lineRow.body
              color: root.markColor(lineRow.mark)
              opacity: lineRow.mark === " " ? 0.62 : 1
              font.family: Style.font.family
              font.pixelSize: Style.font.bodySmall
              elide: Text.ElideRight
            }
          }
        }

        Text {
          width: parent.width
          textFormat: Text.PlainText
          visible: lines.count === 0
          text: "No changes — the file on disk already matches this config."
          color: root.foreground
          opacity: 0.6
          font.family: Style.font.menuFamily
          font.pixelSize: Style.font.body
        }

        Row {
          width: parent.width
          spacing: Style.spacing.controlGap

          Text {
            textFormat: Text.PlainText
            width: parent.width - applyButton.width - Style.spacing.controlGap
            height: Style.spacing.controlHeight
            verticalAlignment: Text.AlignVCenter
            text: "f  toggle whole file      enter  apply      esc  back"
            color: root.foreground
            opacity: 0.45
            font.family: Style.font.menuFamily
            font.pixelSize: Style.font.caption
          }

          Button {
            id: applyButton
            text: "Apply these changes"
            foreground: root.foreground
            accent: Color.accent
            bordered: true
            active: true
            onClicked: root.applyRequested()
          }
        }
      }
    }
  }
}
