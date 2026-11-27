# Shared Renovate presets

Reusable, independently selectable Renovate policies for consistent dependency
updates across repositories. Keep shared policy here and project-specific
exceptions in the consuming repository.

## Presets

| Preset | Purpose |
| --- | --- |
| [github-actions](presets/github-actions.json) | Automerge GitHub Actions updates. |
| [go](presets/go.json) | Coordinate Go toolchain updates and keep modules tidy. |
| [ruby-images](presets/ruby-images.json) | Coordinate Ruby version and image updates. |
| [ruby-version](presets/ruby-version.json) | Track Ruby versions in `.ruby-version` against Docker image releases. |
| [nginx-stable](presets/nginx-stable.json) | Follow the NGINX Stable release line. |
| [postgresql-18](presets/postgresql-18.json) | Keep PostgreSQL on major version 18. |
| [k3s-stable](presets/k3s-stable.json) | Track the K3s stable channel. |
| [annotations](presets/annotations.json) | Discover versions in annotated configuration files. |

The preset files are the source of truth for matching, grouping, and automerge
behavior.

## Usage

Extend only the presets relevant to your project:

```json
{
  "extends": [
    "config:recommended",
    "github>zewelor/renovate-config//presets/github-actions",
    "github>zewelor/renovate-config//presets/go"
  ]
}
```

Unpinned references follow the default branch. Append `#<tag>` to use an
immutable release. Local rules can override inherited policy.

For versions not discovered by a native manager, the `annotations` preset
supports declarations such as:

```yaml
# renovate: datasource=docker depName=adguard/adguardhome
adguardhome_docker_version: "v0.107.79"
```

For Dockerfiles, use the [upstream annotation syntax](https://docs.renovatebot.com/presets-customManagers/#custommanagersdockerfileversions).

## Operational considerations

- Grouping does not guarantee simultaneous releases across registries.
- Updating the Go directive can raise the minimum supported Go version.
- Prefer native Docker image declarations; use custom version managers only
  when needed. Avoid duplicate extraction and verify image availability when
  coordinating Ruby versions across registries.
- Keep CI requirements, registry credentials, schedules and deployment-specific
  constraints local. Verify required checks before relying on automerge.
- This repository tracks changes to the NGINX Stable line automatically.
  Verify that the required image variants are published before merging a new line.

## Validation

```sh
npm ci
npm test
```

CI validates configuration and tests representative Renovate behavior. Before
adopting or changing a preset, verify the resolved configuration, dependency
extraction and actual updates in the consuming repository. Passing local tests
does not establish hosted Renovate behavior.
