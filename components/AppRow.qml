pragma ComponentBehavior: Bound

import QtQuick
import qs.Commons
import qs.Ui

// One app pinned to a workspace: the window rule that routes it there, and
// optionally how to start it.
//
// The controls write straight into the `app` object they were handed and then
// emit changed(), rather than replacing it. Replacing would rebuild this
// delegate on every keystroke and take the text cursor with it.
BorderSurface {
  id: root

  required property var app
  property color foreground: Color.menu.text
  property bool expanded: false

  // A delegate outlives its data by a frame or two: when an app is removed, or
  // the selected workspace changes, the bindings below re-evaluate once while
  // `app` is already undefined. Reads go through `fields` so that frame is a
  // no-op instead of a TypeError storm in the journal; writes bail out.
  readonly property var blank: ({
    label: "",
    match: { "class": "", title: "", initialClass: "", initialTitle: "" },
    launch: { mode: "none", launcher: "", command: "", args: "", delaySec: 0 },
    rules: { float: null, size: "", move: "", silent: false }
  })
  readonly property var fields: root.app ? root.app : root.blank
  readonly property bool ready: root.app !== null && root.app !== undefined

  signal changed()
  signal removeRequested()
  signal grabRequested()

  radius: Style.cornerRadius
  color: Style.normalFillFor(root.foreground, Color.accent, Color.urgent)
  borderSpec: Border.controlSpec("normal", root.foreground, Color.accent)
  padding: Style.spacing.md
  implicitHeight: body.implicitHeight + contentTopInset + contentBottomInset

  readonly property var matchOptions: [
    { value: "class", label: "Class" },
    { value: "initialClass", label: "Initial class" }
  ]
  readonly property var titleOptions: [
    { value: "title", label: "Title" },
    { value: "initialTitle", label: "Initial title" }
  ]
  readonly property var launchOptions: [
    { value: "none", label: "Don't launch" },
    { value: "onCreatedEmpty", label: "On first visit" },
    { value: "autostart", label: "At login" }
  ]

  // Which of the two class-ish / title-ish keys currently carries a value.
  function activeKey(options, fallback) {
    for (var i = 0; i < options.length; i++) {
      if (root.fields.match[options[i].value]) return options[i].value
    }
    return fallback
  }

  function setMatchKey(options, nextKey, keepValue) {
    if (!root.ready) return
    var carried = keepValue
    for (var i = 0; i < options.length; i++) {
      var key = options[i].value
      if (!carried && root.app.match[key]) carried = root.app.match[key]
      if (key !== nextKey) root.app.match[key] = ""
    }
    root.app.match[nextKey] = carried || ""
    root.changed()
  }

  Column {
    id: body
    x: root.contentLeftInset
    y: root.contentTopInset
    width: root.width - root.contentLeftInset - root.contentRightInset
    spacing: Style.spacing.sm

    // ---- name + actions
    Row {
      width: parent.width
      spacing: Style.spacing.sm

      TextField {
        id: labelField
        width: parent.width - grabButton.width - removeButton.width - Style.spacing.sm * 2
        foreground: root.foreground
        placeholderText: "App name (display only)"
        verticalPadding: Style.spacing.sm
        text: root.fields.label
        onTextChanged: {
          if (!root.ready) return
          if (root.app.label === text) return
          root.app.label = text
          root.changed()
        }
      }

      PanelActionButton {
        id: grabButton
        iconText: "󰍉"
        tooltipText: "Fill from the focused window"
        foreground: root.foreground
        size: Style.spacing.controlHeight
        bordered: true
        onClicked: root.grabRequested()
      }

      PanelActionButton {
        id: removeButton
        iconText: "󰩹"
        tooltipText: "Remove this app"
        foreground: Color.urgent
        hoverColor: Color.urgent
        size: Style.spacing.controlHeight
        bordered: true
        onClicked: root.removeRequested()
      }
    }

    // ---- window match
    Row {
      width: parent.width
      spacing: Style.spacing.sm

      Dropdown {
        id: classKind
        width: Style.space(150)
        showLabel: false
        foreground: root.foreground
        options: root.matchOptions
        value: root.activeKey(root.matchOptions, "class")
        onChanged: function (next) { root.setMatchKey(root.matchOptions, next, "") }
      }

      TextField {
        width: parent.width - classKind.width - Style.spacing.sm
        foreground: root.foreground
        placeholderText: "^chromium$   (regex, matched in full)"
        verticalPadding: Style.spacing.sm
        text: root.fields.match[classKind.value] || ""
        onTextChanged: {
          if (!root.ready) return
          var key = classKind.value
          if (root.app.match[key] === text) return
          root.app.match[key] = text
          root.changed()
        }
      }
    }

    Row {
      width: parent.width
      spacing: Style.spacing.sm
      visible: root.expanded

      Dropdown {
        id: titleKind
        width: Style.space(150)
        showLabel: false
        foreground: root.foreground
        options: root.titleOptions
        value: root.activeKey(root.titleOptions, "title")
        onChanged: function (next) { root.setMatchKey(root.titleOptions, next, "") }
      }

      TextField {
        width: parent.width - titleKind.width - Style.spacing.sm
        foreground: root.foreground
        placeholderText: "Optional title pattern"
        verticalPadding: Style.spacing.sm
        text: root.fields.match[titleKind.value] || ""
        onTextChanged: {
          if (!root.ready) return
          var key = titleKind.value
          if (root.app.match[key] === text) return
          root.app.match[key] = text
          root.changed()
        }
      }
    }

    // ---- launch
    Row {
      width: parent.width
      spacing: Style.spacing.sm

      Dropdown {
        id: launchMode
        width: Style.space(150)
        showLabel: false
        foreground: root.foreground
        options: root.launchOptions
        value: root.fields.launch.mode
        onChanged: function (next) {
          if (!root.ready) return
          root.app.launch.mode = next
          root.changed()
        }
      }

      TextField {
        id: commandField
        width: parent.width - launchMode.width - (delayField.visible ? delayField.width + Style.spacing.sm : 0) - Style.spacing.sm
        visible: launchMode.value !== "none"
        foreground: root.foreground
        placeholderText: "Command, e.g. foot"
        verticalPadding: Style.spacing.sm
        text: root.fields.launch.command
        onTextChanged: {
          if (!root.ready) return
          if (root.app.launch.command === text) return
          root.app.launch.command = text
          root.changed()
        }
      }

      NumberField {
        id: delayField
        visible: launchMode.value === "autostart"
        label: ""
        foreground: root.foreground
        from: 0
        to: 120
        stepSize: 1
        fieldWidth: Style.space(74)
        value: root.fields.launch.delaySec
        onModified: function (next) {
          if (!root.ready) return
          root.app.launch.delaySec = next
          root.changed()
        }
      }
    }

    Text {
      width: parent.width
      visible: launchMode.value === "autostart"
      textFormat: Text.PlainText
      wrapMode: Text.WordWrap
      text: "At login only. The number is a delay in seconds — stagger web apps behind the browser that owns their profile."
      color: root.foreground
      opacity: 0.5
      font.family: Style.font.menuFamily
      font.pixelSize: Style.font.caption
    }

    // ---- extra window-rule effects
    Row {
      width: parent.width
      spacing: Style.spacing.controlGap
      visible: root.expanded

      Toggle {
        width: Style.space(150)
        label: "Float"
        checked: root.fields.rules.float === true
        foreground: root.foreground
        onClicked: {
          if (!root.ready) return
          root.app.rules.float = root.app.rules.float === true ? null : true
          root.changed()
        }
      }

      Toggle {
        width: Style.space(150)
        label: "Silent"
        checked: root.fields.rules.silent === true
        foreground: root.foreground
        onClicked: {
          if (!root.ready) return
          root.app.rules.silent = !root.app.rules.silent
          root.changed()
        }
      }
    }

    Row {
      width: parent.width
      spacing: Style.spacing.sm
      visible: root.expanded

      TextField {
        width: (parent.width - Style.spacing.sm) / 2
        foreground: root.foreground
        placeholderText: "Size, e.g. 800 600"
        verticalPadding: Style.spacing.sm
        text: root.fields.rules.size
        onTextChanged: {
          if (!root.ready) return
          if (root.app.rules.size === text) return
          root.app.rules.size = text
          root.changed()
        }
      }

      TextField {
        width: (parent.width - Style.spacing.sm) / 2
        foreground: root.foreground
        placeholderText: "Position, e.g. 100 100"
        verticalPadding: Style.spacing.sm
        text: root.fields.rules.move
        onTextChanged: {
          if (!root.ready) return
          if (root.app.rules.move === text) return
          root.app.rules.move = text
          root.changed()
        }
      }
    }

    Button {
      text: root.expanded ? "Fewer options" : "More options"
      foreground: root.foreground
      fontSize: Style.font.caption
      horizontalPadding: Style.spacing.sm
      verticalPadding: Style.spacing.xxs
      onClicked: root.expanded = !root.expanded
    }
  }
}
