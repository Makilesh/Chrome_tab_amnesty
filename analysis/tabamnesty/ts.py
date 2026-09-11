"""Run the SHIPPED clusterer (tools/cluster-cli.ts) from Python.

The gate is measured on partitions the extension's own code produced. Python clustering in this
package is a research bench and is opt-in (`--python`) for experiments only."""
from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

from .config import REPO


def run_cluster_cli(name: str, out: Path, edges: Path | None = None, betas: Path | None = None,
                    ablate_dir: Path | None = None) -> dict:
    cmd = ["npx", "tsx", "tools/cluster-cli.ts", name, "--out", str(out)]
    if edges:
        cmd += ["--edges", str(edges)]
    if betas:
        cmd += ["--betas", str(betas)]
    if ablate_dir:
        cmd += ["--ablate", str(ablate_dir)]
    r = subprocess.run(cmd, cwd=REPO, capture_output=True, text=True, shell=sys.platform == "win32")
    if r.returncode != 0:
        print(r.stdout, r.stderr, file=sys.stderr)
        raise SystemExit(f"TS cluster CLI failed for {name} (is `npm install` done?)")
    return json.loads(out.read_text(encoding="utf-8"))


def groups_of(partition: dict) -> list[list[str]]:
    return [c["traceIds"] for c in partition["communities"]]
