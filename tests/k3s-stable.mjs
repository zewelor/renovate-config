import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const root = process.env.RENOVATE_ROOT ?? require.resolve('renovate/package.json').replace(/\/package\.json$/, '');
const { applyPackageRules } = await import(pathToFileURL(`${root}/dist/util/package-rules/index.js`));
const jsonata = require('jsonata');
const preset = JSON.parse(await readFile(new URL('../presets/k3s-stable.json', import.meta.url)));
const datasource = preset.customDatasources.k3sStable;

const channels = { data: [
  { id: 'latest', latest: 'v1.38.0+k3s1' },
  { id: 'stable', latest: 'v1.37.2+k3s1' },
] };
const result = await jsonata(datasource.transformTemplates[0]).evaluate(channels);
assert.deepEqual(result.releases.map(({ version }) => version), ['v1.37.2+k3s1']);
assert.equal(result.releases[0].changelogUrl, 'https://github.com/k3s-io/k3s/releases/tag/v1.37.2+k3s1');
const missing = await jsonata(datasource.transformTemplates[0]).evaluate({ data: [{ id: 'latest', latest: 'v1.38.0+k3s1' }] });
assert.equal(missing.releases[0].version, undefined);

const apply = (datasourceName, rules = preset.packageRules) => applyPackageRules({ datasource: datasourceName, minimumReleaseAge: '7 days', packageRules: rules });
assert.equal((await apply('custom.k3sStable')).minimumReleaseAge, null);
assert.equal((await apply('github-releases')).minimumReleaseAge, '7 days');
assert.equal((await apply('custom.k3sStable', [...preset.packageRules, { matchDatasources: ['custom.k3sStable'], minimumReleaseAge: '2 days' }])).minimumReleaseAge, '2 days');
console.log('K3s stable cases passed');
