// Loads the plugin's pure JS modules the way QML does: as plain scripts sharing
// one global scope, with no module system. `node:vm` reproduces that exactly, so
// the tests exercise the same file the shell executes rather than a Node-only
// variant of it.

import fs from 'node:fs';
import vm from 'node:vm';

const here = new URL('.', import.meta.url);

export function loadSandbox(options) {
  const sandbox = {};
  vm.createContext(sandbox);
  for (const name of ['Config.js', 'HyprGen.js', 'Layout.js', 'Import.js', 'AppSearch.js']) {
    const source = fs.readFileSync(new URL('../' + name, here), 'utf8');
    vm.runInContext(source, sandbox, { filename: name });
  }
  // QML gives each .js resource its own scope, so Config and HyprGen are handed
  // the layout module explicitly — exactly what Studio.qml does on startup.
  // Here every script shares one scope, so the sandbox itself IS the module,
  // and the two injectors have different names so neither shadows the other.
  // Tests that want the un-injected fallback call loadSandbox({ layout: false }).
  if (!options || options.layout !== false) {
    sandbox.useLayout(sandbox);
    sandbox.useLayoutModule(sandbox);
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
