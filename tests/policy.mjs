import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const root = process.env.RENOVATE_ROOT ?? require.resolve('renovate/package.json').replace(/\/package\.json$/, '');
const { applyPackageRules } = await import(pathToFileURL(`${root}/dist/util/package-rules/index.js`));
const actions = JSON.parse(await readFile(new URL('../presets/github-actions.json', import.meta.url)));
const go = JSON.parse(await readFile(new URL('../presets/go.json', import.meta.url)));
const rubyImages = JSON.parse(await readFile(new URL('../presets/ruby-images.json', import.meta.url)));
const rubyVersion = JSON.parse(await readFile(new URL('../presets/ruby-version.json', import.meta.url)));
const repoConfig = JSON.parse(await readFile(new URL('../.github/renovate.json', import.meta.url)));
const { extractPackageFile } = await import(pathToFileURL(`${root}/dist/modules/manager/custom/regex/index.js`));
const apply = (preset, dep) => applyPackageRules({ automerge: false, ...dep, packageRules: preset.packageRules });

for (const updateType of ['minor', 'patch', 'major']) {
  const dep = { manager: 'npm', datasource: 'npm', packageName: 'renovate', depName: 'renovate', updateType };
  const result = await apply(repoConfig, dep);
  assert.equal(result.automerge, true, `renovate ${updateType}`);
  assert.equal(result.rangeStrategy, 'update-lockfile', `renovate ${updateType} range strategy`);
}
for (const dep of [
  { manager: 'npm', datasource: 'npm', packageName: 'another-package', depName: 'another-package' },
  { manager: 'github-actions', datasource: 'github-tags', packageName: 'renovate', depName: 'renovate' },
]) assert.equal((await apply(repoConfig, { ...dep, updateType: 'minor' })).automerge, false, JSON.stringify(dep));

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
for (const packageName of ['dhi.io/ruby', 'ghcr.io/zewelor/ruby']) {
  for (const updateType of ['digest', 'pinDigest', 'patch', 'minor', 'major']) {
    const result = await apply(rubyImages, { datasource: 'docker', packageName, depName: packageName, updateType });
    assert.equal(result.pinDigests, true, `${packageName} pinning`);
    assert.equal(result.automerge, ['digest', 'patch'].includes(updateType), `${packageName} ${updateType}`);
    assert.equal(result.automergeType, ['digest', 'patch'].includes(updateType) ? 'branch' : undefined, `${packageName} ${updateType} merge type`);
  }
  const local = await applyPackageRules({ datasource: 'docker', packageName, depName: packageName, updateType: 'digest', packageRules: [...rubyImages.packageRules, { matchPackageNames: [packageName], automerge: false }] });
  assert.equal(local.automerge, false, `${packageName} local exception`);
  const localMergeType = await applyPackageRules({ datasource: 'docker', packageName, depName: packageName, updateType: 'digest', packageRules: [...rubyImages.packageRules, { matchPackageNames: [packageName], automergeType: 'pr' }] });
  assert.equal(localMergeType.automergeType, 'pr', `${packageName} local merge type exception`);
}
for (const dep of [
  { datasource: 'docker', packageName: 'ghcr.io/zewelor/ruby-other', depName: 'ghcr.io/zewelor/ruby-other' },
  { datasource: 'docker', packageName: 'ruby', depName: 'ruby' },
  { datasource: 'npm', packageName: 'dhi.io/ruby', depName: 'dhi.io/ruby' },
]) {
  const result = await apply(rubyImages, { ...dep, updateType: 'digest' });
  assert.equal(result.automerge, false, JSON.stringify(dep));
  assert.equal(result.pinDigests, undefined, JSON.stringify(dep));
}
const rubyManager = rubyVersion.customManagers[0];
assert.equal(rubyVersion['ruby-version'].enabled, false);
for (const input of ['3.4.7\n', '3.4.7']) {
  const { deps } = extractPackageFile(input, '.ruby-version', rubyManager);
  assert.equal(deps.length, 1);
  assert.equal(deps[0].currentValue, '3.4.7');
  assert.equal(deps[0].depName, 'docker.io/library/ruby');
  assert.equal(deps[0].datasource, 'docker');
  assert.equal(deps[0].versioning, 'docker');
}
for (const input of ['ruby-3.4.7\n', '3.4\n', '3.4.7\nother=3.4.7\n']) {
  assert.equal(extractPackageFile(input, '.ruby-version', rubyManager), null, input);
}
console.log('Policy cases passed');
