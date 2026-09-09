pragma ComponentBehavior: Bound

import QtQuick
import Quickshell
import qs.Commons
import qs.Ui

// One tile on the layout canvas: a leaf of the slicing tree, drawn where
// Layout.computeRects says it goes.
//
// It is deliberately dumb. Press, drag and release are handled by one
// MouseArea covering the whole stage, because a per-tile grab loses the
// pointer the moment the cursor crosses into a neighbour — which is exactly
// what a drag-to-swap gesture does. The two buttons here sit above that
// MouseArea and take their own clicks.
BorderSurface {
  id: root

  property color foreground: Color.menu.text
  property string label: ""
  property string iconName: ""
  property bool anyWindow: false
  property bool dragging: false
  // "", "c" for the swap target, or "n" / "e" / "s" / "w" for the half a drop
  // would carve out.
  property string dropEdge: ""
  property bool canSplit: true

  signal splitRequested()
  signal removeRequested()

  radius: Style.cornerRadius
  color: root.dragging
    ? Style.pressedFillFor(root.foreground, Color.accent, Color.urgent)
    : Style.normalFillFor(root.foreground, Color.accent, Color.urgent)
  borderSpec: Border.controlSpec(root.dropEdge !== "" || root.dragging ? "selected" : "normal",
    root.foreground, Color.accent)
  padding: Style.spacing.xs

  // The half of the tile a drop would take. Drawn as a filled overlay rather
  // than an outline so the answer to "which side am I about to land on" is
  // readable at a glance and at this size.
  Rectangle {
    visible: root.dropEdge !== "" && root.dropEdge !== "c"
    color: Color.accent
    opacity: 0.28
    x: root.dropEdge === "e" ? root.width / 2 : 0
    y: root.dropEdge === "s" ? root.height / 2 : 0
    width: root.dropEdge === "n" || root.dropEdge === "s" ? root.width : root.width / 2
    height: root.dropEdge === "e" || root.dropEdge === "w" ? root.height : root.height / 2
  }

  Rectangle {
    anchors.fill: parent
    visible: root.dropEdge === "c"
    color: Color.accent
    opacity: 0.2
    radius: root.radius
  }

  Column {
    anchors.centerIn: parent
    width: parent.width - Style.spacing.md * 2
    spacing: Style.space(3)

    Image {
      visible: root.iconName !== "" && root.height > Style.space(52)
      width: Style.font.iconLarge
      height: visible ? Style.font.iconLarge : 0
      anchors.horizontalCenter: parent.horizontalCenter
      fillMode: Image.PreserveAspectFit
      sourceSize.width: Style.font.iconLarge * Screen.devicePixelRatio
      sourceSize.height: Style.font.iconLarge * Screen.devicePixelRatio
      source: root.iconName ? Quickshell.iconPath(root.iconName, true) : ""
      asynchronous: true
    }

    Text {
      width: parent.width
      textFormat: Text.PlainText
      horizontalAlignment: Text.AlignHCenter
      text: root.label
      color: root.foreground
      opacity: root.anyWindow ? 0.5 : 1
      font.family: Style.font.menuFamily
      font.pixelSize: Style.font.caption
      font.italic: root.anyWindow
      elide: Text.ElideRight
    }
  }

  // Split and remove. Both are tiny, both stay out of the way until the tile
  // is big enough to hold them without covering the label.
  Row {
    anchors.top: parent.top
    anchors.right: parent.right
    anchors.margins: Style.space(2)
    spacing: Style.space(2)
    visible: root.width > Style.space(64) && root.height > Style.space(40)

    PanelActionButton {
      iconText: "󰐕"
      tooltipText: "Split this tile"
      visible: root.canSplit
      foreground: root.foreground
      size: Style.space(18)
      onClicked: root.splitRequested()
    }

    PanelActionButton {
      iconText: "󰅖"
      tooltipText: "Remove this tile"
      foreground: Color.urgent
      hoverColor: Color.urgent
      size: Style.space(18)
      onClicked: root.removeRequested()
    }
  }
}
