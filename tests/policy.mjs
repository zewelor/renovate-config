import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const root = process.env.RENOVATE_ROOT ?? require.resolve('renovate/package.json').replace(/\/package\.json$/, '');
const { applyPackageRules } = await import(pathToFileURL(`${root}/dist/util/package-rules/index.js`));
const actions = JSON.parse(await readFile(new URL('../github-actions.json', import.meta.url)));
const go = JSON.parse(await readFile(new URL('../go.json', import.meta.url)));
const apply = (preset, dep) => applyPackageRules({ automerge: false, ...dep, packageRules: preset.packageRules });

for (const updateType of ['major', 'minor', 'patch', 'digest']) {
  const result = await apply(actions, { manager: 'github-actions', depType: 'action', depName: 'actions/checkout', updateType });
  assert.equal(result.automerge, true, `action ${updateType}`);
}
for (const dep of [
  { manager: 'github-actions', depType: 'workflow', depName: 'owner/reusable' },
  { manager: 'github-actions', depType: 'service', depName: 'postgres' },
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
assert.deepEqual(go.postUpdateOptions, ['gomodTidy']);
console.log('Policy cases passed');

// Exercise Renovate's Go parser and update implementation on a realistic module.
const gomod = await import(pathToFileURL(`${root}/dist/modules/manager/gomod/extract.js`));
const { updateDependency } = await import(pathToFileURL(`${root}/dist/modules/manager/gomod/update.js`));
const before = 'module example.com/project\n\ngo 1.25.0\n\ntoolchain go1.25.1\n\nrequire example.com/dependency v1.2.3\n';
const deps = gomod.extractPackageFile(before).deps;
const directive = deps.find((dep) => dep.depType === 'golang');
const toolchain = deps.find((dep) => dep.depType === 'toolchain');
assert.ok(directive && toolchain);
let after = updateDependency({ fileContent: before, upgrade: { ...directive, updateType: 'minor', newValue: '1.26.0' } });
after = updateDependency({ fileContent: after, upgrade: { ...toolchain, updateType: 'minor', newValue: '1.26.1' } });
assert.equal(after, 'module example.com/project\n\ngo 1.26.0\n\ntoolchain go1.26.1\n\nrequire example.com/dependency v1.2.3\n');
console.log('Go extraction and replacements passed');

const pilot = JSON.parse(await readFile(new URL('../examples/garmin-daily.json', import.meta.url)));
const pilotRules = [...actions.packageRules, ...go.packageRules, ...pilot.packageRules];
for (const depType of ['action', 'workflow', 'docker', 'container', 'service', 'github-runner', 'uses-with']) {
  const result = await applyPackageRules({ manager: 'github-actions', depType, depName: 'example', packageName: 'example', automerge: false, packageRules: pilotRules });
  assert.equal(result.automerge, true, `Garmin retains ${depType} automerge`);
}
const pg = await applyPackageRules({ manager: 'docker-compose', depName: 'postgres', packageName: 'postgres', updateType: 'digest', automerge: false, packageRules: pilotRules });
assert.equal(pg.automerge, true);
assert.deepEqual(pg.schedule, ['* * * * 0']);
const unrelated = await applyPackageRules({ manager: 'docker-compose', depName: 'redis', packageName: 'redis', updateType: 'major', automerge: false, packageRules: pilotRules });
assert.equal(unrelated.automerge, false);
console.log('Garmin pilot policy cases passed');
