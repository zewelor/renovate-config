import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const root = process.env.RENOVATE_ROOT ?? require.resolve('renovate/package.json').replace(/\/package\.json$/, '');
const { getConfig } = await import(pathToFileURL(`${root}/dist/config/defaults.js`));
const { init } = await import(pathToFileURL(`${root}/dist/logger/index.js`));
const { getDatasources } = await import(pathToFileURL(`${root}/dist/modules/datasource/index.js`));
const { extractPackageFile: extractCompose } = await import(pathToFileURL(`${root}/dist/modules/manager/docker-compose/index.js`));
const { lookupUpdates } = await import(pathToFileURL(`${root}/dist/workers/repository/process/lookup/index.js`));
const { applyPackageRules } = await import(pathToFileURL(`${root}/dist/util/package-rules/index.js`));
const actions = JSON.parse(await readFile(new URL('../presets/github-actions.json', import.meta.url)));
const go = JSON.parse(await readFile(new URL('../presets/go.json', import.meta.url)));
const nginxStable = JSON.parse(await readFile(new URL('../presets/nginx-stable.json', import.meta.url)));
const { presetSources, resolveConfigPresets } = await import(pathToFileURL(`${root}/dist/config/presets/index.js`));
const rubyVersion = JSON.parse(await readFile(new URL('../presets/ruby-version.json', import.meta.url)));
const repoConfig = JSON.parse(await readFile(new URL('../.github/renovate.json', import.meta.url)));
const { extractPackageFile } = await import(pathToFileURL(`${root}/dist/modules/manager/custom/regex/index.js`));
await init();
const rubyImages = await resolvePreset('ruby-images', 'ruby-image-names');
const postgresql18 = await resolvePreset('postgresql-18', 'postgresql-image-names');
async function resolvePreset(name, matcher) {
  const originalLoad = presetSources.github.load;
  presetSources.github.load = async () => ({
    getPreset: async ({ repo, presetPath, presetName, tag }) => {
      assert.equal(repo, 'zewelor/renovate-config');
      assert.equal(presetPath, 'presets');
      assert.equal(tag, 'policy-test');
      assert.ok([name, matcher].includes(presetName));
      return JSON.parse(await readFile(new URL(`../presets/${presetName}.json`, import.meta.url)));
    },
  });
  try {
    const result = await resolveConfigPresets({ extends: [`github>zewelor/renovate-config//presets/${name}#policy-test`] });
    assert.ok(result.visitedPresets.merged.includes(`github>zewelor/renovate-config//presets/${matcher}#policy-test`));
    return result.config;
  } finally {
    presetSources.github.load = originalLoad;
  }
}
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
]) {
  const result = await apply(go, dep);
  assert.equal(result.groupName, 'Go toolchain', JSON.stringify(dep));
  assert.equal(result.groupSingleUpdates, true, JSON.stringify(dep));
}
for (const updateType of ['digest', 'patch', 'minor']) {
  const result = await apply(go, { manager: 'dockerfile', datasource: 'docker', depName: 'golang', updateType });
  assert.equal(result.groupName, 'Go toolchain', updateType);
  assert.equal(result.groupSingleUpdates, true, updateType);
}
assert.equal((await apply(go, { manager: 'gomod', depType: 'golang', depName: 'go' })).rangeStrategy, 'bump');
assert.equal((await apply(go, { manager: 'gomod', depType: 'toolchain', depName: 'go' })).rangeStrategy, undefined);
assert.equal((await apply(go, { manager: 'gomod', depType: 'require', depName: 'example.com/go' })).groupName, undefined);
const exception = await applyPackageRules({ manager: 'github-actions', depType: 'action', depName: 'actions/checkout', packageName: 'actions/checkout', packageRules: [...actions.packageRules, { matchPackageNames: ['actions/checkout'], automerge: false }] });
assert.equal(exception.automerge, false, 'a later local exception overrides the preset');
for (const packageName of ['ruby', 'library/ruby', 'docker.io/ruby', 'docker.io/library/ruby', 'index.docker.io/ruby', 'index.docker.io/library/ruby', 'registry-1.docker.io/ruby', 'registry-1.docker.io/library/ruby', 'dhi.io/ruby', 'ghcr.io/zewelor/ruby']) {
  for (const updateType of ['digest', 'pinDigest', 'patch', 'minor', 'major']) {
    const result = await apply(rubyImages, { manager: 'dockerfile', datasource: 'docker', packageName, depName: packageName, updateType });
    assert.equal(result.groupName, ['digest', 'patch', 'minor'].includes(updateType) ? 'Ruby' : undefined, `${packageName} ${updateType} grouping`);
    assert.equal(result.groupSingleUpdates, ['digest', 'patch', 'minor'].includes(updateType) ? true : undefined, `${packageName} ${updateType} single update`);
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
  { manager: 'dockerfile', datasource: 'docker', packageName: 'ghcr.io/zewelor/ruby-other', depName: 'ghcr.io/zewelor/ruby-other' },
  { datasource: 'npm', packageName: 'dhi.io/ruby', depName: 'dhi.io/ruby' },
]) {
  const result = await apply(rubyImages, { ...dep, updateType: 'digest' });
  assert.equal(result.automerge, false, JSON.stringify(dep));
  assert.equal(result.pinDigests, undefined, JSON.stringify(dep));
  assert.equal(result.groupName, undefined, JSON.stringify(dep));
}
const rubyGem = await apply(rubyImages, { manager: 'bundler', datasource: 'rubygems', depName: 'ruby', packageName: 'ruby', updateType: 'minor' });
assert.equal(rubyGem.groupName, undefined);
const rubyManager = rubyVersion.customManagers[0];
assert.equal(rubyVersion['ruby-version'].enabled, false);
for (const input of ['3.4.7\n', '3.4.7']) {
  const { deps } = extractPackageFile(input, '.ruby-version', rubyManager);
  assert.equal(deps.length, 1);
  assert.equal(deps[0].currentValue, '3.4.7');
  assert.equal(deps[0].depName, 'docker.io/library/ruby');
  assert.equal(deps[0].datasource, 'docker');
  assert.equal(deps[0].versioning, 'docker');
  const result = await apply(rubyImages, { ...deps[0], packageName: deps[0].depName, manager: 'custom.regex', updateType: 'patch' });
  assert.equal(result.groupName, 'Ruby');
  assert.equal(result.groupSingleUpdates, true);
  assert.equal(result.pinDigests, undefined, 'version-only regex declarations must not be pinned');
  assert.equal(result.automerge, true, 'Ruby patch policy applies to the version declaration');
}
for (const input of ['ruby-3.4.7\n', '3.4\n', '3.4.7\nother=3.4.7\n']) {
  assert.equal(extractPackageFile(input, '.ruby-version', rubyManager), null, input);
}
for (const [preset, group, names] of [
  [nginxStable, 'NGINX', ['nginx', 'library/nginx', 'docker.io/nginx', 'docker.io/library/nginx', 'index.docker.io/nginx', 'index.docker.io/library/nginx', 'registry-1.docker.io/nginx', 'registry-1.docker.io/library/nginx', 'dhi.io/nginx']],
  [postgresql18, 'PostgreSQL 18', ['postgres', 'library/postgres', 'docker.io/postgres', 'docker.io/library/postgres', 'index.docker.io/postgres', 'index.docker.io/library/postgres', 'registry-1.docker.io/postgres', 'registry-1.docker.io/library/postgres']],
]) {
  for (const packageName of names) {
    for (const updateType of ['digest', 'patch', 'minor']) {
      const currentValue = group === 'PostgreSQL 18' ? '18.7-trixie' : '1.30.6-alpine';
      const result = await apply(preset, { datasource: 'docker', packageName, depName: packageName, currentValue, updateType });
      assert.equal(result.groupName, group, `${packageName} ${updateType}`);
      assert.equal(result.groupSingleUpdates, true);
      assert.equal(result.automerge, false);
      assert.equal(result.schedule, undefined);
      assert.equal(result.pinDigests, undefined);
    }
  }
  const unrelated = `ghcr.io/example/${names[0]}`;
  const currentValue = group === 'PostgreSQL 18' ? '18-alpine' : '1.30.6-alpine';
  assert.equal((await apply(preset, { datasource: 'docker', packageName: unrelated, depName: unrelated, currentValue, updateType: 'digest' })).groupName, undefined);
  assert.equal((await apply(preset, { datasource: 'npm', packageName: names[0], depName: names[0], currentValue, updateType: 'patch' })).groupName, undefined);
}
for (const currentValue of ['18', '18-alpine', '18.7', '18.7-trixie']) {
  const result = await apply(postgresql18, { datasource: 'docker', packageName: 'postgres', depName: 'postgres', currentValue, updateType: 'digest' });
  assert.equal(result.groupName, 'PostgreSQL 18', currentValue);
}
for (const currentValue of ['17', '17.7-alpine', '19', '181-alpine', 'latest', undefined]) {
  const result = await apply(postgresql18, { datasource: 'docker', packageName: 'postgres', depName: 'postgres', currentValue, updateType: 'digest' });
  assert.equal(result.groupName, undefined, String(currentValue));
  assert.equal(result.allowedVersions, '/^18(?:[.-]|$)/', 'keep the version filter independent of grouping');
}
const pgRule = await apply(postgresql18, { datasource: 'docker', packageName: 'postgres', depName: 'postgres' });
assert.equal(pgRule.versioning, 'docker');
assert.equal(pgRule.allowedVersions, '/^18(?:[.-]|$)/');
assert.equal(pgRule.automerge, false);
assert.equal(pgRule.schedule, undefined);
assert.equal(pgRule.pinDigests, undefined);
const docker = getDatasources().get('docker');
const prevGetReleases = docker.getReleases;
const prevGetDigest = docker.getDigest;
const pgTags = ['18', '18.7', '18.8', '19', '19.0', '181', '18-alpine', '18.7-alpine', '18-trixie', '19-alpine', '181-alpine', '18.7-trixie', '18.8-trixie', '18.8-alpine', '19.0-trixie'];
try {
  docker.getReleases = async () => ({ releases: pgTags.map(version => ({ version })) });
  docker.getDigest = async () => undefined;
  const pgUpdates = async image => {
    const { deps: [dep] } = extractCompose(`services:\n  db:\n    image: ${image}\n`, 'compose.yaml', {});
    const config = await applyPackageRules({ ...getConfig(), ...dep, manager: 'docker-compose', packageRules: postgresql18.packageRules });
    const result = (await lookupUpdates(config)).unwrap().val;
    assert.deepEqual(result.warnings, []);
    return result.updates.map(update => update.newValue);
  };
  assert.deepEqual(await pgUpdates('postgres:18'), []);
  assert.deepEqual(await pgUpdates('postgres:18-alpine'), []);
  assert.deepEqual(await pgUpdates('postgres:18.7-trixie'), ['18.8-trixie']);
  for (const name of ['library/postgres', 'docker.io/postgres', 'docker.io/library/postgres', 'index.docker.io/postgres', 'index.docker.io/library/postgres', 'registry-1.docker.io/postgres', 'registry-1.docker.io/library/postgres']) {
    assert.deepEqual(await pgUpdates(`${name}:18.7-trixie`), ['18.8-trixie'], name);
  }
  assert.deepEqual(await pgUpdates('ghcr.io/example/postgres:18'), ['181']);
} finally {
  docker.getReleases = prevGetReleases;
  docker.getDigest = prevGetDigest;
}
console.log('Policy cases passed');
