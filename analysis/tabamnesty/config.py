"""Shared data files. Betas and the ambient-host list live in src/cluster/ so TS and Python
read the very same bytes; there is no Python-side copy to drift."""
from __future__ import annotations

import json
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
CLUSTER_DIR = REPO / "src" / "cluster"
FIXTURES = REPO / "fixtures"

SIGNALS = ("S1_lineage", "S2_temporal", "S8_coactive", "S3_session", "S6_path_query",
           "S4_strip", "S7_lexical", "S5_domain", "N1_cross_window")


def _load(name: str) -> dict:
    with open(CLUSTER_DIR / name, encoding="utf-8") as f:
        return json.load(f)


def load_betas(path: Path | None = None) -> dict[str, float]:
    raw = json.loads(Path(path).read_text(encoding="utf-8")) if path else _load("betas.json")
    betas = {k: float(v) for k, v in raw.items() if not k.startswith("_")}
    missing = set(SIGNALS) - betas.keys()
    if missing:
        raise ValueError(f"betas.json missing {sorted(missing)}")
    return betas


def load_ambient() -> dict[str, set[str]]:
    raw = _load("ambient.json")
    return {k: set(v) for k, v in raw.items() if not k.startswith("_")}


# Tunables the brief fixes or leaves open. Same values as src/cluster/params (TS).
GAP_MS = 25 * 60_000            # segment(): cut on a gap longer than this
TEMPORAL_TAU_MS = 8 * 60_000    # S2: exp(-dt / 8 min)
STRIP_TAU = 4.0                 # S4: exp(-|dIndex| / 4)
W_MIN = 1.0                     # prune edges below this affinity
TARGET_LO, TARGET_HI = 3, 9     # partition_to_target community-count range
MAX_COMMUNITY = 15              # split communities larger than this
RESOLUTION_ITERS = 8
