import json

import numpy as np

from tabamnesty import refit
from tabamnesty.cluster import pair_signals
from tabamnesty.config import FIXTURES, SIGNALS, W_MIN
from tabamnesty.signals import affinity
from tabamnesty.synth import make_adversarial, write_adversarial


def _pairs(kind: str) -> refit.Pairs:
    traces, labels = make_adversarial(kind)
    _, vecs = pair_signals(traces)  # identical to the TS --edges dump (npm run parity)
    rows = [{"a": a, "b": b, **v} for (a, b), v in vecs.items()]
    return refit.pairs_from_rows(kind, rows, labels)


class TestRefit:
    def test_affinity_threshold_is_the_probability_threshold(self):
        p = _pairs("lineage")
        f = refit.fit([p])
        betas = f.betas()
        prob = f.proba(p.x)
        aff = np.array([affinity(dict(zip(SIGNALS, row)), betas) for row in p.x])
        clear = np.abs(prob - 0.5) > 1e-9
        assert ((aff >= W_MIN) == (prob >= 0.5))[clear].all()

    def test_finds_the_one_informative_signal(self):
        # On the multilingual control only page text separates the projects.
        betas = refit.fit([_pairs("multilingual")]).betas()
        assert max(betas, key=betas.get) == "S7_lexical"

    def test_pairs_with_unlabelled_tabs_are_skipped(self):
        rows = [{"a": "x", "b": "y", **dict.fromkeys(SIGNALS, 0.0)}, {"a": "x", "b": "z", **dict.fromkeys(SIGNALS, 0.0)}]
        p = refit.pairs_from_rows("t", rows, {"x": "p", "y": "p"})
        assert p.y.tolist() == [1]

    def test_cli_holds_each_browser_out_and_never_touches_betas_json(self, tmp_path, capsys):
        write_adversarial(FIXTURES)  # same seeded files npm run synth writes (git-ignored)
        shipped = (FIXTURES.parent / "src" / "cluster" / "betas.json").read_text(encoding="utf-8")
        out = tmp_path / "refit.betas.json"
        assert refit.main(["synthetic_lineage", "synthetic_multilingual", "--out", str(out)]) == 0
        printed = capsys.readouterr().out
        assert "leave-one-browser-out" in printed and "SYNTHETIC" in printed
        written = json.loads(out.read_text(encoding="utf-8"))
        assert set(SIGNALS) <= written.keys() and written["_fit"]["fixtures"] == ["synthetic_lineage", "synthetic_multilingual"]
        assert (FIXTURES.parent / "src" / "cluster" / "betas.json").read_text(encoding="utf-8") == shipped
