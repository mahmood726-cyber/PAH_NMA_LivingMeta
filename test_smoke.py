"""Minimal smoke test for the PAH_NMA_LivingMeta single-file dashboard.

This repo ships a large single-file HTML RapidMeta dashboard (no build step, no
JS module exports), so the smoke test validates the load-bearing structural
invariants of the shipped assets rather than re-running the in-browser engine:

  * the dashboard file exists and is non-trivial
  * no UTF-8 BOM (would break offline file:// loading on some browsers)
  * <script> open/close tags are balanced
  * no unfilled placeholder tokens shipped
  * the expected engine globals are present

Run:  python -m pytest -q   (or)   python test_smoke.py
"""
import os
import re

ROOT = os.path.dirname(os.path.abspath(__file__))
HTML = os.path.join(ROOT, "PAH_NMA_REVIEW.html")


def _read():
    with open(HTML, "rb") as fh:
        raw = fh.read()
    assert not raw.startswith(b"\xef\xbb\xbf"), "shipped HTML must not carry a UTF-8 BOM"
    return raw.decode("utf-8")


def test_dashboard_exists_and_substantial():
    assert os.path.exists(HTML), "PAH_NMA_REVIEW.html is missing"
    assert os.path.getsize(HTML) > 100_000, "dashboard unexpectedly small"


def test_script_tags_balanced():
    text = _read()
    opens = len(re.findall(r"<script\b", text))
    closes = len(re.findall(r"</script>", text))
    assert opens == closes, f"unbalanced <script> tags: {opens} open vs {closes} close"


def test_no_unfilled_placeholders():
    text = _read()
    # tokens assembled at runtime so this guard file does not itself contain the
    # literal sentinel strings it checks for
    tokens = ("REPLACE" + "_ME", "__PLACE" + "HOLDER__")
    for token in tokens:
        assert token not in text, f"unfilled placeholder token shipped: {token}"
    assert not re.search(r"\{\{[A-Za-z0-9_]+\}\}", text), "unfilled {{...}} template token shipped"


def test_engine_globals_present():
    text = _read()
    assert "RapidMeta" in text, "RapidMeta engine global missing from dashboard"
    assert "AnalysisEngine" in text, "AnalysisEngine global missing from dashboard"


if __name__ == "__main__":
    for name, fn in sorted(globals().items()):
        if name.startswith("test_") and callable(fn):
            fn()
            print(f"PASS {name}")
    print("all smoke checks passed")
