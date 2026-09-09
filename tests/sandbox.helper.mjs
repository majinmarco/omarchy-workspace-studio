// Loads the plugin's pure JS modules the way QML does: as plain scripts sharing
// one global scope, with no module system. `node:vm` reproduces that exactly, so
// the tests exercise the same file the shell executes rather than a Node-only
// variant of it.

import fs from 'node:fs';
import vm from 'node:vm';

const here = new URL('.', import.meta.url);

export function loadSandbox() {
  const sandbox = {};
  vm.createContext(sandbox);
  for (const name of ['Config.js', 'HyprGen.js', 'Import.js']) {
    const source = fs.readFileSync(new URL('../' + name, here), 'utf8');
    vm.runInContext(source, sandbox, { filename: name });
  }
  return sandbox;
}

export function readRepoFile(relative) {
  return fs.readFileSync(new URL('../' + relative, here), 'utf8');
}

export function readRepoJson(relative) {
  return JSON.parse(readRepoFile(relative));
}

// vm.createContext() gives the sandbox its own realm, so arrays and objects it
// creates do not pass assert.deepEqual's prototype check against host literals.
// plain() copies a value back into this realm for comparison.
export function plain(value) {
  return JSON.parse(JSON.stringify(value));
}
