pragma ComponentBehavior: Bound

import QtQuick
import qs.Commons
import qs.Ui

// First run: offer to adopt the workspace layout the user already hand-wrote.
//
// Two rules govern this screen. It never edits ~/.config/hypr/*.lua — it shows
// the lines it read and asks the user to remove them. And it never applies on
// its own: importing fills the editor in, and Apply stays a separate,
// deliberate press.
Item {
  id: root

  property bool opened: false
  property var windowRules: []
  property var autostart: []
  property var barIcons: ({})
  property int barIconCount: 0
  property string clashingWidgetId: ""
  property string removalReport: ""
  property string launchMode: "onCreatedEmpty"

  property color background: Color.menu.background
  property color foreground: Color.menu.text
  property color scrim: Color.menu.scrim
  property var borderSpec: Border.surfaceSpec("menu", "border", Color.menu.border, Math.max(1, Style.space(2)))

  signal importRequested(string launchMode)
  signal dismissed()

  visible: opened
  z: 45

  readonly property bool foundAnything: windowRules.length > 0 || autostart.length > 0 || barIconCount > 0

  readonly property var launchOptions: [
    { value: "onCreatedEmpty", label: "Start apps on first visit (recommended)" },
    { value: "autostart", label: "Start apps at login, keeping the delays" },
    { value: "none", label: "Import the window rules only" }
  ]

  function open() {
    root.opened = true
    Qt.callLater(function () { keys.forceActiveFocus() })
  }

  function close() {
    root.opened = false
    root.dismissed()
  }

  Rectangle { anchors.fill: parent; color: root.scrim }
  MouseArea { anchors.fill: parent; onClicked: root.close() }

  BorderSurface {
    id: card
    anchors.centerIn: parent
    width: Math.min(Style.space(760), parent.width - Style.space(48))
    height: Math.min(Style.space(600), parent.height - Style.space(48))
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
      }

      Column {
        anchors.fill: parent
        anchors.topMargin: card.contentTopInset
        anchors.rightMargin: card.contentRightInset
        anchors.bottomMargin: card.contentBottomInset
        anchors.leftMargin: card.contentLeftInset
        spacing: Style.spacing.md

        Text {
          width: parent.width
          textFormat: Text.PlainText
          text: root.foundAnything ? "You already have a workspace layout" : "Nothing to import"
          color: root.foreground
          font.family: Style.font.menuFamily
          font.pixelSize: Style.font.heading
        }

        Text {
          width: parent.width
          textFormat: Text.PlainText
          wrapMode: Text.WordWrap
          text: root.foundAnything
            ? "Workspace Studio found the layout you wrote by hand. Importing copies it into the editor so you can keep going from here. Nothing is applied and no file of yours is touched until you press Apply."
            : "No o.window rules, autostart launches or bar-clone icons were found. Start from scratch instead — add a workspace and give it an icon."
          color: root.foreground
          opacity: 0.72
          font.family: Style.font.menuFamily
          font.pixelSize: Style.font.body
        }

        PanelSeparator { width: parent.width; foreground: root.foreground }

        Column {
          width: parent.width
          spacing: Style.spacing.sm
          visible: root.foundAnything

          Repeater {
            model: [
              {
                icon: "󰖟",
                text: root.windowRules.length + " window rule" + (root.windowRules.length === 1 ? "" : "s") + " in ~/.config/hypr/hyprland.lua",
                on: root.windowRules.length > 0
              },
              {
                icon: "󰐊",
                text: root.autostart.length + " launch" + (root.autostart.length === 1 ? "" : "es") + " in ~/.config/hypr/autostart.lua",
                on: root.autostart.length > 0
              },
              {
                icon: "󰃖",
                text: root.barIconCount + " icon" + (root.barIconCount === 1 ? "" : "s") + " from your bar widget clone",
                on: root.barIconCount > 0
              }
            ]

            Row {
              id: findingRow
              required property var modelData
              spacing: Style.spacing.sm
              opacity: findingRow.modelData.on ? 1 : 0.4

              Text {
                textFormat: Text.PlainText
                width: Style.space(24)
                text: findingRow.modelData.icon
                color: root.foreground
                font.family: Style.font.menuFamily
                font.pixelSize: Style.font.subtitle
              }

              Text {
                textFormat: Text.PlainText
                text: findingRow.modelData.text
                color: root.foreground
                font.family: Style.font.menuFamily
                font.pixelSize: Style.font.body
              }
            }
          }
        }

        Column {
          width: parent.width
          spacing: Style.spacing.xs
          visible: root.foundAnything

          Text {
            textFormat: Text.PlainText
            text: "How should the apps start?"
            color: root.foreground
            opacity: 0.72
            font.family: Style.font.menuFamily
            font.pixelSize: Style.font.bodySmall
          }

          Dropdown {
            width: Math.min(Style.space(420), parent.width)
            showLabel: false
            foreground: root.foreground
            options: root.launchOptions
            value: root.launchMode
            onChanged: function (next) { root.launchMode = next }
          }

          Text {
            width: parent.width
            textFormat: Text.PlainText
            wrapMode: Text.WordWrap
            text: root.launchMode === "onCreatedEmpty"
              ? "on_created_empty: each app starts the first time you land on its empty workspace. No boot cost and no sleep races."
              : (root.launchMode === "autostart"
                ? "exec-once at login, keeping your staggered delays. Same behaviour you have today."
                : "Only the window rules are imported; nothing is started for you.")
            color: root.foreground
            opacity: 0.5
            font.family: Style.font.menuFamily
            font.pixelSize: Style.font.caption
          }
        }

        // The bar can end up drawing two sets of workspace buttons; we cannot
        // fix that ourselves, because free-form shell.json edits are denied to
        // ordinary plugins. So hand over the exact command.
        Column {
          width: parent.width
          spacing: Style.spacing.xxs
          visible: root.clashingWidgetId !== ""

          PanelSeparator { width: parent.width; foreground: root.foreground }

          Text {
            width: parent.width
            textFormat: Text.PlainText
            wrapMode: Text.WordWrap
            text: "“" + root.clashingWidgetId + "” is still on your bar and will draw a second row of workspace buttons. Remove it with:"
            color: root.foreground
            opacity: 0.72
            font.family: Style.font.menuFamily
            font.pixelSize: Style.font.bodySmall
          }

          TextEdit {
            width: parent.width
            readOnly: true
            selectByMouse: true
            wrapMode: TextEdit.Wrap
            text: "omarchy plugin disable " + root.clashingWidgetId
            color: Color.accent
            font.family: Style.font.family
            font.pixelSize: Style.font.bodySmall
          }
        }

        PanelSeparator { width: parent.width; foreground: root.foreground; visible: root.removalReport !== "" }

        Flickable {
          width: parent.width
          height: Math.max(Style.space(60), parent.height - Style.space(430))
          visible: root.removalReport !== ""
          contentWidth: width
          contentHeight: reportText.implicitHeight
          clip: true
          boundsBehavior: Flickable.StopAtBounds

          TextEdit {
            id: reportText
            width: parent.width
            readOnly: true
            selectByMouse: true
            wrapMode: TextEdit.NoWrap
            text: root.removalReport
            color: root.foreground
            opacity: 0.7
            font.family: Style.font.family
            font.pixelSize: Style.font.caption
          }
        }

        Row {
          width: parent.width
          spacing: Style.spacing.controlGap

          Button {
            text: root.foundAnything ? "Not now" : "Close"
            foreground: root.foreground
            bordered: true
            onClicked: root.close()
          }

          Button {
            visible: root.foundAnything
            text: "Import into the editor"
            foreground: root.foreground
            accent: Color.accent
            active: true
            bordered: true
            onClicked: root.importRequested(root.launchMode)
          }
        }
      }
    }
  }
}
