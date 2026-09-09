import test from 'node:test';
import assert from 'node:assert/strict';
import { loadSandbox, plain } from './sandbox.helper.mjs';

const S = loadSandbox();

const PRESETS = ['columns', 'rows', 'mainLeft', 'mainRight', 'mainTop', 'mainBottom', 'grid'];

function leafSizes(rects, axis) {
  return rects.map(r => r[axis]);
}

// --------------------------------------------------------- normalizeTree

test('normalizeTree tolerates garbage and always returns a tree or null', () => {
  for (const junk of [null, undefined, 0, 'nope', [], true, {}, { kids: [] }]) {
    const tree = S.normalizeTree(junk, 3);
    assert.ok(tree === null || typeof tree === 'object');
  }
});

test('normalizeTree rejects a node that is both a leaf and a split', () => {
  assert.equal(S.normalizeTree({ app: 0, dir: 'h', kids: [{ app: 0 }, { app: 1 }] }, 2), null);
});

test('normalizeTree clamps the ratio to [0.05, 0.95] and rounds it', () => {
  const low = S.normalizeTree({ dir: 'h', ratio: -4, kids: [{ app: 0 }, { app: 1 }] }, 2);
  const high = S.normalizeTree({ dir: 'h', ratio: 9, kids: [{ app: 0 }, { app: 1 }] }, 2);
  const odd = S.normalizeTree({ dir: 'h', ratio: 0.3333333, kids: [{ app: 0 }, { app: 1 }] }, 2);
  assert.equal(low.ratio, 0.05);
  assert.equal(high.ratio, 0.95);
  assert.equal(odd.ratio, 0.333);
});

test('normalizeTree clamps a leaf pointing past the end of apps[] to -1', () => {
  const tree = S.normalizeTree({ dir: 'h', ratio: 0.5, kids: [{ app: 0 }, { app: 9 }] }, 1);
  assert.equal(tree.kids[0].app, 0);
  assert.equal(tree.kids[1].app, -1);
  assert.equal(S.normalizeTree({ app: 0 }, 0).app, -1);
});

test('normalizeTree defaults an unknown dir to horizontal', () => {
  assert.equal(S.normalizeTree({ dir: 'diagonal', kids: [{ app: 0 }, { app: 1 }] }, 2).dir, 'h');
  assert.equal(S.normalizeTree({ dir: 'v', kids: [{ app: 0 }, { app: 1 }] }, 2).dir, 'v');
});

test('normalizeTree enforces depth <= 4 and leaves <= 8', () => {
  // A 6-deep right-leaning chain of splits.
  let deep = { app: 0 };
  for (let i = 0; i < 6; i++) deep = { dir: 'h', ratio: 0.5, kids: [{ app: 1 }, deep] };
  const tree = S.normalizeTree(deep, 2);
  assert.ok(S.treeDepth(tree) <= 4, 'depth ' + S.treeDepth(tree));

  // A balanced tree of 16 leaves.
  let wide = { app: 0 };
  for (let i = 0; i < 4; i++) wide = { dir: 'h', ratio: 0.5, kids: [wide, wide] };
  assert.ok(S.leafCount(S.normalizeTree(wide, 1)) <= 8);
});

test('normalizeTree collapses a split whose children are both unsalvageable', () => {
  assert.equal(S.normalizeTree({ dir: 'h', ratio: 0.5, kids: [null, 'x'] }, 2), null);
  const one = S.normalizeTree({ dir: 'h', ratio: 0.5, kids: [{ app: 1 }, null] }, 3);
  assert.deepEqual(plain(one), { app: 1 });
});

// ------------------------------------------------------------- geometry

test('computeRects reproduces the split dwindle actually produced', () => {
  // Measured on the real machine: workspace 4, two windows, one monitor at
  // 3440x1440 scale 1.25 with gaps_in 5 / gaps_out 10 / border 2. The tiling
  // area was 2728x1102 and the two tiles came out 1357 wide with 14 between.
  const rects = plain(S.computeRects(S.preset('columns', 2), 2728, 1102, 14));
  assert.deepEqual(rects.map(r => ({ x: r.x, w: r.w })), [{ x: 0, w: 1357 }, { x: 1371, w: 1357 }]);
  assert.equal(rects[0].h, 1102);
  assert.equal(rects[1].h, 1102);
});

test('every preset tiles its box exactly, for one to eight apps', () => {
  for (const name of PRESETS) {
    for (let n = 1; n <= 8; n++) {
      const tree = S.preset(name, n);
      const rects = plain(S.computeRects(tree, 1000, 800, 10));
      assert.equal(rects.length, n, name + ' n=' + n);
      for (const r of rects) {
        assert.ok(r.x >= 0 && r.y >= 0 && r.w > 0 && r.h > 0, name + ' n=' + n + ' ' + JSON.stringify(r));
        assert.ok(r.x + r.w <= 1000 && r.y + r.h <= 800, name + ' n=' + n);
      }
      // No two rectangles overlap.
      for (let i = 0; i < rects.length; i++) {
        for (let j = i + 1; j < rects.length; j++) {
          const a = rects[i], b = rects[j];
          const apart = a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y;
          assert.ok(apart, name + ' n=' + n + ' overlap ' + i + '/' + j);
        }
      }
    }
  }
});

test('columns and rows come out even', () => {
  for (let n = 2; n <= 8; n++) {
    // Within 0.3% of a 10000-unit box: ratios are stored to three decimals, so
    // 1/3 is 0.333 and the columns differ by a few units in ten thousand.
    const widths = leafSizes(plain(S.computeRects(S.preset('columns', n), 10000, 10000, 0)), 'w');
    assert.ok(Math.max(...widths) - Math.min(...widths) <= 30, 'columns n=' + n + ' ' + widths.join(','));
    const heights = leafSizes(plain(S.computeRects(S.preset('rows', n), 10000, 10000, 0)), 'h');
    assert.ok(Math.max(...heights) - Math.min(...heights) <= 30, 'rows n=' + n);
  }
});

test('every preset stays inside the depth and leaf caps', () => {
  for (const name of PRESETS) {
    for (let n = 1; n <= 8; n++) {
      const tree = S.preset(name, n);
      assert.ok(S.treeDepth(tree) <= 4, name + ' n=' + n + ' depth ' + S.treeDepth(tree));
      assert.equal(S.leafCount(tree), n);
      // A preset must survive normalization untouched.
      assert.deepEqual(plain(S.normalizeTree(tree, n)), plain(tree));
    }
  }
});

test('computeSplitters gives one splitter per split node, with its parent box', () => {
  const tree = S.preset('mainLeft', 3);
  const splits = plain(S.computeSplitters(tree, 1000, 800, 8));
  assert.equal(splits.length, 2);
  assert.equal(splits[0].dir, 'h');
  assert.equal(splits[0].w, 8);
  assert.equal(splits[0].h, 800);
  assert.equal(splits[0].bw, 1000);
  assert.equal(splits[1].dir, 'v');
  assert.equal(splits[1].h, 8);
});

test('hitTest names the rectangle and which part of it', () => {
  const rects = S.computeRects(S.preset('columns', 2), 1000, 800, 0);
  assert.equal(S.hitTest(rects, 250, 400).edge, 'c');
  assert.equal(S.hitTest(rects, 5, 400).edge, 'w');
  assert.equal(S.hitTest(rects, 495, 400).edge, 'e');
  assert.equal(S.hitTest(rects, 250, 5).edge, 'n');
  assert.equal(S.hitTest(rects, 250, 795).edge, 's');
  assert.deepEqual(plain(S.hitTest(rects, 750, 400).path), [1]);
  assert.equal(S.hitTest(rects, -10, 400), null);
});

// ----------------------------------------------------------- tree edits

test('splitLeaf then removeLeaf is the identity', () => {
  const tree = S.preset('mainLeft', 3);
  const split = S.splitLeaf(tree, [0], 'v', false, 2);
  assert.equal(S.leafCount(split), 4);
  assert.deepEqual(plain(S.removeLeaf(split, [0, 1])), plain(tree));
});

test('splitLeaf refuses to break the depth or leaf caps', () => {
  const full = S.preset('columns', 8);
  assert.deepEqual(plain(S.splitLeaf(full, [0, 0, 0], 'h', false, 0)), plain(full));
  const deep = S.preset('grid', 8);
  const deepestLeaf = plain(S.leafPaths(deep)).find(p => p.length >= 4);
  if (deepestLeaf) {
    assert.deepEqual(plain(S.splitLeaf(deep, deepestLeaf, 'h', false, 0)), plain(deep));
  }
});

test('removeLeaf promotes the sibling into the parent box', () => {
  const tree = S.preset('columns', 2);
  assert.deepEqual(plain(S.removeLeaf(tree, [0])), { app: 1 });
  assert.equal(S.removeLeaf({ app: 0 }, []), null);
});

test('swapLeaves is its own inverse', () => {
  const tree = S.preset('grid', 4);
  const once = S.swapLeaves(tree, [0, 0], [1, 1]);
  assert.notDeepEqual(plain(once), plain(tree));
  assert.deepEqual(plain(S.swapLeaves(once, [0, 0], [1, 1])), plain(tree));
});

test('moveLeaf re-parents without losing or duplicating an app', () => {
  const tree = S.preset('columns', 3);
  const moved = S.moveLeaf(tree, [0], [1, 1], 's');
  assert.equal(S.leafCount(moved), 3);
  const apps = plain(S.computeRects(moved, 100, 100, 0)).map(r => r.app).sort();
  assert.deepEqual(apps, [0, 1, 2]);
  // Dropping something on itself changes nothing.
  assert.deepEqual(plain(S.moveLeaf(tree, [0], [0], 'e')), plain(tree));
});

test('setRatio clamps and toggleDir twice is the identity', () => {
  const tree = S.preset('columns', 2);
  assert.equal(S.setRatio(tree, [], 5).ratio, 0.95);
  assert.equal(S.setRatio(tree, [], -1).ratio, 0.05);
  assert.equal(S.setRatio(tree, [], 0.72).ratio, 0.72);
  assert.deepEqual(plain(S.toggleDir(S.toggleDir(tree, []), [])), plain(tree));
  assert.equal(S.toggleDir(tree, []).dir, 'v');
  // A refused edit still returns an assignable tree.
  assert.deepEqual(plain(S.setRatio(tree, [0], 0.3)), plain(tree));
});

test('setLeafApp writes -1 for "any window"', () => {
  const tree = S.setLeafApp(S.preset('columns', 2), [1], -1);
  assert.equal(S.nodeAt(tree, [1]).app, -1);
  assert.equal(S.nodeAt(S.setLeafApp(tree, [1], 'nonsense'), [1]).app, -1);
});

// This is the single most likely correctness bug in the whole feature: leaves
// address apps by array index, so deleting an app from under the tree silently
// re-points every leaf after it unless the tree is re-indexed too.
test('reindexAfterAppRemoval shifts every leaf and leaves no hole', () => {
  const tree = S.preset('columns', 3);
  const after = S.reindexAfterAppRemoval(tree, 0);
  const apps = plain(S.computeRects(after, 100, 100, 0)).map(r => r.app);
  assert.deepEqual(apps, [-1, 0, 1]);

  const middle = plain(S.computeRects(S.reindexAfterAppRemoval(tree, 1), 100, 100, 0)).map(r => r.app);
  assert.deepEqual(middle, [0, -1, 1]);

  const last = plain(S.computeRects(S.reindexAfterAppRemoval(tree, 2), 100, 100, 0)).map(r => r.app);
  assert.deepEqual(last, [0, 1, -1]);

  // Nothing points past the end of a now-shorter apps[].
  for (const index of [0, 1, 2]) {
    for (const app of plain(S.computeRects(S.reindexAfterAppRemoval(tree, index), 100, 100, 0)).map(r => r.app)) {
      assert.ok(app >= -1 && app <= 1, 'app ' + app + ' after removing ' + index);
    }
  }
});

// ---------------------------------------------------------------- presets

test('preset round-trips through detectPreset', () => {
  for (const name of PRESETS) {
    for (let n = 2; n <= 6; n++) {
      const tree = S.preset(name, n);
      const found = S.detectPreset(tree);
      assert.ok(found, name + ' n=' + n + ' was not recognised');
      // Some presets genuinely coincide — grid(2) IS columns(2) — so the
      // contract is that the detected name rebuilds the identical tree.
      assert.deepEqual(plain(S.preset(found, n)), plain(tree), name + ' n=' + n + ' -> ' + found);
    }
  }
});

test('a single leaf has no preset name worth showing', () => {
  assert.equal(S.detectPreset(S.preset('grid', 1)), null);
  assert.equal(S.detectPreset(null), null);
});

test('detectPreset returns null for a hand-built asymmetric tree', () => {
  const odd = { dir: 'h', ratio: 0.37, kids: [{ app: 0 }, { dir: 'h', ratio: 0.8, kids: [{ app: 1 }, { app: 2 }] }] };
  assert.equal(S.detectPreset(odd), null);
});

// ------------------------------------------------------------ projection

test('toFloatRects percentages cover the monitor on each axis', () => {
  for (const name of PRESETS) {
    for (let n = 1; n <= 8; n++) {
      const rects = plain(S.toFloatRects(S.preset(name, n), 0));
      for (const r of rects) {
        assert.ok(r.xPct >= 0 && r.yPct >= 0, name);
        assert.ok(r.xPct + r.wPct <= 100.01, name + ' ' + JSON.stringify(r));
        assert.ok(r.yPct + r.hPct <= 100.01, name + ' ' + JSON.stringify(r));
      }
      // The rectangles along the top edge must span the full width.
      const top = rects.filter(r => r.yPct === 0);
      const width = top.reduce((sum, r) => sum + r.wPct, 0);
      assert.ok(Math.abs(width - 100) < 0.01, name + ' n=' + n + ' top row ' + width);
    }
  }
});

test('toFloatRects makes room for the bar when asked', () => {
  const rects = plain(S.toFloatRects(S.preset('rows', 2), 4));
  assert.equal(rects[0].yPct, 4);
  assert.ok(Math.abs(rects[1].yPct + rects[1].hPct - 100) < 0.01);
});

test('toWorkspaceLayout maps a single split exactly', () => {
  assert.deepEqual(plain(S.toWorkspaceLayout(S.preset('mainLeft', 2))), {
    layout: 'master', layoutOpts: { mfact: 0.6, orientation: 'left' }, exact: true, note: ''
  });
  assert.deepEqual(plain(S.toWorkspaceLayout(S.preset('mainTop', 2))).layoutOpts, { mfact: 0.6, orientation: 'top' });
});

test('toWorkspaceLayout maps main+stack exactly, from any side', () => {
  for (const [name, orientation] of [['mainLeft', 'left'], ['mainRight', 'right'], ['mainTop', 'top'], ['mainBottom', 'bottom']]) {
    for (let n = 3; n <= 6; n++) {
      const projected = plain(S.toWorkspaceLayout(S.preset(name, n)));
      assert.equal(projected.layout, 'master', name + ' n=' + n);
      assert.equal(projected.layoutOpts.orientation, orientation, name + ' n=' + n);
      assert.equal(projected.layoutOpts.mfact, 0.6, name + ' n=' + n);
      assert.equal(projected.exact, true, name + ' n=' + n);
    }
  }
});

test('toWorkspaceLayout admits when it is approximating', () => {
  const columns = plain(S.toWorkspaceLayout(S.preset('columns', 3)));
  assert.equal(columns.exact, false);
  assert.match(columns.note, /columns approximated as main left/);
  assert.equal(plain(S.toWorkspaceLayout(S.preset('grid', 4))).exact, false);
  assert.match(S.fidelityNote(S.preset('columns', 3)), /Approximated as/);
  assert.match(S.fidelityNote(S.preset('mainLeft', 3)), /^Exact/);
});

test('toWorkspaceLayout emits nothing for a tree with fewer than two leaves', () => {
  assert.equal(S.toWorkspaceLayout(null).layout, '');
  assert.equal(S.toWorkspaceLayout({ app: 0 }).layout, '');
  assert.equal(S.toWorkspaceLayout({ app: 0 }).exact, true);
});

test('every projected orientation is one Hyprland actually has', () => {
  const allowed = ['left', 'right', 'top', 'bottom', 'center'];
  for (const name of PRESETS) {
    for (let n = 2; n <= 8; n++) {
      const opts = plain(S.toWorkspaceLayout(S.preset(name, n))).layoutOpts;
      assert.ok(allowed.indexOf(opts.orientation) !== -1, name + ' n=' + n + ' ' + opts.orientation);
      assert.ok(opts.mfact > 0 && opts.mfact < 1, name + ' n=' + n + ' ' + opts.mfact);
    }
  }
});

test('treeFromRects is deferred and says so by returning null', () => {
  assert.equal(S.treeFromRects([{ x: 0, y: 0, w: 10, h: 10 }], { w: 10, h: 10 }), null);
});
