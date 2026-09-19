# sagea-cursus — Cursus Python SDK

Distribution name is `sagea-cursus` because `cursus` is taken on PyPI by an
unrelated SageMaker tool. The product is still branded "Cursus".

```bash
pip install sagea-cursus
export CURSUS_API_KEY="cursus_..."          # from <server>/<org>/settings/keys
export CURSUS_BASE_URL="https://cursus.example.com"  # omit for localhost:3000
```

Full reference: [`docs/sdk.md`](../docs/sdk.md).
Runnable scripts: [`examples/`](./examples/) (need a live server + key).

## Basic training loop

Credentials come from the environment above, or explicitly per call
(handy for multi-server scripts — never commit real keys to git):

```python
import sagea_cursus as cursus

run = cursus.init(
    project="demo",
    config={"lr": 1e-4, "arch": "mlp"},
    api_key="cursus_...",  # or CURSUS_API_KEY
    base_url="https://cursus.example.com",  # or CURSUS_BASE_URL
)
try:
    for step in range(100):
        loss = 1.0 / (step + 1)
        cursus.log({"train/loss": loss}, step=step)
        if step % 10 == 0:
            cursus.log({"train/loss": loss, "eval/acc": step / 100}, step=step)
    cursus.finish()
except Exception:
    cursus.finish("crashed")
    raise
```

## Images, artifacts, and mid-run config

```python
import sagea_cursus as cursus

run = cursus.init(project="vision", config={"backbone": "resnet50"})
for epoch in range(10):
    train_one_epoch(...)
    cursus.log({"train/loss": 0.4 / (epoch + 1)}, step=epoch)
    cursus.log_image("val/samples", f"preds_epoch{epoch}.png", step=epoch)
    if epoch == 5:
        cursus.config.update({"lr": 1e-5})  # synced back, debounced
cursus.log_artifact("resnet50", "runs/best.pt", type="model", description="best val acc")
cursus.finish()
```

## Group projects and named runs

```python
import sagea_cursus as cursus

# Log inside a group project (you must belong to the group).
run = cursus.init(project="detection", group="vision-team", name="baseline-a", tags=["v2-data"])
print("view at:", run.url)
cursus.log({"map50": 0.61}, step=1)
cursus.finish()
```

## Sweep worker (grid/random)

```python
import sagea_cursus as cursus

sweep = cursus.create_sweep(
    "demo",
    {"lr": {"min": 1e-5, "max": 1e-1, "scale": "log"}, "batch": {"values": [16, 32]}},
    name="lr-search",
)
while (trial := cursus.next_trial(sweep["id"])) is not None:
    run = cursus.init(
        project="demo",
        config=trial["config"],
        name=f"sweep-{trial['trial']}",
        sweep_id=trial["sweep_id"],
    )
    try:
        train(trial["config"])
        cursus.finish()
    except Exception:
        cursus.finish("crashed")
        raise
```

## Reliability contract

`init()` may raise (missing key, version skew). Everything else degrades
to warnings: dead servers cost you points, never a crashed training job.
Always `finish()` in a `finally` — unflushed points and heartbeats die
with the process, and the run stays `RUNNING` until staleness flips it.
