# Virune Golden Applications

Consumer-level validation repository for Virune External JavaScript / TypeScript Interop Phase 2.

This repository intentionally lives outside [`yaona807/virune`](https://github.com/yaona807/virune). It validates Virune as an ordinary consumer would use it and must not depend on Virune workspace source, private compiler modules, test fixtures, or test-only hooks.

## Canonical tracking

- Phase 2 Tracking: [#1](https://github.com/yaona807/virune-golden-apps/issues/1)
- Bootstrap implementation: [#2](https://github.com/yaona807/virune-golden-apps/issues/2)
- Phase 1 completion: [`yaona807/virune#326`](https://github.com/yaona807/virune/issues/326)
- Canonical Interop architecture: [`yaona807/virune#427`](https://github.com/yaona807/virune/issues/427)
- v1.1.0 npm / RC / stable readiness: [`yaona807/virune#358`](https://github.com/yaona807/virune/issues/358)

## Validation boundary

Golden Applications use only consumer-visible Virune surfaces: reviewed npm-compatible package artifacts during Phase 2A and exact public npm RC packages during Phase 2B, together with the ordinary CLI, generated output, and documented public APIs.

A Golden Application must not be made to pass through relative imports into the Virune repository, private `packages/*/src` imports, workspace-only dependencies, test hooks, framework-name compiler logic, or routine handwritten JavaScript / TypeScript adapters that bypass the generic Interop path.

If a real consumer scenario exposes a correctness, safety, compatibility, determinism/reproducibility, or ordinary-consumer usability defect in Virune, reduce it to a focused reproduction and fix it in `yaona807/virune` under the current repository contribution rules. The original Golden scenario must then pass again against the updated candidate.

## Candidate contract

Phase 2A consumes an exact reviewed set of npm-compatible Virune package artifacts. The concrete transport for those artifacts is deliberately not fixed during repository bootstrap: it will be chosen with the first runnable Golden slice, when the candidate producer and clean-consumer command are concrete. The transport must not create a second publication authority or require reading Virune repository internals.

Phase 2B changes only the package source: the same Golden scenarios are installed from exact public `v1.1.0-rc.*` versions on npm. A developer-global Virune installation, mutable local workspace, or npm cache state is never completion evidence.

## Phase sequencing

Phase 2A validates exact reviewed Virune package artifacts before public release. Phase 2B reruns the same scenarios using only an exact public `v1.1.0-rc.*` package set from npm. Phase 2 is complete only after the public-RC replay has no unresolved release-blocking Interop defect and the resulting evidence is linked back to `yaona807/virune#358`.

The concrete frontend, HTTP, typed-DB, identity-sensitive callback, queue/worker, and shared Virune-native domain scenarios are selected in focused implementation work only when their boundaries are concrete. This repository does not pre-create framework support layers or speculative Managed/bundler/worker abstractions.

## Repository workflow

After the initial empty-repository commit, changes are made through focused Issues and Pull Requests. See [`CONTRIBUTING.md`](CONTRIBUTING.md). Runnable Golden slices must pin dependencies, commit their lockfile, record the exact Virune candidate identity/source kind, and make clean install/check/build/run-or-test commands reproducible.

CI is added when there is a real consumer validation path to execute. The bootstrap does not add a no-op green workflow because that would create false evidence without testing a Golden Application.

## Current status

Repository bootstrap is in progress under #2. Application implementations have not started yet.
