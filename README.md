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

Phase 2A consumes an exact reviewed set of npm-compatible Virune package artifacts. The first runnable slice uses a two-job GitHub Actions path: a producer checks out one exact reviewed `yaona807/virune` commit, runs the repository-owned `pack:virune` path and candidate-content verification, and transfers only `release/` artifacts to a fresh consumer job. The consumer validates the existing release checksums/manifests and installs the exact six Registry-candidate tarballs without checking out Virune source.

Phase 2B changes only the package source: the same Golden scenarios are installed from exact public `v1.1.0-rc.*` versions on npm. A developer-global Virune installation, mutable local workspace, or npm cache state is never completion evidence.

## Phase sequencing

Phase 2A validates exact reviewed Virune package artifacts before public release. Phase 2B reruns the same scenarios using only an exact public `v1.1.0-rc.*` package set from npm. Phase 2 is complete only after the public-RC replay has no unresolved release-blocking Interop defect and the resulting evidence is linked back to `yaona807/virune#358`.

The concrete frontend, HTTP, typed-DB, identity-sensitive callback, queue/worker, and shared Virune-native domain scenarios are selected in focused implementation work only when their boundaries are concrete. This repository does not pre-create framework support layers or speculative Managed/bundler/worker abstractions.

## p-queue Golden slice

Issue [#17](https://github.com/yaona807/virune-golden-apps/issues/17) is the first Phase 2A Golden Application slice. `Virune Media Jobs` uses `p-queue` as a real in-memory queue/worker dependency and exercises construction, contextual options, retained/repeated native callbacks, Promise completion/rejection, External property/method reads, chaining, and same-handler `on`/`off` identity without a handwritten Interop adapter.

The canonical CI path is Ubuntu 24.04 / Node 24. It pins both the Virune candidate commit and `p-queue` version, commits the npm lockfile, runs `virune check` and `virune build`, then executes the runnable success/identity scenario and the deterministic rejection assertion.

## Repository workflow

After the initial empty-repository commit, changes are made through focused Issues and Pull Requests. See [`CONTRIBUTING.md`](CONTRIBUTING.md). Runnable Golden slices must pin dependencies, commit their lockfile, record the exact Virune candidate identity/source kind, and make clean install/check/build/run-or-test commands reproducible.

CI is added only with a real consumer validation path; a green workflow is evidence only when the corresponding Golden Application actually installs, checks, builds, and runs against the selected consumer package source.

## Current status

Reviewed-candidate Phase 2A.5 validation is converged for the current declared v1.1 External JavaScript / TypeScript Interop scope. Current Golden coverage includes p-queue / identity-sensitive queue work, Hono / HTTP, Drizzle + better-sqlite3 / typed DB, Preact + jsdom / frontend, shared Virune-native domain semantics, real npm declaration-shape probes, a realistic multi-layer reference application, generated mutation/determinism and stale-state stress, high-risk Direct cross-interactions, and runtime-resolution branch consistency. The multi-layer reference composes a concrete named p-queue lifecycle callback through `on`/`off` identity into persisted DB state, queue work, Virune-native domain reconstruction, Hono response, and Preact/jsdom output. Tracking Issue [#1](https://github.com/yaona807/virune-golden-apps/issues/1) remains the canonical source for exact candidate identities, CI runs, defects, and Phase 2 evidence.

The corrected requirements-level closure matched the current `yaona807/virune#427` adversarial matrix, current shipped specification boundaries, and REC-336 mutation/determinism requirements to concrete evidence with `missing = 0` and `unclassified = 0`; the earlier multi-layer composition and mutation/determinism gaps are closed. This convergence claim does not mean every npm package is supported or that SSR, Worker, stream, bundler, Optional Managed, or future Interop surfaces are guaranteed. Phase 2B remains mandatory: [`yaona807/virune#518`](https://github.com/yaona807/virune/issues/518) must first establish authenticated npm package ownership / Trusted Publisher state, after which the same Golden suite must be replayed using only exact public `v1.1.0-rc.*` packages before stable readiness is judged.
