# Gap analysis: Cursus vs Weights & Biases

Status: Living doc · Purpose: decide what "full OSS alternative" actually
means before committing to any of it. Honest inventory, then a recommended
build order. Anything marked Out is out until this doc says otherwise.

## 1. Where we stand today

| Area                                             | W&B capability                                               | Cursus status                                                                      |
| ------------------------------------------------ | ------------------------------------------------------------ | ---------------------------------------------------------------------------------- |
| Scalar metrics + config                          | log/history/summary, config update                           | Shipped (config is write-once; mid-run `config.update` from the SDK is local-only) |
| Media logging (images, audio, video, tables, 3D) | First-class logged types with viewers                        | **Missing entirely** — biggest functional gap                                      |
| System metrics (GPU/CPU/mem)                     | Automatic capture                                            | Missing (backlog item)                                                             |
| Charts                                           | Custom panels, grouping, smoothing, log scale                | Partial: fixed per-key charts, overlays, downsampling; no customization            |
| Runs table                                       | Filter/group/sort/column control, bulk ops, notes            | Partial: search, status filter, 4 sort modes, notes, no bulk ops                   |
| Sweeps                                           | Grid/random/Bayesian + agents                                | Missing entirely                                                                   |
| Artifacts/registry                               | Versioned files, aliases, lineage graph, registry linking    | Scoped v1 only: versioned run attachments, no aliases/lineage/registry             |
| Reports/notebooks                                | Report builder, embeddings                                   | Out by design                                                                      |
| Alerts/webhooks                                  | Run-state triggers, Slack                                    | Missing                                                                            |
| SDK breadth                                      | `define_metric`, summary control, multiprocess, service mode | Bare `init/log/finish/artifacts` (+groups)                                         |
| Data out                                         | CSV/JSON export, Public API breadth                          | Per-run CSV/JSON only                                                              |
| Teams                                            | Org/team/viewer roles, SSO/SCIM, service accounts            | Two roles, no SSO, no viewer role                                                  |
| Platform ops                                     | Hosted control plane, audit breadth, retention policies      | Self-host only; audit covers keys; no retention controls                           |
| Traces/LLM (Weave)                               | Tracing, evals                                               | Out by design                                                                      |

## 2. Recommended build order (if we chase parity)

P0 — daily-use correctness gaps (each S–M, independently shippable):

1. **Image logging + viewer** — the single most-used non-scalar type.
   Store like artifacts (bytea, capped); grid viewer on run detail.
   Audio/video/tables stay out until images prove the pattern.
2. **Sweeps, minimal** — grid + random over a declared space with an agent
   loop in the SDK (`cursus.sweep()` + worker), runs linked to a sweep id.
   Bayesian later or never; no W&B Launch equivalent (bring your own runner).
3. **Alerts: run-state webhooks** — crashed/finished events POST to a
   configured URL. No Slack-native integration (webhook covers it via
   intermediaries), no in-app notification center.

P1 — collaboration depth (each S–M): 4. **Viewer (read-only) role** — third role, same two-guard pattern.
Custom roles stay out. 5. **Bulk run ops** — multi-select delete/tag in the runs table (services
already support single ops; add transactional batch endpoints). 6. **SSO (OIDC)** — one provider protocol, session bridge into the
existing cookie model. SCIM stays out.

P2 — platform maturity (each M, only on demand): 7. **Retention controls** — per-project metric TTL + run archival
(status-gated soft delete; storage reclamation job). 8. **Helm chart + backup docs** — only when someone actually deploys past
docker-compose. 9. **Run config update from API** — close the loop the overview docs
already advertise (`config.update` mid-run syncing server-side).

Explicitly not recommended: report builder, Weave-style tracing, Launch
job orchestration, model registry with lineage, billing/metering. Each
would cost more than everything above combined and fights the
one-engineer-maintainable constraint (G5).

## 3. Working agreements for any item above

- Spec first (PRD-style like this repo's `docs/prd-*.md`), build second.
- Visibility and auth rules extend, never fork: new reads go through the
  existing filter helpers or it doesn't ship.
- Bounded queries with named budgets, same as the dashboard PRD (§6).
- No new infra dependencies without retiring an old assumption in writing
  (Postgres-everything is the default until data says otherwise).
