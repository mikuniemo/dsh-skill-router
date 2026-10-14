# Changelog

## 1.0.0 — 2026-10-14

Initial release.

- `scan` — enumerate all five DSH skill roots, measure the resident catalog
  (modeling the 500-char description cap and CJK token pricing), and list skills
  DSH silently skips (BOM / comment banner / missing `name`).
- `plan` — budget-driven classification preview: override map → `metadata.category`
  → `subdomain` → name prefix → `other`; oversized buckets split (discriminative
  token, max 2 balanced levels, then alphabetical binning that always converges);
  tiny buckets folded into `other`; duplicate bucket names de-duplicated.
- `apply` — idempotent junction (Windows) / symlink (POSIX) mounting into the
  off-root, router + per-category index + skill-manager + manifest generation.
  Never moves source files; index paths record link targets.
- `verify` — exit 1 on any dead index path; flags re-inflation of the scanned root.
- `restore` — removes only links and files this tool created (marker-checked);
  source libraries are never touched.
- 24-assertion end-to-end sandbox test (`npm test`).
- Methodology write-up: docs/METHODOLOGY.md (porting checklist for other harnesses).
