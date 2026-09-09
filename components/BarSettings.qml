pragma ComponentBehavior: Bound

import QtQuick
import qs.Commons
import qs.Ui

// The bar layer: how the widget draws the workspaces, as opposed to what the
// compositor does with them.
//
// These values live inline on the plugin's entry in ~/.config/omarchy/shell.json,
// which is also what `omarchy bar set majinmarco.workspace-studio <key> <value>`
// addresses and what manifest.barWidget.schema declares. Changing one takes
// effect immediately: the shell re-injects settings into the live widget, with
// no reload of anything.
Flickable {
  id: root

  property var settings: ({})
  property color foreground: Color.menu.text

  signal settingChanged(string key, var value)

  contentWidth: width
  contentHeight: body.implicitHeight
  clip: true
  boundsBehavior: Flickable.StopAtBounds

  function value(key, fallback) {
    var v = root.settings ? root.settings[key] : undefined
    return v === undefined || v === null ? fallback : v
  }

  readonly property var showModeOptions: [
    { value: "auto", label: "Auto (follows “show names”)" },
    { value: "icon", label: "Icon, or the number if none" },
    { value: "number", label: "Number only" },
    { value: "iconAndNumber", label: "Icon and number" },
    { value: "iconAndName", label: "Icon and name" },
    { value: "name", label: "Name only" }
  ]
  readonly property var showEmptyOptions: [
    { value: "auto", label: "Auto (follows “dim empty”)" },
    { value: "always", label: "Always full strength" },
    { value: "dim", label: "Dim them" },
    { value: "hide", label: "Hide them" }
  ]
  readonly property var focusStyleOptions: [
    { value: "underline", label: "Underline" },
    { value: "marker", label: "Marker glyph" },
    { value: "accent", label: "Accent colour" },
    { value: "fill", label: "Filled pill" },
    { value: "none", label: "Nothing" }
  ]
  readonly property var focusColorOptions: [
    { value: "foreground", label: "Bar foreground" },
    { value: "accent", label: "Accent" },
    { value: "urgent", label: "Urgent" }
  ]
  readonly property var widthOptions: [
    { value: "auto", label: "Grow to fit the label" },
    { value: "fixed", label: "Fixed width" }
  ]
  readonly property var fontOptions: [
    { value: "caption", label: "caption" },
    { value: "bodySmall", label: "bodySmall" },
    { value: "body", label: "body" },
    { value: "subtitle", label: "subtitle" },
    { value: "title", label: "title" },
    { value: "heading", label: "heading" },
    { value: "icon", label: "icon" },
    { value: "iconLarge", label: "iconLarge" }
  ]
  readonly property var tooltipOptions: [
    { value: "none", label: "No tooltip" },
    { value: "number", label: "Workspace number" },
    { value: "name", label: "Name and number" },
    { value: "nameAndApps", label: "Name, number and apps" }
  ]
  readonly property var rightClickOptions: [
    { value: "openStudio", label: "Open this editor" },
    { value: "moveWindowHere", label: "Move the focused window here" },
    { value: "none", label: "Nothing" }
  ]
  readonly property var wheelOptions: [
    { value: "none", label: "Nothing (Omarchy already binds SUPER+wheel)" },
    { value: "cycleWorkspace", label: "Cycle through workspaces" },
    { value: "cycleOccupied", label: "Cycle through occupied workspaces" }
  ]

  Column {
    id: body
    width: root.width
    spacing: Style.spacing.md

    PanelSectionHeader {
      text: "What each button shows"
      foreground: root.foreground
      fontFamily: Style.font.menuFamily
    }

    FieldRow {
      label: "Label"
      foreground: root.foreground
      Dropdown {
        width: Style.space(300)
        showLabel: false
        foreground: root.foreground
        options: root.showModeOptions
        value: root.value("showMode", "auto")
        onChanged: function (next) { root.settingChanged("showMode", next) }
      }
      Toggle {
        width: Style.space(180)
        label: "Show names"
        checked: root.value("showNames", false) === true
        foreground: root.foreground
        onClicked: root.settingChanged("showNames", root.value("showNames", false) !== true)
      }
    }

    FieldRow {
      label: "Empty workspaces"
      foreground: root.foreground
      Dropdown {
        width: Style.space(300)
        showLabel: false
        foreground: root.foreground
        options: root.showEmptyOptions
        value: root.value("showEmpty", "auto")
        onChanged: function (next) { root.settingChanged("showEmpty", next) }
      }
      Toggle {
        width: Style.space(180)
        label: "Dim empty"
        checked: root.value("dimEmpty", true) === true
        foreground: root.foreground
        onClicked: root.settingChanged("dimEmpty", root.value("dimEmpty", true) !== true)
      }
    }

    FieldRow {
      label: "Unconfigured"
      foreground: root.foreground
      Toggle {
        width: Style.space(300)
        label: "Also show live workspaces"
        description: "workspaces that exist but have no row here"
        checked: root.value("includeUnconfigured", true) === true
        foreground: root.foreground
        onClicked: root.settingChanged("includeUnconfigured", root.value("includeUnconfigured", true) !== true)
      }
    }

    PanelSeparator { width: root.width; foreground: root.foreground }

    PanelSectionHeader {
      text: "Focused workspace"
      foreground: root.foreground
      fontFamily: Style.font.menuFamily
    }

    FieldRow {
      label: "Indicator"
      foreground: root.foreground
      Dropdown {
        width: Style.space(220)
        showLabel: false
        foreground: root.foreground
        options: root.focusStyleOptions
        value: root.value("focusStyle", "underline")
        onChanged: function (next) { root.settingChanged("focusStyle", next) }
      }
      Dropdown {
        width: Style.space(200)
        showLabel: false
        foreground: root.foreground
        options: root.focusColorOptions
        value: root.value("focusIndicatorColor", "foreground")
        onChanged: function (next) { root.settingChanged("focusIndicatorColor", next) }
      }
      NumberField {
        label: "px"
        foreground: root.foreground
        from: 1
        to: 8
        fieldWidth: Style.space(86)
        value: root.value("focusIndicatorThickness", 2)
        onModified: function (next) { root.settingChanged("focusIndicatorThickness", next) }
      }
    }

    PanelSeparator { width: root.width; foreground: root.foreground }

    PanelSectionHeader {
      text: "Size and spacing"
      foreground: root.foreground
      fontFamily: Style.font.menuFamily
    }

    FieldRow {
      label: "Button width"
      foreground: root.foreground
      Dropdown {
        width: Style.space(220)
        showLabel: false
        foreground: root.foreground
        options: root.widthOptions
        value: root.value("slotWidthMode", "auto")
        onChanged: function (next) { root.settingChanged("slotWidthMode", next) }
      }
      NumberField {
        label: "min"
        foreground: root.foreground
        from: 12
        to: 120
        fieldWidth: Style.space(96)
        value: root.value("slotMinWidth", 26)
        onModified: function (next) { root.settingChanged("slotMinWidth", next) }
      }
      NumberField {
        label: "gap"
        foreground: root.foreground
        from: 0
        to: 24
        fieldWidth: Style.space(96)
        value: root.value("slotSpacing", 6)
        onModified: function (next) { root.settingChanged("slotSpacing", next) }
      }
    }

    FieldRow {
      label: "Icon size"
      foreground: root.foreground
      Dropdown {
        width: Style.space(220)
        showLabel: false
        foreground: root.foreground
        options: root.fontOptions
        value: root.value("iconFontSize", "body")
        onChanged: function (next) { root.settingChanged("iconFontSize", next) }
      }
      Text {
        textFormat: Text.PlainText
        height: Style.spacing.controlHeight
        verticalAlignment: Text.AlignVCenter
        text: "glyph-heavy labels usually want one step up"
        color: root.foreground
        opacity: 0.5
        font.family: Style.font.menuFamily
        font.pixelSize: Style.font.caption
      }
    }

    PanelSeparator { width: root.width; foreground: root.foreground }

    PanelSectionHeader {
      text: "Interaction"
      foreground: root.foreground
      fontFamily: Style.font.menuFamily
    }

    FieldRow {
      label: "Tooltip"
      foreground: root.foreground
      Dropdown {
        width: Style.space(300)
        showLabel: false
        foreground: root.foreground
        options: root.tooltipOptions
        value: root.value("tooltipMode", "name")
        onChanged: function (next) { root.settingChanged("tooltipMode", next) }
      }
    }

    FieldRow {
      label: "Right click"
      foreground: root.foreground
      Dropdown {
        width: Style.space(300)
        showLabel: false
        foreground: root.foreground
        options: root.rightClickOptions
        value: root.value("rightClick", "openStudio")
        onChanged: function (next) { root.settingChanged("rightClick", next) }
      }
    }

    FieldRow {
      label: "Scroll wheel"
      foreground: root.foreground
      Dropdown {
        width: Style.space(340)
        showLabel: false
        foreground: root.foreground
        options: root.wheelOptions
        value: root.value("wheelAction", "none")
        onChanged: function (next) { root.settingChanged("wheelAction", next) }
      }
    }

    Text {
      width: root.width
      textFormat: Text.PlainText
      wrapMode: Text.WordWrap
      text: "Left click always focuses the workspace. These settings save as you change them — there is nothing to apply."
      color: root.foreground
      opacity: 0.5
      font.family: Style.font.menuFamily
      font.pixelSize: Style.font.caption
    }

    Item { width: 1; height: Style.spacing.lg }
  }
}
