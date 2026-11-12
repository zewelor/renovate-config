import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const root = process.env.RENOVATE_ROOT ?? require.resolve('renovate/package.json').replace(/\/package\.json$/, '');
const { applyPackageRules } = await import(pathToFileURL(`${root}/dist/util/package-rules/index.js`));
const actions = JSON.parse(await readFile(new URL('../presets/github-actions.json', import.meta.url)));
const go = JSON.parse(await readFile(new URL('../presets/go.json', import.meta.url)));
const apply = (preset, dep) => applyPackageRules({ automerge: false, ...dep, packageRules: preset.packageRules });

for (const updateType of ['major', 'minor', 'patch', 'pin', 'digest']) {
  const result = await apply(actions, { manager: 'github-actions', depType: 'action', depName: 'actions/checkout', updateType });
  assert.equal(result.automerge, true, `action ${updateType}`);
}
for (const dep of [
  { manager: 'github-actions', depType: 'workflow', depName: 'owner/reusable' },
  { manager: 'github-actions', depType: 'service', depName: 'postgres' },
  { manager: 'github-actions', depType: 'container', depName: 'golang' },
  { manager: 'dockerfile', depType: 'action', depName: 'golang' },
  { manager: 'github-actions', depType: 'uses-with', depName: 'go' },
]) assert.equal((await apply(actions, dep)).automerge, false, JSON.stringify(dep));

for (const dep of [
  { manager: 'gomod', depType: 'golang', depName: 'go' },
  { manager: 'gomod', depType: 'toolchain', depName: 'go' },
  { manager: 'dockerfile', depName: 'golang' },
  { manager: 'dockerfile', depName: 'docker.io/library/golang' },
  { manager: 'github-actions', depName: 'go' },
  { manager: 'mise', depName: 'go' },
]) assert.equal((await apply(go, dep)).groupName, 'Go toolchain', JSON.stringify(dep));
assert.equal((await apply(go, { manager: 'gomod', depType: 'golang', depName: 'go' })).rangeStrategy, 'bump');
assert.equal((await apply(go, { manager: 'gomod', depType: 'toolchain', depName: 'go' })).rangeStrategy, undefined);
assert.equal((await apply(go, { manager: 'gomod', depType: 'require', depName: 'example.com/go' })).groupName, undefined);
const exception = await applyPackageRules({ manager: 'github-actions', depType: 'action', depName: 'actions/checkout', packageName: 'actions/checkout', packageRules: [...actions.packageRules, { matchPackageNames: ['actions/checkout'], automerge: false }] });
assert.equal(exception.automerge, false, 'a later local exception overrides the preset');
console.log('Policy cases passed');
