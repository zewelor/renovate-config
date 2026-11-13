import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const root = process.env.RENOVATE_ROOT ?? require.resolve('renovate/package.json').replace(/\/package\.json$/, '');
const { resolveConfigPresets } = await import(pathToFileURL(`${root}/dist/config/presets/index.js`));
const { GlobalConfig } = await import(pathToFileURL(`${root}/dist/config/global.js`));
const { extractPackageFile } = await import(pathToFileURL(`${root}/dist/modules/manager/custom/regex/index.js`));
const { getMatchingFiles } = await import(pathToFileURL(`${root}/dist/workers/repository/extract/file-match.js`));
const { doAutoReplace } = await import(pathToFileURL(`${root}/dist/workers/repository/update/branch/auto-replace.js`));
const { init } = await import(pathToFileURL(`${root}/dist/logger/index.js`));
await init();
const { config: preset } = await resolveConfigPresets(JSON.parse(await readFile(new URL('../presets/annotations.json', import.meta.url))));
const fields = ['datasource', 'depName', 'currentValue', 'versioning', 'extractVersion'];
const metadata = dep => Object.fromEntries(fields.filter(field => dep[field] !== undefined).map(field => [field, dep[field]]));
const extract = (content, file) => (preset.customManagers ?? []).flatMap(manager =>
  getMatchingFiles(manager, [file]).length
    ? (extractPackageFile(content, file, manager)?.deps ?? []).map((dep, depIndex) => ({ dep, depIndex, manager }))
    : []);

const cases = [
  ['Dockerfile', [
    [{ datasource: 'pypi', depName: 'ansible-core', currentValue: '2.21.6' }, 'ARG ANSIBLE_VERSION=2.21.6', '2.21.7'],
    [{ datasource: 'github-releases', depName: 'openai/codex', currentValue: '0.167.0', extractVersion: '^rust-v(?<version>\\d+\\.\\d+\\.\\d+)$' }, 'ARG CODEX_VERSION=0.167.0', '0.168.0'],
    [{ datasource: 'github-releases', depName: 'herdrdev/herdr', currentValue: '0.9.5' }, 'ARG HERDR_VERSION=0.9.5', '0.9.6'],
    [{ datasource: 'custom.k3sStable', depName: 'k3s-io/k3s', currentValue: '1.36.5', versioning: 'semver', extractVersion: '^v(?<version>\\d+\\.\\d+\\.\\d+)\\+k3s\\d+$' }, 'ARG KUBECTL_VERSION=1.36.5', '1.36.6'],
    [{ datasource: 'docker', depName: 'nousresearch/hermes-agent', currentValue: 'v0.22.5' }, 'ARG HERMES_AGENT_VERSION=v0.22.5', 'v0.22.6'],
    [{ datasource: 'github-releases', depName: 'jqlang/jq', currentValue: '1.8.2' }, 'ARG JQ_VERSION=1.8.2', '1.8.3'],
  ]],
  ['versions.yaml', [
    [{ datasource: 'github-tags', depName: 'Oefenweb/ansible-apt', currentValue: 'v3.2.6' }, 'version: v3.2.6', 'v3.2.7'],
    [{ datasource: 'github-releases', depName: 'Sendspin/sendspin-cpp-cli', currentValue: '0.4.0', versioning: 'semver', extractVersion: '^v(?<version>.*)$' }, '_host_audio_sendspin_version: 0.4.0', '0.4.1'],
    [{ datasource: 'custom.k3sStable', depName: 'k3s-io/k3s', currentValue: 'v1.37.2+k3s1', versioning: 'regex:^v(?<major>\\d+)\\.(?<minor>\\d+)\\.(?<patch>\\d+)\\+k3s(?<build>\\d+)$' }, 'k3s_release_version: v1.37.2+k3s1', 'v1.37.3+k3s1'],
    [{ datasource: 'docker', depName: 'adguard/adguardhome', currentValue: 'v0.107.79' }, 'adguardhome_docker_version: "v0.107.79"', 'v0.107.80'],
  ]],
  ['mise.toml', [
    [{ datasource: 'github-releases', depName: 'jdx/mise', currentValue: '2026.11.3' }, 'min_version = "2026.11.3"', '2026.11.4'],
  ]],
  ['.devcontainer/devcontainer.json', [
    [{ datasource: 'github-releases', depName: 'jdx/mise', currentValue: '2026.11.3' }, '"version": "2026.11.3"', '2026.11.4'],
  ]],
];

const localDir = await mkdtemp(join(tmpdir(), 'renovate-annotations-'));
GlobalConfig.set({ localDir });
let replacements = 0;
try {
  for (const [file, expected] of cases) {
    const fixture = await readFile(new URL(`fixtures/annotations/${file}`, import.meta.url), 'utf8');
    // Scalars support CRLF and EOF without a newline; Dockerfile syntax belongs to the upstream preset.
    const variants = file === 'Dockerfile' ? [fixture] : [fixture, fixture.replaceAll('\n', '\r\n'), fixture.trimEnd()];
    for (const content of variants) {
      const extracted = extract(content, file);
      assert.deepEqual(extracted.map(({ dep }) => metadata(dep)), expected.map(([dep]) => dep), file);
      for (const [index, [dep, declaration, newValue]] of expected.entries()) {
        const { manager, dep: actual, depIndex } = extracted[index];
        const packageFile = 'replacement.fixture';
        await writeFile(join(localDir, packageFile), content);
        const result = await doAutoReplace({
          ...manager, ...actual, manager: 'regex', packageFile, depIndex, newValue,
        }, content, false);
        const wanted = content.replace(declaration, declaration.replace(dep.currentValue, newValue));
        assert.equal(result, wanted, `${file}: ${dep.depName} replacement`);
        assert.equal(await readFile(join(localDir, packageFile), 'utf8'), wanted);
        replacements++;
      }
    }
  }
} finally {
  GlobalConfig.reset();
  await rm(localDir, { recursive: true, force: true });
}

for (const content of [
  'version: 1.2.3\n',
  '# renovate: datasource=github-releases\nversion: 1.2.3\n',
  '# renovate: datasource=github-releases depName=example/tool\n\nversion: 1.2.3\n',
  'unrelated: 1 # renovate: datasource=github-releases depName=example/tool\nversion: 1.2.3\n',
  '# renovate: datasource=github-releases depName=example/tool unknown=value\nversion: 1.2.3\n',
]) assert.deepEqual(extract(content, 'versions.yaml'), [], content);
assert.deepEqual(extract('# renovate: datasource=github-releases depName=example/tool\nversion: 1.2.3\n', 'README.md'), []);
console.log(`Annotation cases passed: 12 dependencies, ${replacements} isolated version replacements`);
