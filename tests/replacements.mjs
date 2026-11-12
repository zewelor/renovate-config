import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const root = process.env.RENOVATE_ROOT ?? require.resolve('renovate/package.json').replace(/\/package\.json$/, '');
const moduleAt = (path) => import(pathToFileURL(`${root}/dist/${path}.js`));
const { GlobalConfig } = await moduleAt('config/global');
const { doAutoReplace } = await moduleAt('workers/repository/update/branch/auto-replace');
const temporary = await mkdtemp(join(tmpdir(), 'renovate-preset-test-'));
GlobalConfig.set({ localDir: temporary });

try {
  const cases = [
    ['dockerfile', 'Dockerfile', 'FROM golang:1.25.0 AS build\nFROM postgres:17\n', 'FROM golang:1.26.0 AS build\nFROM postgres:17\n'],
    ['dockerfile', 'Dockerfile', 'FROM docker.io/library/golang:1.25.0-alpine AS build\nFROM postgres:17\n', 'FROM docker.io/library/golang:1.26.0-alpine AS build\nFROM postgres:17\n'],
    ['github-actions', '.github/workflows/ci.yml', "name: ci\non: push\njobs:\n  test:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/setup-go@v5\n        with:\n          go-version: '1.25.0'\n", "name: ci\non: push\njobs:\n  test:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/setup-go@v5\n        with:\n          go-version: '1.26.0'\n"],
    ['mise', 'mise.toml', '[tools]\ngo = "1.25.0"\nnode = "24"\n', '[tools]\ngo = "1.26.0"\nnode = "24"\n'],
  ];
  for (const [manager, file, before, expected] of cases) {
    const extractor = await moduleAt(`modules/manager/${manager}/index`);
    const extracted = await extractor.extractPackageFile(before, file, {});
    const depIndex = extracted.deps.findIndex((dep) => dep.currentValue?.startsWith('1.25.0'));
    assert.notEqual(depIndex, -1, `${manager} extracts the Go version`);
    const dep = extracted.deps[depIndex];
    const updated = await doAutoReplace({ ...dep, manager, packageFile: file, depIndex, newValue: dep.currentValue.replace('1.25.0', '1.26.0') }, before, false);
    assert.equal(updated, expected, `${manager} replaces only the Go declaration`);
  }
  const workflow = `name: ci\non: push\njobs:\n  test:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@${'a'.repeat(40)} # v4.2.2\n`;
  const actions = await moduleAt('modules/manager/github-actions/index');
  const extracted = await actions.extractPackageFile(workflow, '.github/workflows/ci.yml', {});
  const depIndex = extracted.deps.findIndex((dep) => dep.depName === 'actions/checkout');
  const action = extracted.deps[depIndex];
  assert.equal(action.depType, 'action');
  assert.equal(action.currentDigest, 'a'.repeat(40));
  const updated = await doAutoReplace({ ...action, manager: 'github-actions', packageFile: '.github/workflows/ci.yml', depIndex, newValue: 'v4.2.3', newDigest: 'b'.repeat(40) }, workflow, false);
  assert.equal(updated, workflow.replace('a'.repeat(40), 'b'.repeat(40)).replace('v4.2.2', 'v4.2.3'));
  console.log('Dockerfile, CI, mise and SHA-pinned action replacements passed');
} finally {
  GlobalConfig.reset();
  await rm(temporary, { recursive: true, force: true });
}
