/**
 * classify.mjs — partition skills into categories that each fit a token budget.
 *
 * THE PROBLEM THIS SOLVES
 * -----------------------
 * The obvious classifier is "use the `subdomain` frontmatter field, else the name
 * prefix, else `other`". On a real 1,548-skill library that put 489 skills into
 * `other`, producing a single ~25,100-token index file — the router then costs as
 * much as the catalog it was supposed to replace. A classifier is only useful if
 * every output bucket is small enough to load.
 *
 * So this module does two things:
 *   1. assign a category from the best signal available (override > metadata.category
 *      > subdomain > name prefix > `other`);
 *   2. ENFORCE A BUDGET — split anything oversized, and fold away anything tiny.
 *
 * Splitting is informed first (by the most discriminative token in the skill names)
 * and falls back to alphabetical ranges. Both are clearly labelled in the generated
 * index so the model can still navigate.
 */
import { estimateTokens, DEFAULT_DESC_CAP } from './catalog.mjs';

const STOP = new Set([
  'and','or','the','a','an','of','to','in','on','for','with','from','by','using','use',
  'when','how','what','this','that','into','via','at','as','is','are','be','not','do',
  'skill','skills','guide','using','based','your','you','it','its','all','any','new',
]);

/** Name-prefix families that are worth keeping even without a subdomain field. */
const PREFIX_FAMILIES = ['ctf', 'strix', 'office', 'univer', 'dsh', 'aws', 'gcp', 'azure'];

export function normalizeKey(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[\s\u3000]+/g, '-')
    .replace(/[^\p{L}\p{N}-]+/gu, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-|-$/g, '');
}

function tokens(s) {
  return normalizeKey(s)
    .split('-')
    .filter((t) => t.length >= 3 && !STOP.has(t) && !/^\d+$/.test(t));
}

/**
 * Assign a primary category to every skill.
 * @param {Array} skills
 * @param {Record<string,string>} overrides slug -> category
 */
export function assignCategories(skills, overrides = {}) {
  const lowered = new Map(Object.entries(overrides).map(([k, v]) => [k.toLowerCase(), v]));
  for (const s of skills) {
    const slug = s.dirName || s.name;
    const o = lowered.get(String(slug).toLowerCase()) ?? lowered.get(String(s.name).toLowerCase());
    if (o) {
      s.category = o;
      s.categorySource = 'override';
      continue;
    }
    if (s.metadata?.category) {
      s.category = normalizeKey(s.metadata.category);
      s.categorySource = 'metadata.category';
      continue;
    }
    if (s.subdomain) {
      s.category = normalizeKey(s.subdomain);
      s.categorySource = 'subdomain';
      continue;
    }
    const first = normalizeKey(s.name).split('-')[0];
    if (PREFIX_FAMILIES.includes(first)) {
      s.category = first;
      s.categorySource = 'name-prefix';
      continue;
    }
    s.category = 'other';
    s.categorySource = 'fallback';
  }
  return skills;
}

/** Cost of one index entry line inside a generated index file. */
export function indexEntryTokens(s, descCap = DEFAULT_DESC_CAP) {
  const d = (s.description || '').slice(0, descCap);
  // "- **name** — desc\n  `path`\n"
  const line = `- **${s.name}** — ${d}\n  \`${s.skillFile}\`\n`;
  return estimateTokens(line);
}

/** Pick the token that best splits a set of skills into balanced halves. */
function bestSplitToken(items) {
  const df = new Map();
  for (const s of items) {
    const seen = new Set([...tokens(s.name), ...tokens(s.description || '').slice(0, 8)]);
    for (const t of seen) df.set(t, (df.get(t) || 0) + 1);
  }
  const n = items.length;
  let best = null;
  let bestScore = -Infinity;
  for (const [t, c] of df) {
    if (c < 2 || c > n - 2) continue; // must actually split
    const balance = 1 - Math.abs(c - (n - c)) / n;   // prefer even halves
    const specificity = 1 / Math.log2(c + 2);        // prefer less generic tokens
    const score = balance + specificity;
    if (score > bestScore) {
      bestScore = score;
      best = t;
    }
  }
  return best;
}

function alphabeticalBuckets(items, maxTokens) {
  const sorted = [...items].sort((a, b) => a.name.localeCompare(b.name));
  const buckets = [];
  const per = Math.max(1, Math.ceil(maxTokens / Math.max(1, Math.max(...items.map((s) => indexEntryTokens(s))))) );
  // size buckets by both entry count and, ultimately, measured tokens
  let cur = [];
  let curTok = 0;
  for (const s of sorted) {
    const t = indexEntryTokens(s);
    if (cur.length && curTok + t > maxTokens) {
      buckets.push(cur);
      cur = [];
      curTok = 0;
    }
    cur.push(s);
    curTok += t;
  }
  if (cur.length) buckets.push(cur);
  return buckets.map((b, i) => ({
    name: `${b[0].name[0].toLowerCase()}${i === 0 ? '' : '+'}`,
    items: b,
  }));
}

function labelForBucket(items) {
  const first = items[0].name.replace(/[^A-Za-z0-9]/g, '') || '?';
  const last = items[items.length - 1].name.replace(/[^A-Za-z0-9]/g, '') || '?';
  const a = first[0]?.toUpperCase() ?? '?';
  const b = last[0]?.toUpperCase() ?? '?';
  return `${a}–${b}`;
}

/**
 * Split an oversized bucket until each part fits.
 * Informed split first (by discriminative name token), alphabetical fallback.
 */
export function splitBucket(category, items, maxTokens, depth = 0) {
  const total = items.reduce((a, s) => a + indexEntryTokens(s), 0);
  if (total <= maxTokens || items.length <= 2) {
    return [{ category, items, total, label: null, splitBy: null }];
  }

  // Informed (token) splitting is allowed for the first two levels only, and only
  // when it actually balances. Measured on a real 1,548-skill library, unlimited
  // informed splitting produced `--not-x--not-y--...` chains twenty segments long
  // that still failed the budget: a weak token peels off a few skills and leaves
  // the rest nearly untouched. Alphabetical binning, by contrast, packs entries by
  // measured tokens and therefore ALWAYS converges in one pass.
  if (depth < 2) {
    const token = bestSplitToken(items);
    if (token) {
      const has = (s) => new Set([...tokens(s.name), ...tokens(s.description || '')]).has(token);
      const a = items.filter(has);
      const b = items.filter((s) => !has(s));
      const balanced = a.length >= 2 && b.length >= 2 && Math.min(a.length, b.length) >= items.length * 0.2;
      if (balanced) {
        return [
          ...splitBucket(`${category}--${token}`, a, maxTokens, depth + 1),
          ...splitBucket(`${category}--misc`, b, maxTokens, depth + 1),
        ].map((r) => (r.label ? r : { ...r, label: r.category.split('--').slice(1).join(' ') || null, splitBy: 'token' }));
      }
    }
  }

  // Converges unconditionally: bins are packed to the budget.
  const buckets = alphabeticalBuckets(items, maxTokens);
  return buckets.map((b, i) => {
    const cat = buckets.length > 1 ? `${category}--${i + 1}` : category;
    return { category: cat, items: b.items, total: b.items.reduce((a, s) => a + indexEntryTokens(s), 0), label: labelForBucket(b.items), splitBy: 'alphabetical' };
  });
}

/**
 * Build the final bucket list.
 * @param {Array} skills
 * @param {{maxTokens?:number, minTokens?:number, overrides?:Record<string,string>, descCap?:number}} opts
 */
export function buildBuckets(skills, opts = {}) {
  const maxTokens = opts.maxTokens ?? 4000;
  const minTokens = opts.minTokens ?? 120;

  assignCategories(skills, opts.overrides ?? {});

  const byCat = new Map();
  for (const s of skills) {
    if (!byCat.has(s.category)) byCat.set(s.category, []);
    byCat.get(s.category).push(s);
  }

  let buckets = [];
  for (const [cat, items] of byCat) {
    buckets.push(...splitBucket(cat, items, maxTokens));
  }

  // Merge undersized buckets into `other`, but never merge away an explicit override
  // category and never let `other` itself exceed the budget.
  const tiny = buckets.filter((b) => b.total < minTokens && b.category !== 'other' && b.items.length < 3);
  if (tiny.length) {
    const keep = buckets.filter((b) => !tiny.includes(b));
    const moved = tiny.flatMap((b) => b.items).map((s) => ({ ...s, category: 'other' }));
    const otherItems = [...(byCat.get('other') ?? []), ...moved];
    const rest = keep.filter((b) => b.category !== 'other');
    buckets = [...rest, ...splitBucket('other', otherItems, maxTokens)];
  }

  // De-duplicate category names: two halves of one split can produce identical
  // labels (e.g. two "other--security--3" from independent alphabetical splits),
  // and both would write to the same index file, silently losing one bucket.
  const used = new Map();
  buckets = buckets.map((b) => {
    if (!used.has(b.category)) { used.set(b.category, 1); return b; }
    let n = used.get(b.category) + 1;
    used.set(b.category, n);
    return { ...b, category: `${b.category}-${n}` };
  });

  buckets.sort((a, b) => b.items.length - a.items.length || a.category.localeCompare(b.category));
  return buckets;
}
