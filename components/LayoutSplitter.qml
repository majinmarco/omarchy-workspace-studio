pragma ComponentBehavior: Bound

import QtQuick
import qs.Commons

// The boundary between the two halves of one split node.
//
// Its hit area is the gap between the tiles, widened to something a mouse can
// actually catch; the painted line stays thin. Dragging sets the split's
// ratio, double-clicking flips it between side-by-side and stacked.
Item {
  id: root

  property color foreground: Color.menu.text
  property string dir: "h"
  property bool active: false

  // Where the drag is: the parent split's box, in stage coordinates, so a
  // cursor position turns into a ratio without walking the tree again.
  property real boxX: 0
  property real boxY: 0
  property real boxW: 0
  property real boxH: 0
  property real gap: 0

  signal ratioDragged(real ratio)
  signal dragFinished()
  signal directionToggled()

  readonly property bool horizontal: root.dir !== "v"

  Rectangle {
    anchors.centerIn: parent
    width: root.horizontal ? Math.max(1, Style.space(2)) : parent.width
    height: root.horizontal ? parent.height : Math.max(1, Style.space(2))
    radius: width < height ? width / 2 : height / 2
    color: root.active || hover.hovered ? Color.accent : root.foreground
    opacity: root.active || hover.hovered ? 1 : 0.35
  }

  HoverHandler { id: hover }

  MouseArea {
    anchors.fill: parent
    // A splitter is a few pixels wide; the default 10px start threshold would
    // swallow most of a short drag before it began.
    drag.threshold: 0
    cursorShape: root.horizontal ? Qt.SplitHCursor : Qt.SplitVCursor
    hoverEnabled: true

    onPressed: root.active = true
    onReleased: {
      root.active = false
      root.dragFinished()
    }
    onCanceled: root.active = false
    onDoubleClicked: root.directionToggled()

    onPositionChanged: function (mouse) {
      if (!pressed) return
      var point = mapToItem(root.parent, mouse.x, mouse.y)
      var span = (root.horizontal ? root.boxW : root.boxH) - root.gap
      if (span <= 0) return
      var offset = root.horizontal ? point.x - root.boxX : point.y - root.boxY
      root.ratioDragged(offset / span)
    }
  }
}
