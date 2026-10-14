/**
 * catalog.mjs — measure what the skill catalog actually costs.
 *
 * DSH renders one catalog entry per model-invocable skill as:
 *
 *     - `<name>`: <normalized-and-capped-description>
 *
 * inside a durable `<available_skills>` message. `catalogDescriptionMaxLength`
 * defaults to 500. This module models exactly that, so the "before" number is the
 * real one rather than a guess.
 *
 * TWO MISTAKES THIS MODULE EXISTS TO AVOID
 * ----------------------------------------
 * 1. Counting the raw description. DSH caps it at 500 chars, so an uncapped count
 *    overstates the cost (measured: 595,650 chars uncapped vs 578,548 capped).
 * 2. Assuming ~3.5-4 chars per token for every corpus. That is roughly right for
 *    English and badly wrong for CJK, where one character is often one token. We
 *    split the string and price the two scripts separately.
 */

/** DSH `catalogDescriptionMaxLength` default. */
export const DEFAULT_DESC_CAP = 500;

const CJK = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uac00-\ud7af]/;

/**
 * Script-aware token estimate.
 * Latin/ASCII text runs ~4 chars/token; CJK runs ~1 token/char.
 * Deliberately conservative (rounds up) so budgets are not exceeded.
 */
export function estimateTokens(s) {
  if (!s) return 0;
  let cjk = 0;
  let other = 0;
  for (const ch of s) (CJK.test(ch) ? (cjk += 1) : (other += 1));
  return Math.ceil(cjk + other / 4);
}

/** `- \`name\`: description` — the exact per-entry shape DSH publishes. */
export function renderEntry(name, description, cap = DEFAULT_DESC_CAP) {
  const d = description.length > cap ? description.slice(0, cap) : description;
  return '- `' + name + '`: ' + d;
}

/**
 * @param {Array<{name:string,description:string}>} skills
 * @returns {{entries:number, chars:number, tokens:number, cappedCount:number, charsUncapped:number, tokensUncapped:number, cjkShare:number}}
 */
export function measureCatalog(skills, cap = DEFAULT_DESC_CAP) {
  let chars = 0;
  let tokens = 0;
  let charsUncapped = 0;
  let cappedCount = 0;
  let cjk = 0;
  let total = 0;

  for (const s of skills) {
    const desc = s.description ?? '';
    if (desc.length > cap) cappedCount += 1;
    const capped = desc.length > cap ? desc.slice(0, cap) : desc;
    const lineUncapped = renderEntry(s.name, desc, Infinity);
    const line = renderEntry(s.name, desc, cap);
    chars += line.length;
    tokens += estimateTokens(line);
    charsUncapped += lineUncapped.length;
    for (const ch of capped) {
      total += 1;
      if (CJK.test(ch)) cjk += 1;
    }
  }
  return {
    entries: skills.length,
    chars,
    tokens,
    cappedCount,
    charsUncapped,
    tokensUncapped: Math.round(charsUncapped / 4),
    cjkShare: total ? cjk / total : 0,
  };
}

/** The router skill's own resident cost (frontmatter + table + a little prose). */
export function measureRouter(routerText) {
  return { chars: routerText.length, tokens: estimateTokens(routerText) };
}
