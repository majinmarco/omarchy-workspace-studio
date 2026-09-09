pragma ComponentBehavior: Bound

import QtQuick
import qs.Commons
import qs.Ui

// Everything about one workspace: how the bar draws it, what the compositor
// does with it, and which apps live there.
//
// Like AppRow, the controls mutate the `workspace` object in place and emit
// changed(); the Studio owns persistence and re-rendering the list.
Flickable {
  id: root

  required property var workspace
  property var monitors: []
  property color foreground: Color.menu.text
  property bool advancedOpen: false
  // Bumped by the Studio when an app is added or removed, so the Repeater's
  // model changes and the list rebuilds. Plain text edits do not touch it,
  // which is what keeps the cursor in the field you are typing in.
  property int appsRevision: 0

  signal changed()
  signal iconPickRequested()
  signal addAppRequested()
  signal removeAppRequested(int index)
  signal grabRequested(int index)

  contentWidth: width
  contentHeight: body.implicitHeight
  clip: true
  boundsBehavior: Flickable.StopAtBounds

  readonly property var layoutOptions: [
    { value: "", label: "Inherit (global default)" },
    { value: "dwindle", label: "dwindle" },
    { value: "master", label: "master" },
    { value: "scrolling", label: "scrolling" }
  ]
  readonly property var colorOptions: [
    { value: "default", label: "Bar foreground" },
    { value: "accent", label: "Accent" },
    { value: "urgent", label: "Urgent" }
  ]

  readonly property var monitorOptions: {
    var out = [{ value: "", label: "Any monitor" }]
    for (var i = 0; i < root.monitors.length; i++) {
      out.push({ value: root.monitors[i], label: root.monitors[i] })
    }
    return out
  }

  // The advanced numeric fields use -1 for "do not emit this field at all",
  // which is a different thing from 0.
  function numOrUnset(value) {
    return value === null || value === undefined ? -1 : value
  }
  function setNum(key, value) {
    root.workspace.advanced[key] = value < 0 ? null : value
    root.changed()
  }
  function triState(value) {
    return value === true
  }

  Column {
    id: body
    width: root.width
    spacing: Style.spacing.md

    PanelSectionHeader {
      text: "Workspace " + root.workspace.id
      foreground: root.foreground
      fontFamily: Style.font.menuFamily
    }

    // ---------------------------------------------------------- identity

    FieldRow {
      label: "Icon"
      foreground: root.foreground

      Button {
        width: Style.spacing.controlHeight * 1.6
        text: root.workspace.icon || String(root.workspace.id)
        fontSize: Style.font.subtitle
        foreground: root.foreground
        bordered: true
        tooltipText: "Pick an icon"
        onClicked: root.iconPickRequested()
      }

      Button {
        text: "Pick icon…"
        foreground: root.foreground
        bordered: true
        onClicked: root.iconPickRequested()
      }

      Text {
        textFormat: Text.PlainText
        height: Style.spacing.controlHeight
        verticalAlignment: Text.AlignVCenter
        text: root.workspace.iconName || (root.workspace.icon ? "custom" : "no icon — shows the number")
        color: root.foreground
        opacity: 0.5
        font.family: Style.font.menuFamily
        font.pixelSize: Style.font.caption
      }
    }

    FieldRow {
      label: "Name"
      foreground: root.foreground

      TextField {
        width: Style.space(260)
        foreground: root.foreground
        placeholderText: "Web, Term, Chat…"
        maximumLength: 24
        text: root.workspace.name
        onTextChanged: {
          if (root.workspace.name === text) return
          root.workspace.name = text
          root.changed()
        }
      }

      Text {
        textFormat: Text.PlainText
        height: Style.spacing.controlHeight
        verticalAlignment: Text.AlignVCenter
        text: "also the workspace's default name"
        elide: Text.ElideRight
        color: root.foreground
        opacity: 0.5
        font.family: Style.font.menuFamily
        font.pixelSize: Style.font.caption
      }
    }

    FieldRow {
      label: "Colour"
      foreground: root.foreground

      Dropdown {
        width: Style.space(200)
        showLabel: false
        foreground: root.foreground
        options: root.colorOptions
        value: root.workspace.color
        onChanged: function (next) {
          root.workspace.color = next
          root.changed()
        }
      }
    }

    PanelSeparator { width: root.width; foreground: root.foreground }

    // -------------------------------------------------------- compositor

    FieldRow {
      label: "Monitor"
      foreground: root.foreground

      Dropdown {
        width: Style.space(200)
        showLabel: false
        foreground: root.foreground
        options: root.monitorOptions
        value: root.workspace.monitor
        onChanged: function (next) {
          root.workspace.monitor = next
          root.changed()
        }
      }

      Toggle {
        width: Style.space(190)
        label: "Default for it"
        checked: root.workspace["default"] === true
        foreground: root.foreground
        onClicked: {
          root.workspace["default"] = !root.workspace["default"]
          root.changed()
        }
      }
    }

    FieldRow {
      label: "Layout"
      foreground: root.foreground

      Dropdown {
        width: Style.space(200)
        showLabel: false
        foreground: root.foreground
        options: root.layoutOptions
        value: root.workspace.layout
        onChanged: function (next) {
          root.workspace.layout = next
          root.changed()
        }
      }

      Toggle {
        width: Style.space(190)
        label: "Always exists"
        description: "persistent"
        checked: root.workspace.persistent === true
        foreground: root.foreground
        onClicked: {
          root.workspace.persistent = !root.workspace.persistent
          root.changed()
        }
      }
    }

    FieldRow {
      label: ""
      foreground: root.foreground

      Button {
        text: root.advancedOpen ? "Hide advanced rules" : "Advanced rules…"
        foreground: root.foreground
        fontSize: Style.font.caption
        onClicked: root.advancedOpen = !root.advancedOpen
      }
    }

    FieldRow {
      label: "Gaps / border"
      visible: root.advancedOpen
      foreground: root.foreground

      NumberField {
        label: "in"
        foreground: root.foreground
        from: -1
        to: 200
        fieldWidth: Style.space(96)
        value: root.numOrUnset(root.workspace.advanced.gapsIn)
        onModified: function (next) { root.setNum("gapsIn", next) }
      }

      NumberField {
        label: "out"
        foreground: root.foreground
        from: -1
        to: 200
        fieldWidth: Style.space(96)
        value: root.numOrUnset(root.workspace.advanced.gapsOut)
        onModified: function (next) { root.setNum("gapsOut", next) }
      }

      NumberField {
        label: "border"
        foreground: root.foreground
        from: -1
        to: 40
        fieldWidth: Style.space(96)
        value: root.numOrUnset(root.workspace.advanced.borderSize)
        onModified: function (next) { root.setNum("borderSize", next) }
      }

      Text {
        textFormat: Text.PlainText
        height: Style.spacing.controlHeight
        verticalAlignment: Text.AlignVCenter
        text: "-1 inherits"
        color: root.foreground
        opacity: 0.5
        font.family: Style.font.menuFamily
        font.pixelSize: Style.font.caption
      }
    }

    FieldRow {
      label: "Decoration"
      visible: root.advancedOpen
      foreground: root.foreground

      Toggle {
        width: Style.space(150)
        label: "No rounding"
        checked: root.triState(root.workspace.advanced.noRounding)
        foreground: root.foreground
        onClicked: {
          root.workspace.advanced.noRounding = root.workspace.advanced.noRounding === true ? null : true
          root.changed()
        }
      }

      Toggle {
        width: Style.space(150)
        label: "No border"
        checked: root.triState(root.workspace.advanced.noBorder)
        foreground: root.foreground
        onClicked: {
          root.workspace.advanced.noBorder = root.workspace.advanced.noBorder === true ? null : true
          root.changed()
        }
      }

      Toggle {
        width: Style.space(150)
        label: "No shadow"
        checked: root.triState(root.workspace.advanced.noShadow)
        foreground: root.foreground
        onClicked: {
          root.workspace.advanced.noShadow = root.workspace.advanced.noShadow === true ? null : true
          root.changed()
        }
      }
    }

    PanelSeparator { width: root.width; foreground: root.foreground }

    // -------------------------------------------------------------- apps

    Row {
      width: root.width
      spacing: Style.spacing.sm

      PanelSectionHeader {
        text: "Apps"
        width: Style.space(120)
        foreground: root.foreground
        fontFamily: Style.font.menuFamily
      }

      Text {
        textFormat: Text.PlainText
        width: root.width - Style.space(120) - Style.spacing.sm
        text: "Pinning routes NEW windows here. It does not move windows that are already open."
        color: root.foreground
        opacity: 0.5
        font.family: Style.font.menuFamily
        font.pixelSize: Style.font.caption
        wrapMode: Text.WordWrap
      }
    }

    Repeater {
      model: {
        root.appsRevision
        return root.workspace && root.workspace.apps ? root.workspace.apps.length : 0
      }

      AppRow {
        required property int index
        width: root.width
        // Guarded: during a removal the delegate can outlive its row by a
        // frame, and AppRow tolerates a null app rather than throwing.
        app: root.workspace && root.workspace.apps && index < root.workspace.apps.length
          ? root.workspace.apps[index]
          : null
        foreground: root.foreground
        onChanged: root.changed()
        onRemoveRequested: root.removeAppRequested(index)
        onGrabRequested: root.grabRequested(index)
      }
    }

    Row {
      spacing: Style.spacing.sm

      Button {
        text: "Add app"
        iconText: "󰐕"
        foreground: root.foreground
        bordered: true
        onClicked: root.addAppRequested()
      }

      Button {
        text: "Grab focused window"
        iconText: "󰍉"
        tooltipText: "Read class and title from hyprctl activewindow and add them as a new app"
        foreground: root.foreground
        bordered: true
        onClicked: root.grabRequested(-1)
      }
    }

    Item { width: 1; height: Style.spacing.lg }
  }
}
