pragma ComponentBehavior: Bound

import QtQuick
import qs.Commons
import qs.Ui

// One workspace in the editor's left-hand list: the key it answers to, its
// glyph, its name, and a one-line summary of where it lives and what runs
// there. Selection is driven from the Studio so the keyboard cursor and the
// mouse agree.
Rectangle {
  id: root

  property int workspaceId: 0
  property string keyLabel: ""
  property string icon: ""
  property string name: ""
  property string summary: ""
  property bool selected: false
  property bool hasCursor: false
  property bool live: false
  property bool canMoveUp: true
  property bool canMoveDown: true

  property color foreground: Color.menu.text
  property color selectedBackground: Color.menu.selectedBackground
  property color selectedText: Color.menu.selectedText

  signal activated()
  signal moveRequested(int delta)
  signal removeRequested()

  implicitHeight: Style.space(46)
  radius: Style.cornerRadius > 0 ? Style.cornerRadius : Style.space(4)
  color: root.selected ? root.selectedBackground : (hover.hovered ? Style.hoverFillFor(root.foreground, Color.accent, Color.urgent) : "transparent")

  HoverHandler { id: hover }

  MouseArea {
    anchors.fill: parent
    acceptedButtons: Qt.LeftButton
    cursorShape: Qt.PointingHandCursor
    onClicked: root.activated()
  }

  // The keycap: what the user actually presses to get here.
  Rectangle {
    id: keycap
    anchors.left: parent.left
    anchors.leftMargin: Style.spacing.sm
    anchors.verticalCenter: parent.verticalCenter
    width: Style.space(26)
    height: Style.space(22)
    radius: Style.cornerRadius > 0 ? Style.cornerRadius : Style.space(3)
    color: "transparent"
    border.width: 1
    border.color: Util.alpha(root.foreground, 0.28)

    Text {
      anchors.centerIn: parent
      textFormat: Text.PlainText
      text: root.keyLabel
      color: root.foreground
      opacity: 0.75
      font.family: Style.font.menuFamily
      font.pixelSize: Style.font.caption
    }
  }

  Text {
    id: glyph
    anchors.left: keycap.right
    anchors.leftMargin: Style.spacing.md
    anchors.verticalCenter: parent.verticalCenter
    width: Style.space(34)
    horizontalAlignment: Text.AlignHCenter
    textFormat: Text.PlainText
    text: root.icon || "·"
    color: root.selected ? root.selectedText : root.foreground
    opacity: root.icon ? 1 : 0.35
    font.family: Style.font.menuFamily
    font.pixelSize: Style.font.title
  }

  Column {
    anchors.left: glyph.right
    anchors.leftMargin: Style.spacing.sm
    anchors.right: actions.left
    anchors.rightMargin: Style.spacing.sm
    anchors.verticalCenter: parent.verticalCenter
    spacing: Style.spacing.xxs

    Text {
      width: parent.width
      textFormat: Text.PlainText
      text: root.name || "Workspace " + root.keyLabel
      color: root.selected ? root.selectedText : root.foreground
      opacity: root.name ? 1 : 0.55
      font.family: Style.font.menuFamily
      font.pixelSize: Style.font.body
      elide: Text.ElideRight
    }

    Text {
      width: parent.width
      visible: root.summary !== ""
      textFormat: Text.PlainText
      text: root.summary
      color: root.foreground
      opacity: 0.5
      font.family: Style.font.menuFamily
      font.pixelSize: Style.font.caption
      elide: Text.ElideRight
    }
  }

  Row {
    id: actions
    anchors.right: parent.right
    anchors.rightMargin: Style.spacing.sm
    anchors.verticalCenter: parent.verticalCenter
    spacing: Style.spacing.xxs
    opacity: root.selected || hover.hovered ? 1 : 0

    Behavior on opacity { NumberAnimation { duration: 90 } }

    PanelActionButton {
      iconText: "\uDB80\uDC5D"
      tooltipText: "Move up"
      enabled: root.canMoveUp
      opacity: root.canMoveUp ? 1 : 0.3
      foreground: root.foreground
      size: Style.space(22)
      onClicked: root.moveRequested(-1)
    }

    PanelActionButton {
      iconText: "\uDB80\uDC45"
      tooltipText: "Move down"
      enabled: root.canMoveDown
      opacity: root.canMoveDown ? 1 : 0.3
      foreground: root.foreground
      size: Style.space(22)
      onClicked: root.moveRequested(1)
    }

    PanelActionButton {
      iconText: "\uDB82\uDE79"
      tooltipText: "Remove workspace"
      foreground: Color.urgent
      hoverColor: Color.urgent
      size: Style.space(22)
      onClicked: root.removeRequested()
    }
  }

  // Cursor ring: the keyboard's idea of "here", distinct from selection so
  // both can be visible while the cursor is in the detail column.
  Rectangle {
    anchors.fill: parent
    visible: root.hasCursor
    color: "transparent"
    radius: parent.radius
    border.width: Math.max(1, Style.space(1))
    border.color: Util.alpha(Color.accent, 0.8)
  }

  // A workspace that exists in the compositor right now.
  Rectangle {
    visible: root.live
    anchors.left: parent.left
    anchors.verticalCenter: parent.verticalCenter
    width: Math.max(2, Style.space(2))
    height: Style.space(18)
    radius: width / 2
    color: Color.accent
  }
}
