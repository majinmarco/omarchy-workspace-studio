pragma ComponentBehavior: Bound

import QtQuick
import qs.Commons

// One labelled control in an editor column: a fixed-width caption, then
// whatever the caller drops in. A Row rather than anchors so callers can add
// several controls to the same line without fighting a layout.
Row {
  id: root

  property string label: ""
  property color foreground: Color.menu.text
  property real labelWidth: Style.space(132)
  property real rowHeight: Style.spacing.controlHeight
  property bool dimmed: false

  spacing: Style.spacing.controlGap

  Text {
    textFormat: Text.PlainText
    width: root.labelWidth
    height: root.rowHeight
    text: root.label
    color: root.foreground
    opacity: root.dimmed ? 0.4 : 0.72
    font.family: Style.font.menuFamily
    font.pixelSize: Style.font.bodySmall
    verticalAlignment: Text.AlignVCenter
    horizontalAlignment: Text.AlignRight
    elide: Text.ElideRight
  }
}
