# Dashboard engine upgrade (2026-06-04)

This dashboard was upgraded to the current **RapidMeta** engine (`rapidmeta-kit`) via a verbatim data-layer **transplant** — every curated trial, evidence card, snippet, and RoB rating from the prior version is preserved, while the statistics engine (REML, HKSJ, Egger, GRADE, PRISMA, WebR, Plotly NMA) was refreshed.

Validated against the RapidMeta quality gates: JS-parse, data-integrity (zero hard corruption), zero base-template token leftover, headless render smoke. Stale plotly SRI hash fixed so network plots render.

- Topic config: `configs/pah_nma.json`
- Source dashboard preserved as: `PAH_NMA_REVIEW.html`
