# Telemetry → Azure Monitor workbook

`aks-desktop-usage.workbook.json` is a gallery-template workbook for the
`customEvents` stream emitted by `plugins/aks-desktop/src/telemetry`.

## Installing it

1. Azure Portal → **Monitor** → **Workbooks** → **New**.
2. Open the **Advanced Editor** (`</>` in the toolbar), select **Gallery Template**.
3. Paste the contents of `aks-desktop-usage.workbook.json`, **Apply**, then **Save**.
4. Pick your Application Insights resource in the **Application Insights** parameter.

No resource IDs or subscription IDs are baked into the file — the resource is chosen
at runtime through a resource-picker parameter, so the same template works against
any environment.

## Two client shapes

The single most important thing to understand before reading any tile: **deployed
clients do not all emit the current schema.** Two shapes are live simultaneously.

| | Legacy (pre-envelope) | Current (envelope) |
| --- | --- | --- |
| Event `name` | the feature itself, e.g. `headlamp.list-view` | one of five envelopes |
| `customDimensions` | empty | populated per `TELEMETRY_PROPERTY_KEYS` |
| `user_Id` | SDK-generated, **rotates** | stable `installId` UUID |
| `operation_Name` | raw `file://` install path | sanitized route, or `unknown` |
| Geo columns | populated | scrubbed (`ai.location.ip` = `0.0.0.0`) |

The five envelope names are `headlamp.session-start`, `headlamp.feature`,
`headlamp.exception`, `headlamp.cluster-shape`, `headlamp.plugins-loaded`
(`telemetry/schema.ts`).

### The discriminator

Every tile that distinguishes clients uses this, and only this:

```kusto
let envelopes = dynamic(['headlamp.session-start','headlamp.feature','headlamp.exception','headlamp.cluster-shape','headlamp.plugins-loaded']);
customEvents
| extend build = case(
    name !in (envelopes), 'legacy',
    array_length(bag_keys(customDimensions)) == 0, 'legacy',
    'current')
```

A legacy client puts the feature in the event *name*, so it falls outside the
envelope set. The one name that both shapes emit — `headlamp.plugins-loaded` —
is separated by the second clause, because the legacy build sends it with an
empty dimensions bag.

**Do not** discriminate on `isnotempty(customDimensions.appVersion)`. Current
source stamps `appVersion` onto every envelope in `send()`
(`telemetry/index.ts:249`), but the *deployed* build only attaches it to
`headlamp.session-start`. That test misfiles every current-build feature event
as legacy, and it fails silently.

For the same reason, tiles that need a per-event app version resolve it by
joining back to the session's `session-start` row:

```kusto
let sv = customEvents
| where name == 'headlamp.session-start'
| summarize SessionAppVersion = max(tostring(customDimensions.appVersion)) by session_Id;
```

The `coalesce` reads the per-event dimension first and the session join second,
so these tiles keep working unchanged once the newer stamping code ships.

## Normalized fields

Tiles that span both shapes derive:

```kusto
| extend
    feature = iff(name == 'headlamp.feature', tostring(customDimensions.feature),
              iff(name in (envelopes), '', name)),
    status = coalesce(tostring(customDimensions.status), 'unknown'),
    resourceKind = coalesce(tostring(customDimensions.resourceKind), '')
```

Legacy events therefore contribute a `feature` but never a `status` — the funnel
tiles are effectively current-build-only regardless of the client filter.

## Caveats behind the tiles

Each of these is repeated inline in the workbook next to the tile it affects.

**Error counts are censored.** `trackError` drops everything past **5 events per
`area:errorClass` per session** (`telemetry/index.ts:56`). Raw counts flatten out
exactly when things are worst. Every reliability tile is built on *sessions
affected*, never on event counts; the `Events (capped)` column is labelled as a
floor.

**Cluster shape is all-or-nothing.** `trackClusterShape` emits nothing unless all
five of k8s version, node count, namespace count, region and tier are non-null,
and it dedupes to once per cluster per process (`telemetry/index.ts:312`). Zero
rows is ambiguous — nobody opened an AKS cluster, or one ARM field came back
null. Read the **Cluster-shape coverage** tile before the distributions under it.

**View features fire on render.** `headlamp.list-view`, `headlamp.details-view`
and `headlamp.object-events` re-fire on re-render — a dozen within one second for
a single navigation is normal. Rank features by *Sessions*, never by *Events*.

**`aksd.deploy` has no cancel path.** It emits `opened` from `DeployButton` and
`started`/`succeeded`/`failed` from the wizard, so abandonment shows only as an
`opened` with no terminal status. Its start rate reads lower than the other flows
for reasons that are not a UX problem.

**`aksd.project-import` can partially succeed.** It reports `completed` when some
namespaces imported and others failed (`ImportAKSProjects.tsx:383`). The workbook
folds it into the success rate but breaks it out as a **Partial** column — a
rising Partial is a real regression a plain success rate hides.

**`plugin-ui` errors are unclassified by construction.**
`TelemetryErrorBoundary` hard-codes `UnknownError` / `failed`
(`TelemetryErrorBoundary.tsx:41`). A spike there means "read the boundary", not a
diagnosis. Likewise `deploy` only ever reports `ValidationError` or
`UnknownError` — the absence of `NetworkError` is not evidence of a healthy
network.

**Values are clamped client-side and cannot be recovered.** Non-builtin kinds
collapse to `CustomResource` and heterogeneous bulk actions to `Multiple`
(`schema.ts:182`); routes outside the allowlist — including every Kubernetes
resource route — become `unknown` (`schema.ts:206`); unrecognized regions become
`Other` (`schema.ts:192`); node and namespace counts are sent only as buckets.
A large `unknown` route bucket is expected, not a bug.

**Installs and legacy clients are never summed.** `user_Id` is the stable install
UUID only on the current build; on legacy it is SDK-generated and rotates, so the
legacy column is an upper-bound device estimate.

## Keeping it in sync

If you add an event name or property key to `telemetry/schema.ts`, the workbook
will silently return nothing for it rather than error. The pairs to check are
`TELEMETRY_EVENT_NAMES` against the `envelopes` list above, and
`TELEMETRY_PROPERTY_KEYS` against the `customDimensions.*` references in the
workbook JSON.
