"""What the scorer is allowed to grade: only tabs someone actually labelled, and in the comparison
with Chrome, only tabs Chrome's organiser was free to place (review of 17 Oct)."""
import json

from tabamnesty.cli import comparison_universe
from tabamnesty.traces import count_unlabelled, load_labels


def test_not_labelled_yet_is_left_out_not_scored_as_no_project(tmp_path):
    p = tmp_path / "x.labels.json"
    p.write_text(json.dumps({"_how": "notes", "a": "deploy", "b": None, "c": ""}), encoding="utf-8")
    labels = load_labels(p)
    assert labels == {"a": "deploy", "b": None}  # null = no project (scored); "" = not labelled (left out)
    assert count_unlabelled(p) == 1


def test_tabs_in_the_persons_own_groups_leave_the_comparison_with_chrome():
    labels = {"a": "x", "b": "x", "c": "y", "d": None}
    assert comparison_universe(labels, None) == ["a", "b", "c", "d"]
    assert comparison_universe(labels, {"groups": [], "ungrouped": ["a", "b"], "preexisting": ["c", "d"]}) == ["a", "b"]


def test_ambient_matches_what_the_collector_records():
    """The Python mirror of the TS ambient tests (cluster.test.ts): hosts as url.ts records them."""
    from tabamnesty.config import load_ambient
    from tabamnesty.signals import is_ambient

    amb = load_ambient()

    def t(host, etld1, *path):
        return {"host": host, "eTLD1": etld1, "pathTokens": list(path)}

    for yes in [t("myteam.slack.com", "myteam.slack.com"), t("teams.microsoft.com", "microsoft.com"),
                t("calendar.google.com", "google.com"), t("outlook.live.com", "live.com"),
                t("web.whatsapp.com", "whatsapp.com"), t("startpage.com", "startpage.com", "sp", "search"),
                t("google.com", "google.com", "search")]:
        assert is_ambient(yes, amb), yes
    for no in [t("google.com", "google.com", "maps", "place"), t("google.com", "google.com", "searchconsole"),
               t("bing.com", "bing.com", "maps"), t("github.com", "github.com", "acme")]:
        assert not is_ambient(no, amb), no
