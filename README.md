# Shared Renovate presets

Independently selectable presets for repositories that adopt this policy:

- `github-actions` enables automerge for dependencies extracted by the
  `github-actions` manager as `action`, including major updates. It does not
  configure how merging is performed or required CI checks.
- `go` groups the extracted Go module directive, toolchain, Go build images,
  setup-go and mise declarations named `go`, `golang` or
  `docker.io/library/golang`; bumps the `go` directive in `go.mod`; and enables
  `gomodTidy`. This raises a module's minimum supported Go version when the
  directive is updated. Grouping combines available compatible updates; it
  does not make all declarations update at the same time.
- `ruby-version` replaces the built-in `.ruby-version` manager with the R3x
  regex manager for a root-level file containing a numeric `major.minor.patch`
  version. It looks up `docker.io/library/ruby` using Docker versioning. Check
  whether availability of that image is an appropriate signal: DHI or custom
  Ruby images for the same version may not yet be available. Keep any project
  synchronization workflow and tag exceptions locally. If `enabledManagers`
  is restricted, include `custom.regex`.
- `k3s-stable` defines the `custom.k3sStable` datasource from the K3s stable
  channel and disables minimum release age for it because the channel does not
  provide release timestamps. Consumers define their own managers, version
  parsing, schedules and automerge rules. Availability in this channel does not
  by itself verify compatibility with a project's deployment.
- `annotations` reads version metadata from comments immediately above
  Dockerfile `ARG`/`ENV` declarations and YAML, TOML or JSON scalars. It extends
  Renovate's `customManagers:dockerfileVersions` for Dockerfiles and adds the
  scalar matcher described below. Keep datasource definitions, schedules and
  automerge rules in separate presets or local configuration. If
  `enabledManagers` is restricted, include `custom.regex`.
- `ruby-images` pins digests for `dhi.io/ruby` and `ghcr.io/zewelor/ruby`
  and enables automerge for `digest` and `patch` updates. It does not enable
  automerge for the initial `pinDigest`, minor or major updates; inherited and
  local rules still apply. Automerge uses `branch` as the shared default, so Ruby
  image updates follow the same process across projects. Override it locally
  when a repository has a specific reason to use another method. Keep schedules
  and other project exceptions local. Verify CI for both build and runtime
  images, including separate updates.

## Using the presets

Select only the applicable presets and keep one repository configuration
entry point. By default, follow the preset repository's default branch:

```json
{
  "extends": [
    "config:recommended",
    "github>zewelor/renovate-config//presets/github-actions",
    "github>zewelor/renovate-config//presets/go",
    "github>zewelor/renovate-config//presets/annotations",
    "github>zewelor/renovate-config//presets/k3s-stable",
    "github>zewelor/renovate-config//presets/ruby-version",
    "github>zewelor/renovate-config//presets/ruby-images"
  ]
}
```

Unpinned references follow the default branch, so preset changes affect
consumers on subsequent Renovate runs without a preset-version PR in each
consumer. Review and validate changes before merging them into that branch.
When a project needs a specific version, append `#<tag>` using a verified
published tag. Keep release tags immutable and update pinned consumers through
reviewed Renovate PRs or a deliberate edit. Verify that each consumer resolves
its chosen reference successfully.

The former root-level references `github>zewelor/renovate-config:github-actions`
and `github>zewelor/renovate-config:go` must be changed to the `//presets/`
paths above when consuming the reorganized default branch. References pinned
to an earlier tag continue to use the files from that tag.

Presets in `extends` are resolved in order; local settings apply afterwards.
`packageRules` are mergeable: matching later rules override scalar properties
from earlier rules, while mergeable options have their own merge semantics. A
local rule can therefore override automerge for a specific action. Compare the
resolved configuration and effective rules, including any other inherited
presets and local rules. Preserve project-specific schedules, release ages,
automerge policies, pinning and exceptions. Verify repository protections,
required checks and branch/PR CI triggers before enabling automerge; enabling a
rule alone does not ensure checks exist or ran. Projects that previously
allowed non-action workflow dependencies to automerge need an explicit local
policy for them if that behavior is to remain.

Use `ubuntu-latest` in workflows unless a specific requirement justifies a
runner exception. CI for Go projects should run `go mod tidy -diff` for each
module. Neither workflow runner nor CI checks are configured by these presets.
Do not add version declarations solely to make a group.

## Version annotations

Keep dependency identity and version parsing beside the version:

```dockerfile
# renovate: datasource=github-releases depName=openai/codex extractVersion=^rust-v(?<version>\d+\.\d+\.\d+)$
ARG CODEX_VERSION=0.167.0
```

```yaml
# renovate: datasource=docker depName=adguard/adguardhome
adguardhome_docker_version: "v0.107.79"
```

The scalar matcher scans `*.yml`, `*.yaml`, `*.toml`, `*.json`, `*.json5` and
`*.jsonc`. Put a `# renovate:` or `// renovate:` comment on its own line,
immediately above the assignment. The required fields are `datasource` and
`depName`, followed optionally by `versioning` and `extractVersion`, in that
order. Field values cannot contain whitespace. Keys use letters, digits and
underscores, optionally quoted; values are unquoted or single/double quoted
and cannot contain whitespace. JSON comments require a format that permits
them, such as JSONC devcontainer files. Inline annotations are not supported.
For Dockerfiles, use `<NAME>_VERSION` variables and the
[upstream preset's syntax](https://docs.renovatebot.com/presets-customManagers/#custommanagersdockerfileversions).

Use `extractVersion` with a named `version` capture when a release tag needs
normalization. The stored value must already use the normalized form.
`custom.k3sStable` annotations also need the separate `k3s-stable` preset.
Remove the local annotation managers when adopting `annotations` so they do
not extract the same declarations twice. Keep managers with a different
contract, such as Grafana dashboards or an unannotated Alpine version, local.

## Validation

GitHub Actions runs the same checks on pushes and pull requests. To run them
locally with a Node version supported by the Renovate dependency:

```sh
npm ci
npm test
```

The validator checks the presets but does not resolve
remote references. Run a Renovate extraction dry-run and inspect the resolved
configuration and logs to verify an `extends` reference; a successful validator
exit alone is insufficient. The policy tests exercise Renovate's
package-rule engine for actions, non-actions, Go declarations, Ruby images and
local exceptions, plus Ruby version extraction. These tests use a pinned
Renovate version and its internal rule engine; update the tests when changing
that version. The K3s test also exercises the channel response transformation.
The annotation tests resolve the inherited Dockerfile preset and exercise
file matching, extraction metadata and isolated version replacements through
Renovate's replacement engine, including CRLF, quoted scalars and unchanged
unrelated values. Their fixtures cover the Ansible, Docker Images and Home
Assistant OpenWrt annotation formats.
These focused tests use
representative dependency metadata rather than running a full bot update.
Validation is not proof of hosted bot behavior. In each consumer also validate resolved `extends`,
extract actual dependencies, compare effective policies, exercise version
replacements and verify CI and required checks. Record hosted bot evidence
separately. Review Garmin Daily’s existing broad manager-level automerge and
its required checks before migrating that policy.

## Migration scope

Track implementation and per-repository evidence in [MCA-103](https://linear.app/mcagents/issue/MCA-103).
Pilot Healthchecks Go and Garmin Daily first. Then migrate Feedway, Arrtify,
CrumbCLI, Pastesync and Sourcetap. Examine Linkding, Marketwatch, Bird Go,
Pingo Doce and Pushovergate as candidates; decide on bot activation separately,
including Pushovergate's Go version constraint. For the Actions preset also
review GitOps, Ansible, Docker Images, dot2dot, R3X, HA EEM PT, Dottales and
PS Events. Existing correct local copies must also be replaced with the shared
source. Preserve explicit exceptions, such as GitOps reusable workflows,
Feedway's manager allowlist and PostgreSQL version cap, and Garmin's PostgreSQL
schedule. Record each repository's config path, ref, exceptions, CI and bot
status, and avoid enabling Renovate without the operator's decision.
