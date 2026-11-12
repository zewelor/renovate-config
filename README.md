# Shared Renovate presets

Two independently selectable presets for repositories that adopt this policy:

- `github-actions` enables automerge for dependencies extracted by the
  `github-actions` manager as `action`, including major updates. It does not
  configure how merging is performed or required CI checks.
- `go` groups the extracted Go module directive, toolchain, Go build images,
  setup-go and mise declarations named `go`, `golang` or
  `docker.io/library/golang`; bumps the `go` directive in `go.mod`; and enables
  `gomodTidy`. This raises a module's minimum supported Go version when the
  directive is updated. Grouping combines available compatible updates; it
  does not make all declarations update at the same time.

## Using the presets

Select only the applicable presets, pin both to the same published tag, and
keep one repository configuration entry point. For example:

```json
{
  "extends": [
    "config:recommended",
    "github>zewelor/renovate-config:github-actions#v1.0.0",
    "github>zewelor/renovate-config:go#v1.0.0"
  ]
}
```

Use a published tag and verify that the consumer resolves it successfully.
Release a new immutable version tag for each reviewed preset change; never move
an existing tag; update consumers through reviewed Renovate PRs or a deliberate edit.
Unpinned references follow the default branch and change all consumers at once.

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

## Validation

With a supported Node version (Renovate 44.222.6 requires Node 24.11+ in the
24.x line or 26.13+ in the 26.x line):

```sh
npm ci
npm test
```

The validator checks both presets and example schemas but does not resolve
remote references. Run a Renovate extraction dry-run and inspect the resolved
configuration and logs to verify an `extends` reference; a successful validator
exit alone is insufficient. The policy tests exercise Renovate's
package-rule engine for actions, non-actions, Go declarations and a local
exception. These tests use a pinned Renovate version and its internal rule
engine; update the tests when changing that version. Validation is not proof
of hosted bot behavior. In each consumer also validate resolved `extends`,
extract actual dependencies, compare effective policies, exercise version
replacements and verify CI and required checks. Record hosted bot evidence
separately. The pilot examples in `examples/` are starting points, not evidence
of installation or activation. The Garmin example deliberately preserves its
existing broad manager-level automerge as a local exception; review that
policy and its required checks before adopting it.

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
