# dsh-skill-router

**Turn the DeepSeek Harness skill catalog from O(all skills) into one ~600-token router.**

DSH publishes every skill's `name` + `description` into `<available_skills>` in **every request**.
That is invisible until you have a real library — then it is fatal:

| skills resident | catalog cost / request |
|---:|---:|
| 50 | ~5,000 tok |
| 1,246 (measured, real library) | **~70,800 tok** |

On a 200K context that is **35% gone before your first message**; on 128K you are over budget before
you start. The catalog is cached, so it is not a *billing* problem — it is a *context* problem.

This tool moves the skills out of the scanned roots, leaves a single `skill-router` skill behind,
and generates per-category index files the model `read`s on demand:

| | resident tokens |
|---|---:|
| before | ~70,800 (measured) |
| after | **~600** |

On-demand cost: one index file, 1–4K tokens, only when the category is needed.

Zero dependencies. Node ≥ 20 (the same floor DSH itself requires). Works on Windows, Linux, macOS.

## Why not just `disable-model-invocation`?

Because it does not do what you want. Per the DSH docs, it removes the skill from model-facing
catalogs **and loaders** — hidden means unloadable. Moving the skill out of the scanned root keeps
it loadable via `read` while removing its catalog cost.

## Install

No install needed — it is a zero-dependency Node script:

```bash
git clone https://github.com/OWNER/dsh-skill-router.git
cd dsh-skill-router
node bin/dsh-skill-router.mjs --help
```

or run straight from anywhere:

```bash
npx github:OWNER/dsh-skill-router --help
```

## Quick start

```bash
# 1. See the truth: every root DSH scans, what the catalog costs,
#    and the skills DSH silently skips (bad frontmatter).
dsh-skill-router scan

# 2. Preview the plan. Writes nothing.
dsh-skill-router plan --source "D:\my-skills" --locale zh

# 3. Apply: link skills into the off-root, write router + indexes.
dsh-skill-router apply --source "D:\my-skills" --locale zh

# 4. Prove every index path resolves.
dsh-skill-router verify

# 5. Undo everything. Source libraries are never touched.
dsh-skill-router restore
```

### Multi-library example (the author's setup)

```bash
dsh-skill-router apply \
  --source "D:\daily\skill_merged\skills" \
  --source "D:\resource\Anthropic-Cybersecurity-Skills\skills" \
  --exclude-file excluded.json \
  --overrides category-map.json \
  --locale zh
```

`--source` is repeatable. Any directory whose immediate children are skill bundles
(`<name>/SKILL.md` or `<name>.md`) works.

## How it works

```
~/.dsh/skills/            ← scanned root. ONLY skill-router lives here.
  └── skill-router/SKILL.md     (~600 tokens: the table below)

~/.dsh/skill-index/       ← NOT scanned by DSH. Ordinary markdown.
  ├── ctf.md                    "- **ctf-crypto** — …\n  `D:\…\ctf-crypto\SKILL.md`"
  ├── malware-analysis.md
  └── skill-manager.md          (meta-skill: how to add/remove/find skills)

~/.dsh/skills-off/        ← the real skills, one junction/symlink per skill,
  ├── ctf-crypto  ──────────→  D:\daily\skill_merged\skills\ctf-crypto
  └── …                            (source libraries stay where they are)
```

The model loads a skill in three hops: read router → read one index → read one SKILL.md.

## The five design decisions (and the evidence behind them)

These were all learned the hard way against real libraries. They are the reason this
tool exists rather than a 20-line PowerShell script.

### 1. Links go into the off-root, never the scanned root

The naive flow — "put real directories in `~/.dsh/skills`, then move them out with
`-DisableSkills`" — **produces dead index paths**. The index records
`<skillsRoot>/<name>/SKILL.md`; the very next step moves that directory away; the
router then advertises skills that do not exist. (Reproduced and reported upstream.)

This tool never moves anything. It creates **junctions (Windows) / symlinks (POSIX)
pointing at your source libraries**, and the indexes record the *target* paths, which
never move. Deleting a link never touches the target. `~/.dsh` can be wiped and
reinstalled without losing a single skill.

### 2. One scan root is never enough

DSH scans **five** roots (rank 100 project-dsh → 500 user-agents). A tool that only
manages `~/.dsh/skills` (rank 400) silently ignores rank 100/200/300/500 — and any
skill still resident there keeps costing tokens. `scan` shows all five, including
`customSkillDirs` parsed from your profile's `cordis.patch.yml`.

### 3. Discovery is one level deep — mirror it exactly

DSH recognises `<root>/<name>/SKILL.md` and `<root>/<name>.md`; nested `**/SKILL.md`
is **deliberately not discovered**. This tool mirrors that exactly, so what it counts
is what DSH counts — no surprises when a nested skill "doesn't show up".

It also handles the two real-world shapes that make a skill **silently invisible** to
DSH (the provider skips the whole skill with only a log warning):

- a UTF-8 **BOM** before the opening `---`
- a `/* ... */` **comment banner** before the frontmatter (14 skills in the author's
  library were dead this way)

`scan` lists every such skill and tells you the two-line fix.

### 4. A classifier is only as good as its budget

The obvious classifier — `subdomain` frontmatter, else name prefix, else `other` —
put **489 of 1,548 skills** into one bucket on a real library, producing a single
~25,100-token index file. The router would then cost as much as the catalog it
replaced.

So classification here is budget-driven, not taxonomy-driven:

- signals, in priority order: `--overrides` map → `metadata.category` → `subdomain`
  → name prefix → `other`
- any bucket over `--max-tokens` (default 4000) is **split** — first by the most
  discriminative token in skill names (max 2 levels), then unconditionally by
  alphabetical binning, which packs by measured tokens and always converges
- buckets that are tiny fold into `other` so the router table stays small
- duplicate bucket names are de-duplicated (`-2`, `-3`…) so two halves of one split
  can never overwrite each other's index file

Measured on the author's library: 60 buckets, **0 over budget**, largest exactly 4000 tokens.

### 5. Token math must be honest

Two mistakes this tool refuses to make:

- **counting raw descriptions.** DSH caps each description at
  `catalogDescriptionMaxLength` (default 500). Uncapped math overstates by ~3%
  (measured 595,650 vs 578,548 chars). We model the cap.
- **assuming ~4 chars/token for everything.** That is fine for English and badly
  wrong for CJK, where one character is often one token. Token estimates here are
  script-aware.

## Commands

| command | what it does | writes? |
|---|---|---|
| `scan` | all five roots, resident catalog cost, silently-skipped skills | no |
| `plan` | categories, index sizes, link actions | no |
| `apply` | create links, write router + indexes + manifest | yes (`--dry-run` supported) |
| `verify` | fail (exit 1) if any index path is dead; flag catalog re-inflation | no |
| `restore` | remove our links and generated files only | source libraries untouched |

Useful flags: `--source` (repeatable) · `--exclude <name|prefix*>` · `--exclude-file <json>`
· `--overrides <json>` · `--max-tokens <n>` · `--locale <zh|en>` · `--profile <name>`
· `--dsh-home <dir>` · `--dry-run` · `--json`

## Rolling it out on another machine

```bash
git clone https://github.com/OWNER/dsh-skill-router.git
cd dsh-skill-router
node bin/dsh-skill-router.mjs scan              # see what you have
node bin/dsh-skill-router.mjs plan --source <your-skill-library> --locale zh
node bin/dsh-skill-router.mjs apply --source <your-skill-library> --locale zh
node bin/dsh-skill-router.mjs verify
# restart DSH to be safe (the watcher usually picks it up live)
```

Rollback: `restore` (or just delete `skills/skill-router`, `skill-index/`, `skills-off/`).

## Compatibility & limitations

- DSH `0.2.x` on Windows/Linux/macOS (frontmatter rules verified against the
  `@deepseek-ai/dsh-skill-filesystem` docs shipped in the app bundle).
- **Depends on the model actually reading the router.** Weak models may ignore the
  instructions; the router text states the rule explicitly, but that is the trade.
- One extra `read` hop versus the native `skill` tool. That is the price of ~70K tokens.
- Plugin-provided skills (e.g. `dsh-plugin-ctf` with `includeDefaultRoots: false`) are
  isolated by design and are not covered.
- Indexes do not auto-update when your source libraries change; re-run `apply`
  (it is idempotent and incremental).

## Methodology

See [docs/METHODOLOGY.md](docs/METHODOLOGY.md) for the full write-up: the failure
modes, the measurements, and the reasoning behind every design decision — written so
you can re-derive the tool (or port it to another harness) from first principles.

## Tests

```bash
npm test        # 24 end-to-end assertions on a throwaway sandbox
```

## License

MIT
