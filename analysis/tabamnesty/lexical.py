"""S7: TF-IDF cosine on our own corpus. Deliberately plain (no sklearn) so the TS port is the
same arithmetic and the parity test can compare edge weights exactly."""
from __future__ import annotations

import math
import re
import unicodedata
from collections import Counter
from urllib.parse import unquote

from .traces import Trace

# Scripts written without spaces between words. A run of these is indexed as overlapping
# character bigrams; any other run of letters/marks/numbers is one token. Code-point ranges,
# not a script property, so TS (lexical.ts) can use the very same table.
UNSEGMENTED = (
    (0x0E00, 0x0EFF),    # Thai, Lao
    (0x1000, 0x109F),    # Myanmar
    (0x1780, 0x17FF),    # Khmer
    (0x19E0, 0x19FF),    # Khmer symbols
    (0x3005, 0x3007),    # 々 〆 〇
    (0x3040, 0x30FF),    # Hiragana, Katakana
    (0x31F0, 0x31FF),    # Katakana phonetic extensions
    (0x3400, 0x4DBF),    # CJK extension A
    (0x4E00, 0x9FFF),    # CJK unified ideographs
    (0xF900, 0xFAFF),    # CJK compatibility ideographs
    (0xFF66, 0xFF9F),    # half-width katakana
    (0x20000, 0x323AF),  # CJK extensions B-H
)
_BAD_ESCAPE = re.compile(r"%(?![0-9A-Fa-f]{2})")
STOP = frozenset(
    "a an and are as at be by for from has have in is it its of on or that the this to was "
    "were will with you your we our not no but if then than so can how what when where who why "
    "which html http https www com page home index new free best top".split()
)


def _is_word(ch: str) -> bool:
    return unicodedata.category(ch)[0] in "LMN"


def _is_unsegmented(ch: str) -> bool:
    cp = ord(ch)
    return any(lo <= cp <= hi for lo, hi in UNSEGMENTED)


def _is_number(w: str) -> bool:
    return all(unicodedata.category(ch)[0] == "N" for ch in w)


def decode_segment(s: str) -> str:
    """Percent-decode a path token the way JS decodeURIComponent does: a malformed escape or
    invalid UTF-8 leaves the token as it was (JS throws; lexical.ts catches and keeps it)."""
    if "%" not in s or _BAD_ESCAPE.search(s):
        return s
    try:
        return unquote(s, errors="strict")
    except UnicodeDecodeError:
        return s


def split_words(text: str) -> list[str]:
    """Maximal runs of Unicode letters, marks and numbers, >= 2 code points. Runs in a script
    written without spaces (UNSEGMENTED) become overlapping character bigrams instead."""
    out: list[str] = []
    run: list[str] = []
    run_unseg = False

    def flush() -> None:
        if run_unseg:
            out.extend(run[i] + run[i + 1] for i in range(len(run) - 1))
        elif len(run) >= 2:
            out.append("".join(run))
        run.clear()

    for ch in text:
        if not _is_word(ch):
            flush()
            continue
        u = _is_unsegmented(ch)
        if run and u != run_unseg:
            flush()
        run_unseg = u
        run.append(ch)
    flush()
    return out


def tokens(t: Trace) -> list[str]:
    parts = [t.get("title") or ""]
    d = t.get("digest")
    if d:
        parts.append(d.get("description") or "")
        parts.extend(d.get("headings") or [])
        parts.append(d.get("leadText") or "")
    parts.extend(decode_segment(p) for p in t.get("pathTokens") or [])
    text = unicodedata.normalize("NFKC", " ".join(parts)).lower()
    return [w for w in split_words(text) if w not in STOP and not _is_number(w)]


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
