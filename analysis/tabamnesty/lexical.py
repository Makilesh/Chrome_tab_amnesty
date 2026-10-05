"""S7: TF-IDF cosine on our own corpus. Deliberately plain (no sklearn) so the TS port is the
same arithmetic and the parity test can compare edge weights exactly."""
from __future__ import annotations

import math
import unicodedata
from collections import Counter

from .traces import Trace

# A token is a maximal run of letters, combining marks and digits (Unicode categories L*, M*, N*),
# at least two code points long. Marks matter: Devanagari, Tamil, Kannada... spell vowels with
# them, and an ASCII-only tokenizer gave non-English pages no lexical signal at all. The TS side
# uses /[\p{L}\p{M}\p{N}]+/gu and counts code points; `npm run parity` holds the two together.
STOP = frozenset(
    "a an and are as at be by for from has have in is it its of on or that the this to was "
    "were will with you your we our not no but if then than so can how what when where who why "
    "which html http https www com page home index new free best top".split()
)


def _runs(text: str) -> list[str]:
    out: list[str] = []
    cur: list[str] = []
    for ch in text:
        if unicodedata.category(ch)[0] in "LMN":
            cur.append(ch)
        elif cur:
            out.append("".join(cur))
            cur = []
    if cur:
        out.append("".join(cur))
    return out


def _is_number(w: str) -> bool:
    r"""All digits/numerals in any script — the same set as /^\p{N}+$/u on the TS side."""
    return all(unicodedata.category(c)[0] == "N" for c in w)


def tokens(t: Trace) -> list[str]:
    parts = [t.get("title") or ""]
    d = t.get("digest")
    if d:
        parts.append(d.get("description") or "")
        parts.extend(d.get("headings") or [])
        parts.append(d.get("leadText") or "")
    parts.extend(t.get("pathTokens") or [])
    text = " ".join(parts).lower()
    return [w for w in _runs(text) if len(w) >= 2 and w not in STOP and not _is_number(w)]


def tfidf_vectors(traces: list[Trace]) -> dict[str, dict[str, float]]:
    """traceId -> L2-normalised {term: weight}. tf = 1 + ln(count); idf = ln((N+1)/(df+1)) + 1."""
    docs = {t["traceId"]: Counter(tokens(t)) for t in traces}
    n = len(docs)
    df: Counter[str] = Counter()
    for c in docs.values():
        df.update(c.keys())
    out: dict[str, dict[str, float]] = {}
    for tid, c in docs.items():
        vec = {w: (1 + math.log(k)) * (math.log((n + 1) / (df[w] + 1)) + 1) for w, k in c.items()}
        norm = math.sqrt(sum(v * v for v in vec.values()))
        out[tid] = {w: v / norm for w, v in vec.items()} if norm else {}
    return out


def cosine(a: dict[str, float], b: dict[str, float]) -> float:
    if len(a) > len(b):
        a, b = b, a
    return sum(v * b[w] for w, v in a.items() if w in b)
