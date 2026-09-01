# Contributing to Virune Golden Applications

This repository validates Virune as an external consumer. The canonical Interop architecture and Virune implementation rules remain in [`yaona807/virune`](https://github.com/yaona807/virune).

## Before implementation

Use [Tracking Issue #1](https://github.com/yaona807/virune-golden-apps/issues/1) for Phase 2 completion state. Create a focused implementation Issue only when the concrete consumer scenario and its failure modes are known. Do not pre-create future framework slices while their boundaries are still likely to change.

Each implementation change should have one logical purpose and start from current `main`. Use a Pull Request for repository changes after the initial empty-repository commit.

## Consumer-only invariant

Golden validation must use only consumer-visible Virune package artifacts, CLI behavior, generated output, and documented public APIs. Do not depend on a neighboring Virune checkout, relative workspace paths, private `packages/*/src` imports, test fixtures, or test-only hooks.

Do not add framework/package-name compiler behavior or weaken Virune safety/specification/ABI requirements to make a scenario pass. If handwritten JavaScript or TypeScript is required, distinguish ordinary host/tool configuration from an adapter that bypasses Interop; the latter must be justified against `yaona807/virune#427`.

## Validation

Pin third-party dependencies and commit the lockfile for runnable Golden scenarios. Record the exact Virune candidate identity and source kind used by the validation.

For each runnable slice, keep local and CI validation aligned: clean install, Virune check/build, and the consumer-visible run/test command should exercise the same path. Include relevant failure behavior where a meaningful failure mode exists; a happy-path-only result is not sufficient evidence when the targeted Interop property includes throw, rejection, identity, or contract failure.

If a Golden scenario finds a Virune defect, reduce it to the smallest faithful consumer reproduction and fix it upstream under the current `yaona807/virune` contribution rules. Re-run the original Golden scenario after the upstream fix is available in a new exact candidate.

## Review

Review changes adversarially for private-source leakage, package-specific special cases, hidden adapters, stale candidate evidence, unrelated scope, false-green validation, and speculative infrastructure. Stop adding improvements after a complete current-diff review reaches zero actionable findings.
