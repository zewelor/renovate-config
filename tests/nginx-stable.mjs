import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const root = process.env.RENOVATE_ROOT ?? require.resolve('renovate/package.json').replace(/\/package\.json$/, '');
const fromRenovate = path => import(pathToFileURL(`${root}/dist/${path}.js`));
const { getConfig } = await fromRenovate('config/defaults');
const { GlobalConfig } = await fromRenovate('config/global');
const { init } = await fromRenovate('logger/index');
const { getDatasources } = await fromRenovate('modules/datasource/index');
const { extractPackageFile: extractRegex } = await fromRenovate('modules/manager/custom/regex/index');
const { extractPackageFile: extractCompose } = await fromRenovate('modules/manager/docker-compose/index');
const { applyPackageRules } = await fromRenovate('util/package-rules/index');
const { getMatchingFiles } = await fromRenovate('workers/repository/extract/file-match');
const { lookupUpdates } = await fromRenovate('workers/repository/process/lookup/index');
const { doAutoReplace } = await fromRenovate('workers/repository/update/branch/auto-replace');

await init();
const repoConfig = JSON.parse(await readFile(new URL('../.github/renovate.json', import.meta.url)));
const packageFile = 'presets/nginx-stable.json';
const [manager] = (repoConfig.customManagers ?? []).filter(config =>
  getMatchingFiles(config, [packageFile]).length);
assert.ok(repoConfig.enabledManagers.includes('custom.regex') && manager, 'Renovate discovers the preset to update');
const presetText = await readFile(new URL(`../${packageFile}`, import.meta.url), 'utf8');
const preset = JSON.parse(presetText);
const { deps: [stable] } = extractRegex(presetText, packageFile, manager);

const localDir = await mkdtemp(join(tmpdir(), 'renovate-nginx-stable-'));
GlobalConfig.set({ localDir });
try {
  const channelConfig = {
    ...getConfig(), ...stable, packageName: stable.depName,
    customDatasources: repoConfig.customDatasources,
    registryUrls: ['file://versions.xml'],
  };
  const versionsXml = stableLine => `
<versions>
  <download tag="mainline" changes="">
    <item ver="99.1.0" />
  </download>
  ${stableLine}
  <download tag="legacy" changes="1.28">
    <item ver="1.28.3" />
  </download>
</versions>`;
  const nextLine = '99.0';
  const stableSection = `<download tag="stable" changes="${nextLine}">
    <item ver="${nextLine}.0" />
    <item ver="1.31.9" />
  </download>`;
  await writeFile(join(localDir, 'versions.xml'), versionsXml(stableSection));
  const channel = (await lookupUpdates(channelConfig)).unwrap().val;
  assert.deepEqual(channel.updates.map(update => update.newValue), [nextLine]);

  const replacementFile = 'nginx-stable.json';
  await writeFile(join(localDir, replacementFile), presetText);
  const nextPresetText = await doAutoReplace({
    ...manager, ...stable, ...channel.updates[0],
    manager: 'regex', packageFile: replacementFile, depIndex: 0,
  }, presetText, false);
  assert.equal(nextPresetText, presetText.replace(`'${stable.currentValue}'`, `'${nextLine}'`));
  const nextPreset = JSON.parse(nextPresetText);

  await writeFile(join(localDir, 'versions.xml'), versionsXml(''));
  const missing = (await lookupUpdates(channelConfig)).unwrap().val;
  assert.deepEqual(missing.updates, []);
  assert.ok(missing.warnings.length, 'Renovate reports a missing Stable channel');

  const docker = getDatasources().get('docker');
  const currentDigest = `sha256:${'a'.repeat(64)}`;
  const newDigest = `sha256:${'b'.repeat(64)}`;
  const [major, minor] = stable.currentValue.split('.').map(Number);
  const patch = `${major}.${minor}.7`;
  const mainline = `${major}.${minor + 1}.9`;
  const alpineCompose = `services:\n  proxy:\n    image: dhi.io/nginx:${major}.${minor}.6-alpine@${currentDigest}\n`;
  const plainCompose = `services:\n  proxy:\n    image: docker.io/library/nginx:${major}.${minor}.6\n`;

  let tags = [];
  docker.getReleases = async () => ({ releases: tags.map(version => ({ version })) });
  let publishedCurrentDigest = currentDigest;
  docker.getDigest = async (config, tag) =>
    !tag || tag === config.currentValue ? publishedCurrentDigest : newDigest;
  const imageUpdates = async (compose, policy) => {
    const { deps: [dep] } = extractCompose(compose, 'compose.yaml', {});
    const config = await applyPackageRules({
      ...getConfig(), ...dep, manager: 'docker-compose', packageRules: policy.packageRules,
    });
    const result = (await lookupUpdates(config)).unwrap().val;
    assert.deepEqual(result.warnings, []);
    return result.updates;
  };

  tags = [patch, `${mainline}-alpine`, `${patch}-alpine-dev`, `${patch}-alpine3.24`];
  assert.deepEqual(await imageUpdates(alpineCompose, preset), []);
  assert.deepEqual((await imageUpdates(plainCompose, preset)).map(update => update.newValue), [patch]);

  publishedCurrentDigest = newDigest;
  const [rebuild] = await imageUpdates(alpineCompose, preset);
  assert.equal(rebuild.updateType, 'digest');
  assert.equal(rebuild.newDigest, newDigest);
  assert.equal(rebuild.newValue, `${major}.${minor}.6-alpine`);
  publishedCurrentDigest = currentDigest;

  tags.push(`${patch}-alpine`);
  const [alpinePatch] = await imageUpdates(alpineCompose, preset);
  assert.equal(alpinePatch.newValue, `${patch}-alpine`);
  assert.equal(alpinePatch.newDigest, newDigest);

  tags.push(`${nextLine}.0-alpine`, '99.1.0-alpine');
  const nextUpdates = await imageUpdates(alpineCompose, nextPreset);
  assert.deepEqual(nextUpdates.map(update => update.newValue), [`${nextLine}.0-alpine`]);

  const stableLine = stable.currentValue;
  const mainlineLine = `${major}.${minor + 1}`;
  tags = [stableLine, `${stableLine}-alpine`, patch, mainlineLine, `${mainlineLine}-alpine`, mainline];
  const aliasCases = [
    ['nginx:1.28', stableLine],
    ['nginx:1.28-alpine', `${stableLine}-alpine`],
    [`index.docker.io/library/nginx:${stableLine}.6`, patch],
    [`registry-1.docker.io/library/nginx:${stableLine}.6`, patch],
    [`index.docker.io/nginx:${stableLine}.6`, patch],
    [`registry-1.docker.io/nginx:${stableLine}.6`, patch],
  ];
  const selectedTags = {};
  for (const [image] of aliasCases) {
    const compose = `services:\n  proxy:\n    image: ${image}\n`;
    selectedTags[image] = (await imageUpdates(compose, preset)).map(update => update.newValue);
  }
  assert.deepEqual(selectedTags, Object.fromEntries(aliasCases.map(([image, tag]) => [image, [tag]])));
} finally {
  GlobalConfig.reset();
  await rm(localDir, { recursive: true, force: true });
}

console.log('NGINX stable channel, preset update and Docker variant cases passed');
