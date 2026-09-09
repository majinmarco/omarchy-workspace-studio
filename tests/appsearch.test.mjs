import test from 'node:test';
import assert from 'node:assert/strict';
import { loadSandbox, readRepoFile, plain } from './sandbox.helper.mjs';

const S = loadSandbox();

// AppSearch.js is a vendored copy of Omarchy's own ranking (see the header in
// that file for why). These tests pin the behaviour the app picker depends on,
// so a re-copy from a newer Omarchy that changed the ranking fails here rather
// than quietly reordering everyone's app list.

// A slice of the real desktop entries on an Omarchy machine.
const ENTRIES = [
  { id: 'chromium', name: 'Chromium', genericName: 'Web Browser', keywords: ['browser'] },
  { id: 'foot', name: 'Foot', genericName: 'Terminal' },
  { id: 'org.gnome.Nautilus', name: 'Files', genericName: 'File Manager' },
  { id: 'Slack', name: 'Slack' },
  { id: 'WhatsApp', name: 'WhatsApp' },
  { id: 'spotify', name: 'Spotify', genericName: 'Music Player' },
  { id: 'hidden-thing', name: 'Hidden Thing', noDisplay: true },
  { id: 'nameless', name: '' }
];

function ids(rows) {
  return plain(rows).map(row => row.entry.id);
}

test('the vendored copy still carries its CommonJS guard', () => {
  const source = readRepoFile('AppSearch.js');
  assert.ok(source.includes('if (typeof module !== "undefined")'));
  assert.ok(source.includes('sortedEntries: sortedEntries'));
});

test('the vendored copy names where it came from', () => {
  const header = readRepoFile('AppSearch.js').split('\n').slice(0, 20).join('\n');
  assert.match(header, /PROVENANCE/);
  assert.match(header, /services\/AppSearch\.js/);
  assert.match(header, /MIT/);
});

test('every function the picker calls is exported', () => {
  for (const name of ['entryName', 'entrySubtext', 'fuzzyScore', 'sortedEntries']) {
    assert.equal(typeof S[name], 'function', name);
  }
});

test('an empty query lists everything visible, sorted by display name', () => {
  // Sorted by entryName lowercased: Chromium, Files, Foot, (nameless -> its
  // id), Slack, Spotify, WhatsApp.
  assert.deepEqual(ids(S.sortedEntries(ENTRIES, '', null)),
    ['chromium', 'org.gnome.Nautilus', 'foot', 'nameless', 'Slack', 'spotify', 'WhatsApp']);
});

test('noDisplay entries never appear', () => {
  assert.equal(ids(S.sortedEntries(ENTRIES, '', null)).indexOf('hidden-thing'), -1);
});

test('the hidden callback filters the launcher.hides list', () => {
  const hidden = entry => entry.id === 'Slack';
  assert.equal(ids(S.sortedEntries(ENTRIES, '', hidden)).indexOf('Slack'), -1);
});

test('a name prefix outranks a substring, which outranks the id', () => {
  assert.deepEqual(ids(S.sortedEntries(ENTRIES, 'fo', null)), ['foot']);
  const chrome = ids(S.sortedEntries(ENTRIES, 'chrom', null));
  assert.equal(chrome[0], 'chromium');
  // "browser" only appears in a keyword and a genericName.
  assert.deepEqual(ids(S.sortedEntries(ENTRIES, 'browser', null)), ['chromium']);
});

test('every term has to match', () => {
  assert.deepEqual(ids(S.sortedEntries(ENTRIES, 'file manager', null)), ['org.gnome.Nautilus']);
  assert.deepEqual(ids(S.sortedEntries(ENTRIES, 'file browser', null)), []);
});

test('entryName falls back to the id and entrySubtext to nothing', () => {
  assert.equal(S.entryName({ id: 'x' }), 'x');
  assert.equal(S.entryName({ id: 'x', name: 'X' }), 'X');
  assert.equal(S.entryName(null), '');
  assert.equal(S.entrySubtext({ id: 'x' }), '');
  assert.equal(S.entrySubtext({ genericName: 'Terminal' }), 'Terminal');
});

test('ranking is stable, so the list does not shuffle between keystrokes', () => {
  const once = ids(S.sortedEntries(ENTRIES, 's', null));
  assert.deepEqual(ids(S.sortedEntries(ENTRIES, 's', null)), once);
});
