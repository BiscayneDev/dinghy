# Jev-owned UI selection and generation

## Flow

With `DINGHY_JEV_UI=on`, the iMessage tool loop calls Shipyard `POST /v1/decisions` with a typed choice question. Jev decides whether a UI is needed, which catalogue capability satisfies the request, or whether a novel capability is needed. No topic keyword chooses the component. Supporting blocks may be composed with the selected capability.

- **text**: continue ordinary work; no UI publication or coding fallback.
- **catalogue**: model supplies the selected existing component's data to `create_file`; server validates that capability is present. No coding worker is offered.
- **generate**: `generate_ui` asks the Shipyard-selected coding model for a new isolated UI specification. Jev owns this handoff; Jev's typed API itself returns decisions, not code. The specification must validate before publication, and `create_file` must contain the exact returned block. Generation is not automatic promotion into the shared catalogue.

The catalogue records actual capability limits. A game sales chart is not satisfied by the media card; a hotel mortgage calculator is not a hotel shortlist. Jev sees those distinctions rather than a keyword blacklist.

## New UI execution boundary

The coding step emits trusted text/number input definitions, readable static fallback, and a pure JavaScript function that returns inert HTML/SVG. Code executes only in a worker in an opaque sandbox frame with no account/network access, a 500ms execution limit, and capped output. Output is stripped to an allowlist of text/table/SVG elements and non-URL attributes. Generated code cannot add scripts, events, links, forms, images, navigation or transactions. Malformed code/specifications are rejected. Runtime errors preserve static content. PDF and saved-page static views contain fallback text, not source code.

This supports novel local calculators and visualizations, not arbitrary web apps, remote APIs, shared persistence or account actions. Controls are local; they do not save to an account or send data. Existing source bindings are resolved before the coding call and retained alongside the final page. The model must not invent factual data.

`create_file` rejects generated Pages content without the in-process Jev/generation authorization. The flag defaults off. Existing Pages comparison/checklist/map validators now recognize valid components independently of rollout.

## Failure and privacy

Unknown, low-confidence, malformed, stub or unavailable decision results do not fall back to keyword selection or secretly invoke the coding step. No UI is published; the turn reports the decision problem. Enforced-private turns keep the existing private catalogue behavior unchanged and skip the public Jev UI decision endpoint, which has no private-provider allowlist. Novel generation is unavailable there. Google data is not sent to a public decision backend under that requirement. If a turn becomes private after selection, novel generation is blocked.

## Rollout checks not covered by mocks

1. Verify deployed Shipyard enables `/v1/decisions` for Dinghy's key, actually uses Jev (not a stub), and returns confident typed choices for synthetic ordinary and near-miss requests. This is metered inference; obtain approval before a paid test.
2. Check budget/usage reporting for decision and coding calls. Their token usage is recorded with the existing usage callback; dollar cost is unknown when no gateway cost header exists.
3. Run a fresh end-to-end synthetic iMessage request for each branch and inspect the hosted generated UI/preview/static PDF, not only a mocked publisher.
4. Enable `DINGHY_JEV_UI=on` only after these checks and an approved rollout. This PR does not change environment variables or deploy the flag.

## Regression coverage

Tests exercise the real tool loop with mocked network responses for an existing component, a new generated UI, and uncertain/stub failure. Parser/runtime tests cover static fallback and isolation. Valid Pages comparison and checklist output is accepted by deliverable validators. Synthetic cases contain no user data and no real inference or sandbox calls.
