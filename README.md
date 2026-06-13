# PAH_NMA_LivingMeta

PAH Combination Therapy: Living Network Meta-Analysis.

A single-file, offline RapidMeta dashboard (`PAH_NMA_REVIEW.html`) for a living
meta-analysis of pulmonary arterial hypertension (PAH) therapies. It pools
hazard ratios for clinical worsening on the log scale across four randomized
placebo-controlled trials (STELLAR, GRIPHON, SERAPHIN, PATENT-1; 2,352
patients) and provides supporting network meta-analysis, heterogeneity, and
risk-of-bias panels.

- `PAH_NMA_REVIEW.html` — the dashboard (open directly in a browser).
- `index.html` — redirect to the dashboard.
- `assets/` — vendored engine modules, styles, and Plotly (offline).
- `E156-PROTOCOL.md` — protocol, estimand, data sources, and the E156 body.

## Test

```
python -m pytest -q
```

`test_smoke.py` checks the shipped dashboard's structural invariants (no BOM,
balanced `<script>` tags, no unfilled placeholders, expected engine globals).
