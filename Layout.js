// Workspace Studio — layout geometry.
//
// Pure JavaScript, no QML globals and no Node globals, exactly like Config.js
// and HyprGen.js: the QML canvas imports it (`import "Layout.js" as Layout`)
// and `node --test` loads the identical file through `node:vm`.
//
// Everything here is total: nothing throws, every entry point tolerates
// garbage and returns a well-formed value. All the geometry maths lives here
// so components/LayoutCanvas.qml only paints and handles the mouse.
//
// The model is a strict binary slicing tree, which is the only shape a tiler
// can render and the only shape that gives "drag the splitter" a meaning:
//
//   leaf   { app: <index into the workspace's apps[], or -1 for any window> }
//   split  { dir: "h" | "v", ratio: <fraction taken by kids[0]>, kids: [a, b] }
//
//   dir "h": children sit side by side, the splitter is vertical.
//   dir "v": children are stacked,     the splitter is horizontal.
//
// A path is an array of child indices: [] is the root, [0, 1] is the second
// child of the first child.

var LAYOUT_MAX_DEPTH = 4;
var LAYOUT_MAX_LEAVES = 8;
var LAYOUT_MIN_RATIO = 0.05;
var LAYOUT_MAX_RATIO = 0.95;

var LAYOUT_PRESETS = ["columns", "rows", "mainLeft", "mainRight", "mainTop", "mainBottom", "grid"];

var LAYOUT_PRESET_LABELS = {
  columns: "columns",
  rows: "rows",
  mainLeft: "main left",
  mainRight: "main right",
  mainTop: "main top",
  mainBottom: "main bottom",
  grid: "grid"
};

// ------------------------------------------------------------- primitives
//
// Deliberately prefixed. Config.js and HyprGen.js declare their own isObject /
// isArray, and node:vm runs all three scripts in one shared global scope, so an
// unprefixed redefinition here would silently rebind theirs.

function layoutIsObject(value) {
  return value !== null && typeof value === "object" &&
    Object.prototype.toString.call(value) !== "[object Array]";
}

function layoutIsArray(value) {
  return Object.prototype.toString.call(value) === "[object Array]";
}

function layoutRound3(value) {
  var n = Number(value);
  if (!isFinite(n)) return 0;
  return Math.round(n * 1000) / 1000;
}

function clampRatio(value) {
  var n = Number(value);
  if (!isFinite(n)) n = 0.5;
  if (n < LAYOUT_MIN_RATIO) n = LAYOUT_MIN_RATIO;
  if (n > LAYOUT_MAX_RATIO) n = LAYOUT_MAX_RATIO;
  return layoutRound3(n);
}

function clampApp(value, appCount) {
  var n = parseInt(value, 10);
  var max = parseInt(appCount, 10);
  if (!isFinite(max) || max < 0) max = 0;
  if (!isFinite(n) || n < 0) return -1;
  if (n >= max) return -1;
  return n;
}

function isLeaf(node) {
  return layoutIsObject(node) && !layoutIsArray(node.kids) && node.app !== undefined;
}

function isSplit(node) {
  return layoutIsObject(node) && layoutIsArray(node.kids) && node.kids.length === 2;
}

function leaf(app) {
  var n = parseInt(app, 10);
  return { app: isFinite(n) && n >= 0 ? n : -1 };
}

function cloneTree(node) {
  if (!layoutIsObject(node)) return null;
  if (isSplit(node)) {
    return {
      dir: node.dir === "v" ? "v" : "h",
      ratio: clampRatio(node.ratio),
      kids: [cloneTree(node.kids[0]), cloneTree(node.kids[1])]
    };
  }
  if (isLeaf(node)) return { app: parseInt(node.app, 10) };
  return null;
}

// --------------------------------------------------------- normalizeTree

// Total. Enforces every invariant the document is allowed to rely on:
// a node is a leaf or a split and never both; dir is "h" or "v"; ratio is
// clamped and rounded; app is clamped to [-1, appCount-1]; depth <= 4;
// leaves <= 8. A subtree that cannot be salvaged collapses into its sibling.
function normalizeTree(raw, appCount) {
  var budget = { left: LAYOUT_MAX_LEAVES };
  return normalizeNode(raw, appCount, 0, budget);
}

function normalizeNode(raw, appCount, level, budget) {
  if (!layoutIsObject(raw)) return null;

  var hasKids = layoutIsArray(raw.kids);
  var hasApp = raw.app !== undefined && raw.app !== null;

  // Never both. An ambiguous node is not repairable without guessing what the
  // author meant, so it is dropped rather than silently reinterpreted.
  if (hasKids && hasApp) return null;

  if (hasKids) {
    if (raw.kids.length < 2) {
      return normalizeNode(raw.kids[0], appCount, level, budget);
    }
    // Past the depth cap a split becomes whichever leaf it would have shown
    // first, so a pathological document degrades instead of being discarded.
    if (level >= LAYOUT_MAX_DEPTH) {
      return firstLeafOf(raw, appCount, budget);
    }
    var a = normalizeNode(raw.kids[0], appCount, level + 1, budget);
    var b = normalizeNode(raw.kids[1], appCount, level + 1, budget);
    if (!a && !b) return null;
    if (!a) return b;
    if (!b) return a;
    return { dir: raw.dir === "v" ? "v" : "h", ratio: clampRatio(raw.ratio), kids: [a, b] };
  }

  if (!hasApp) return null;
  if (budget.left <= 0) return null;
  budget.left--;
  return { app: clampApp(raw.app, appCount) };
}

function firstLeafOf(raw, appCount, budget) {
  if (!layoutIsObject(raw)) return null;
  if (layoutIsArray(raw.kids)) {
    for (var i = 0; i < raw.kids.length; i++) {
      var found = firstLeafOf(raw.kids[i], appCount, budget);
      if (found) return found;
    }
    return null;
  }
  if (raw.app === undefined || raw.app === null) return null;
  if (budget.left <= 0) return null;
  budget.left--;
  return { app: clampApp(raw.app, appCount) };
}

// ------------------------------------------------------------- traversal

function nodeAt(tree, path) {
  var node = tree;
  var list = layoutIsArray(path) ? path : [];
  for (var i = 0; i < list.length; i++) {
    if (!isSplit(node)) return null;
    var index = list[i] === 1 ? 1 : 0;
    node = node.kids[index];
  }
  return node || null;
}

function samePath(a, b) {
  var x = layoutIsArray(a) ? a : [];
  var y = layoutIsArray(b) ? b : [];
  if (x.length !== y.length) return false;
  for (var i = 0; i < x.length; i++) if (x[i] !== y[i]) return false;
  return true;
}

function pathKey(path) {
  return (layoutIsArray(path) ? path : []).join("/");
}

function leafCount(tree) {
  if (!layoutIsObject(tree)) return 0;
  if (isSplit(tree)) return leafCount(tree.kids[0]) + leafCount(tree.kids[1]);
  return 1;
}

function treeDepth(tree) {
  if (!isSplit(tree)) return 0;
  return 1 + Math.max(treeDepth(tree.kids[0]), treeDepth(tree.kids[1]));
}

function leafPaths(tree) {
  var out = [];
  collectLeafPaths(tree, [], out);
  return out;
}

function collectLeafPaths(node, path, out) {
  if (!layoutIsObject(node)) return;
  if (isSplit(node)) {
    collectLeafPaths(node.kids[0], path.concat([0]), out);
    collectLeafPaths(node.kids[1], path.concat([1]), out);
    return;
  }
  out.push(path.slice(0));
}

// --------------------------------------------------------------- geometry

// The box algebra dwindle itself uses: a node owns a box, the split point is
// the ratio of the box minus one gap, and the second child takes the exact
// remainder so rectangles always tile the box with no rounding drift.
function computeRects(tree, width, height, gap) {
  var out = [];
  var box = {
    x: 0,
    y: 0,
    w: Math.max(0, Number(width) || 0),
    h: Math.max(0, Number(height) || 0)
  };
  layoutInto(tree, box, Math.max(0, Number(gap) || 0), [], out, null);
  return out;
}

function computeSplitters(tree, width, height, gap) {
  var out = [];
  var box = {
    x: 0,
    y: 0,
    w: Math.max(0, Number(width) || 0),
    h: Math.max(0, Number(height) || 0)
  };
  layoutInto(tree, box, Math.max(0, Number(gap) || 0), [], null, out);
  return out;
}

function layoutInto(node, box, gap, path, rects, splits) {
  if (!layoutIsObject(node)) return;

  if (isSplit(node)) {
    var horizontal = node.dir !== "v";
    var span = horizontal ? box.w : box.h;
    var avail = Math.max(0, span - gap);
    var first = Math.round(avail * clampRatio(node.ratio));
    if (first > avail) first = avail;
    var second = avail - first;

    var boxA = horizontal
      ? { x: box.x, y: box.y, w: first, h: box.h }
      : { x: box.x, y: box.y, w: box.w, h: first };
    var boxB = horizontal
      ? { x: box.x + first + gap, y: box.y, w: second, h: box.h }
      : { x: box.x, y: box.y + first + gap, w: box.w, h: second };

    if (splits) {
      splits.push({
        path: path.slice(0),
        dir: node.dir === "v" ? "v" : "h",
        ratio: clampRatio(node.ratio),
        x: horizontal ? box.x + first : box.x,
        y: horizontal ? box.y : box.y + first,
        w: horizontal ? gap : box.w,
        h: horizontal ? box.h : gap,
        // The parent box, so a drag can turn a cursor position back into a
        // ratio without walking the tree again.
        bx: box.x, by: box.y, bw: box.w, bh: box.h
      });
    }

    layoutInto(node.kids[0], boxA, gap, path.concat([0]), rects, splits);
    layoutInto(node.kids[1], boxB, gap, path.concat([1]), rects, splits);
    return;
  }

  if (rects) {
    rects.push({
      path: path.slice(0),
      key: pathKey(path),
      app: parseInt(node.app, 10),
      x: box.x, y: box.y, w: box.w, h: box.h
    });
  }
}

// Which rectangle is under the cursor, and which quarter of it. "c" is the
// middle third, which is the swap target; the four edges re-parent.
function hitTest(rects, x, y) {
  var list = layoutIsArray(rects) ? rects : [];
  for (var i = 0; i < list.length; i++) {
    var r = list[i];
    if (x < r.x || x > r.x + r.w || y < r.y || y > r.y + r.h) continue;
    var fx = r.w > 0 ? (x - r.x) / r.w : 0.5;
    var fy = r.h > 0 ? (y - r.y) / r.h : 0.5;
    var edge = "c";
    var west = fx;
    var east = 1 - fx;
    var north = fy;
    var south = 1 - fy;
    var nearest = Math.min(west, east, north, south);
    if (nearest < 0.28) {
      if (nearest === west) edge = "w";
      else if (nearest === east) edge = "e";
      else if (nearest === north) edge = "n";
      else edge = "s";
    }
    return { path: r.path.slice(0), key: r.key, app: r.app, edge: edge };
  }
  return null;
}

function edgeToSplit(edge) {
  if (edge === "n") return { dir: "v", before: true };
  if (edge === "s") return { dir: "v", before: false };
  if (edge === "w") return { dir: "h", before: true };
  return { dir: "h", before: false };
}

// ------------------------------------------------------------- tree edits
//
// Every edit is pure: it clones, mutates the clone, and returns it. A refused
// edit returns a clone of the input rather than null, so a caller can always
// assign the result.

function replaceAt(tree, path, replacement) {
  var list = layoutIsArray(path) ? path : [];
  if (list.length === 0) return replacement;
  var copy = cloneTree(tree);
  var parent = copy;
  for (var i = 0; i < list.length - 1; i++) {
    if (!isSplit(parent)) return copy;
    parent = parent.kids[list[i] === 1 ? 1 : 0];
  }
  if (!isSplit(parent)) return copy;
  parent.kids[list[list.length - 1] === 1 ? 1 : 0] = replacement;
  return copy;
}

function splitLeaf(tree, path, dir, before, appIndex) {
  var target = nodeAt(tree, path);
  if (!isLeaf(target)) return cloneTree(tree);
  if (leafCount(tree) >= LAYOUT_MAX_LEAVES) return cloneTree(tree);
  var list = layoutIsArray(path) ? path : [];
  if (list.length >= LAYOUT_MAX_DEPTH) return cloneTree(tree);

  var existing = { app: parseInt(target.app, 10) };
  var fresh = leaf(appIndex === undefined || appIndex === null ? -1 : appIndex);
  var node = {
    dir: dir === "v" ? "v" : "h",
    ratio: 0.5,
    kids: before ? [fresh, existing] : [existing, fresh]
  };
  return replaceAt(tree, list, node);
}

function removeLeaf(tree, path) {
  var list = layoutIsArray(path) ? path : [];
  if (list.length === 0) return null;
  var parentPath = list.slice(0, list.length - 1);
  var parent = nodeAt(tree, parentPath);
  if (!isSplit(parent)) return cloneTree(tree);
  var sibling = cloneTree(parent.kids[list[list.length - 1] === 1 ? 0 : 1]);
  if (!sibling) return cloneTree(tree);
  return replaceAt(tree, parentPath, sibling);
}

function swapLeaves(tree, pathA, pathB) {
  var copy = cloneTree(tree);
  var a = nodeAt(copy, pathA);
  var b = nodeAt(copy, pathB);
  if (!isLeaf(a) || !isLeaf(b)) return copy;
  var carry = a.app;
  a.app = b.app;
  b.app = carry;
  return copy;
}

// Remove A, then split B and drop A into the half the edge names. Done by
// marking B first, because removing A renames every path to its right.
function moveLeaf(tree, from, to, edge) {
  if (samePath(from, to)) return cloneTree(tree);
  var source = nodeAt(tree, from);
  var target = nodeAt(tree, to);
  if (!isLeaf(source) || !isLeaf(target)) return cloneTree(tree);

  var moved = parseInt(source.app, 10);
  var marked = cloneTree(tree);
  var mark = nodeAt(marked, to);
  if (!isLeaf(mark)) return cloneTree(tree);
  mark.__mark = true;

  var pruned = removeLeaf(marked, from);
  if (!pruned) return cloneTree(tree);

  var found = findMarked(pruned, []);
  clearMarks(pruned);
  if (!found) return cloneTree(tree);

  var spec = edgeToSplit(edge);
  return splitLeaf(pruned, found, spec.dir, spec.before, moved);
}

function findMarked(node, path) {
  if (!layoutIsObject(node)) return null;
  if (isSplit(node)) {
    return findMarked(node.kids[0], path.concat([0])) || findMarked(node.kids[1], path.concat([1]));
  }
  return node.__mark ? path.slice(0) : null;
}

function clearMarks(node) {
  if (!layoutIsObject(node)) return;
  if (isSplit(node)) {
    clearMarks(node.kids[0]);
    clearMarks(node.kids[1]);
    return;
  }
  if (node.__mark !== undefined) delete node.__mark;
}

function setRatio(tree, path, ratio) {
  var copy = cloneTree(tree);
  var node = nodeAt(copy, path);
  if (!isSplit(node)) return copy;
  node.ratio = clampRatio(ratio);
  return copy;
}

function toggleDir(tree, path) {
  var copy = cloneTree(tree);
  var node = nodeAt(copy, path);
  if (!isSplit(node)) return copy;
  node.dir = node.dir === "v" ? "h" : "v";
  return copy;
}

function setLeafApp(tree, path, appIndex) {
  var copy = cloneTree(tree);
  var node = nodeAt(copy, path);
  if (!isLeaf(node)) return copy;
  var n = parseInt(appIndex, 10);
  node.app = isFinite(n) && n >= 0 ? n : -1;
  return copy;
}

// Leaves address apps by array index, so deleting an app from under the tree
// would silently re-point every leaf after it. Studio.removeApp calls this.
function reindexAfterAppRemoval(tree, removedIndex) {
  var removed = parseInt(removedIndex, 10);
  if (!isFinite(removed) || removed < 0) return cloneTree(tree);
  var copy = cloneTree(tree);
  shiftApps(copy, removed);
  return copy;
}

function shiftApps(node, removed) {
  if (!layoutIsObject(node)) return;
  if (isSplit(node)) {
    shiftApps(node.kids[0], removed);
    shiftApps(node.kids[1], removed);
    return;
  }
  var app = parseInt(node.app, 10);
  if (!isFinite(app) || app < 0) { node.app = -1; return; }
  if (app === removed) node.app = -1;
  else if (app > removed) node.app = app - 1;
}

// ---------------------------------------------------------------- presets

// A weighted balanced combine rather than a right-leaning chain: eight equal
// columns as a chain would be seven levels deep and blow the depth cap, while
// balanced with proportional ratios is three levels and geometrically identical.
function combine(dir, items) {
  if (items.length === 0) return null;
  if (items.length === 1) return items[0].node;
  var total = 0;
  for (var i = 0; i < items.length; i++) total += items[i].weight;
  var half = Math.ceil(items.length / 2);
  var leftItems = items.slice(0, half);
  var rightItems = items.slice(half);
  var leftWeight = 0;
  for (var j = 0; j < leftItems.length; j++) leftWeight += leftItems[j].weight;
  return {
    dir: dir === "v" ? "v" : "h",
    ratio: clampRatio(total > 0 ? leftWeight / total : 0.5),
    kids: [combine(dir, leftItems), combine(dir, rightItems)]
  };
}

function evenSplit(dir, apps) {
  var items = [];
  for (var i = 0; i < apps.length; i++) items.push({ weight: 1, node: leaf(apps[i]) });
  return combine(dir, items);
}

function presetAppList(appCount) {
  var n = parseInt(appCount, 10);
  if (!isFinite(n) || n < 1) return [-1];
  if (n > LAYOUT_MAX_LEAVES) n = LAYOUT_MAX_LEAVES;
  var out = [];
  for (var i = 0; i < n; i++) out.push(i);
  return out;
}

function preset(name, appCount) {
  var apps = presetAppList(appCount);
  var n = apps.length;
  if (n === 1) return leaf(apps[0]);
  var rest = apps.slice(1);

  switch (String(name)) {
    case "rows":
      return evenSplit("v", apps);
    case "mainLeft":
      return { dir: "h", ratio: 0.6, kids: [leaf(apps[0]), evenSplit("v", rest)] };
    case "mainRight":
      return { dir: "h", ratio: 0.4, kids: [evenSplit("v", rest), leaf(apps[0])] };
    case "mainTop":
      return { dir: "v", ratio: 0.6, kids: [leaf(apps[0]), evenSplit("h", rest)] };
    case "mainBottom":
      return { dir: "v", ratio: 0.4, kids: [evenSplit("h", rest), leaf(apps[0])] };
    case "grid":
      return gridPreset(apps);
    case "columns":
    default:
      return evenSplit("h", apps);
  }
}

function gridPreset(apps) {
  var n = apps.length;
  var cols = Math.ceil(Math.sqrt(n));
  var base = Math.floor(n / cols);
  var extra = n % cols;
  var items = [];
  var cursor = 0;
  for (var c = 0; c < cols; c++) {
    var take = base + (c < extra ? 1 : 0);
    if (take <= 0) continue;
    var bucket = apps.slice(cursor, cursor + take);
    cursor += take;
    items.push({ weight: bucket.length, node: evenSplit("v", bucket) });
  }
  return combine("h", items);
}

// Structure and ratios only: which app sits in which leaf is the user's
// business and must not stop the summary from saying "main left".
function sameShape(a, b) {
  var aSplit = isSplit(a);
  var bSplit = isSplit(b);
  if (aSplit !== bSplit) return false;
  if (!aSplit) return true;
  if ((a.dir === "v") !== (b.dir === "v")) return false;
  if (Math.abs(clampRatio(a.ratio) - clampRatio(b.ratio)) > 0.002) return false;
  return sameShape(a.kids[0], b.kids[0]) && sameShape(a.kids[1], b.kids[1]);
}

// Several presets coincide for small counts — grid(2) is columns(2), and every
// preset of one app is a bare leaf. The first name whose shape matches wins,
// and a single leaf has no preset name worth showing.
function detectPreset(tree) {
  var n = leafCount(tree);
  if (n < 2) return null;
  for (var i = 0; i < LAYOUT_PRESETS.length; i++) {
    if (sameShape(tree, preset(LAYOUT_PRESETS[i], n))) return LAYOUT_PRESETS[i];
  }
  return null;
}

function presetLabel(name) {
  return LAYOUT_PRESET_LABELS[String(name)] || "";
}

// -------------------------------------------------------------- projection

// Percentages of the monitor, two decimals, computed on a 10000-unit box so
// the second child still takes the exact remainder and each axis sums to 100.
// topReservePct squeezes everything below the bar's reserved strip.
function toFloatRects(tree, topReservePct) {
  var reserve = Number(topReservePct);
  if (!isFinite(reserve) || reserve < 0) reserve = 0;
  if (reserve > 50) reserve = 50;
  var scale = (100 - reserve) / 100;

  var rects = computeRects(tree, 10000, 10000, 0);
  var out = [];
  for (var i = 0; i < rects.length; i++) {
    var r = rects[i];
    out.push({
      path: r.path.slice(0),
      app: r.app,
      xPct: layoutRound2(r.x / 100),
      yPct: layoutRound2(reserve + (r.y / 100) * scale),
      wPct: layoutRound2(r.w / 100),
      hPct: layoutRound2((r.h / 100) * scale)
    });
  }
  return out;
}

function layoutRound2(value) {
  var n = Number(value);
  if (!isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
}

// Is `node` a stack of equal slices along `dir`, each spanning the full width
// across it? That is exactly what Hyprland's master layout does with its
// slaves, so a main+stack tree projects onto master/mfact with no loss.
function isUniformStack(node, dir) {
  if (!layoutIsObject(node)) return false;
  if (isLeaf(node)) return true;
  var rects = computeRects(node, 10000, 10000, 0);
  if (rects.length < 2) return true;
  var min = -1;
  var max = -1;
  for (var i = 0; i < rects.length; i++) {
    var r = rects[i];
    var size;
    if (dir === "v") {
      if (r.x !== 0 || r.w !== 10000) return false;
      size = r.h;
    } else {
      if (r.y !== 0 || r.h !== 10000) return false;
      size = r.w;
    }
    if (min < 0 || size < min) min = size;
    if (max < 0 || size > max) max = size;
  }
  // 0.3% of the box. Ratios are stored to three decimals so the JSON stays
  // diffable, and 1/3 stored as 0.333 is off by a few units in ten thousand at
  // every level; that quantization must not be mistaken for a deliberately
  // uneven stack, which master genuinely cannot render.
  return max - min <= 30;
}

// tree -> { layout, layoutOpts, exact, note }.
//
// Hyprland can only be told a layout name and a couple of options per
// workspace; it cannot be handed a tree (the dwindle split tree is private and
// layoutmsg only reaches the active workspace). So the tree is *projected*:
// exact where master can render it, and honestly labelled where it cannot.
function toWorkspaceLayout(tree) {
  var none = { layout: "", layoutOpts: {}, exact: true, note: "" };
  if (!layoutIsObject(tree)) return none;
  if (leafCount(tree) < 2) return none;
  if (!isSplit(tree)) return none;

  var horizontal = tree.dir !== "v";
  var ratio = clampRatio(tree.ratio);
  var a = tree.kids[0];
  var b = tree.kids[1];
  var stackDir = horizontal ? "v" : "h";

  // Two leaves: any single split, exactly.
  if (isLeaf(a) && isLeaf(b)) {
    return master(horizontal ? "left" : "top", ratio, true, "");
  }

  // Main + stack: the odd child is the master area.
  if (isLeaf(a) && isUniformStack(b, stackDir)) {
    return master(horizontal ? "left" : "top", ratio, true, "");
  }
  if (isLeaf(b) && isUniformStack(a, stackDir)) {
    return master(horizontal ? "right" : "bottom", layoutRound3(1 - ratio), true, "");
  }

  // Anything else is approximated. Say so, and say as what.
  var found = detectPreset(tree);
  var side = horizontal ? "left" : "top";
  var label = found ? presetLabel(found) : "this arrangement";
  return master(side, ratio, false, label + " approximated as main " + side);
}

function master(orientation, mfact, exact, note) {
  return {
    layout: "master",
    layoutOpts: { mfact: layoutRound3(mfact), orientation: orientation },
    exact: exact === true,
    note: String(note || "")
  };
}

// A human sentence for the canvas footer.
function fidelityNote(tree) {
  var projected = toWorkspaceLayout(tree);
  if (!projected.layout) return "Nothing to arrange yet.";
  if (projected.exact) return "Exact — the compositor can render this tree as it is drawn.";
  return "Approximated as " + projected.note.replace(/^.* approximated as /, "") +
    ". Switch to Exact (floating) for the drawing as-is.";
}

// ---------------------------------------------------------------- deferred

// Recovering a slicing tree from live `hyprctl -j clients` geometry: find a
// full-width or full-height cut line that no rectangle crosses, split there,
// recurse, and refuse the import when no such cut exists. Deferred to the
// version after this one; the canvas never calls it.
function treeFromRects(rects, bounds) {
  return null;
}
