# Agent-edit evaluation

Run `npm run build` then `ASEPRITE_PATH=/path/to/aseprite npm run benchmark:agent -- /tmp/agent-report.json`.

The reference runner exercises whole-layer fingerprinting, exact sparse patches, preview/commit parity, protected regions and stale-state rejection. It records actual calls and latency. This is a deterministic safety regression, not evidence that any model has improved. Existing gallery prompts remain the artistic-quality baseline.

For model comparisons, use each fixture's prompt and starting artwork with the same model settings, tool budget and commit. Record model/version, commit SHA, calls, input/output tokens, wall time, constraint failures, collateral pixels, interventions and blinded craft ratings. Retain raw tool transcripts. Evaluate both a strong and a smaller model; do not compare token counts across different task sets. Deliberate squash/stretch must be evaluated against explicit pose tolerances rather than generic area-stability rules.

Proposed release gates: zero accepted protected-region violations, zero silent disconnected-live disk edits, exact supported preview parity, all deterministic stale tests rejected. Targets of 95% constrained-edit success and 20% fewer calls require measured matched model runs; they are not current claims.
