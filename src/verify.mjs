/**
 * verify.mjs — post-apply health check.
 *
 * Two failure modes this catches:
 *   1. DEAD INDEX PATHS — an index that records `<skillsRoot>/<name>/SKILL.md`
 *      while the skill has been moved elsewhere. The router then advertises
 *      nothing, and the agent concludes the machine has no skills.
 *   2. CATALOG RE-INFLATION — someone dropped a real skill directory back into
 *      the scanned root. Every such directory costs tokens in EVERY request.
 */
import fs from 'node:fs';
import path from 'node:path';
import { ROUTER_NAME } from './generate.mjs';

const PATH_LINE = /^\s+`([^`]+)`\s*$/;

export function verifyIndexes({ indexDir, skillsRoot, offDir }) {
  const out = { indexFiles: 0, checked: 0, dead: [], extraneous: [], manifest: false };

  // 1) every backticked absolute path inside every index file must resolve
  if (fs.existsSync(indexDir)) {
    for (const f of fs.readdirSync(indexDir)) {
      if (!f.endsWith('.md')) continue;
      const full = path.join(indexDir, f);
      let text;
      try { text = fs.readFileSync(full, 'utf8'); } catch { continue; }
      out.indexFiles++;
      for (const line of text.split(/\r?\n/)) {
        const m = PATH_LINE.exec(line);
        if (!m) continue;
        const p = m[1];
        // only absolute paths that look like skill files (SKILL.md or <name>.md)
        if (!path.isAbsolute(p)) continue;
        if (!(/[/\\]SKILL\.md$/i.test(p) || /\.md$/i.test(p))) continue;
        out.checked++;
        if (!fs.existsSync(p)) out.dead.push({ index: f, path: p });
      }
    }
  }

  // 2) the scanned root must contain only the router
  if (fs.existsSync(skillsRoot)) {
    for (const e of fs.readdirSync(skillsRoot, { withFileTypes: true })) {
      if (e.name === ROUTER_NAME) continue;
      out.extraneous.push(`${e.name}${e.isSymbolicLink() ? ' (link)' : e.isDirectory() ? ' (dir)' : ''}`);
    }
  }

  out.manifest = fs.existsSync(path.join(indexDir, '.dsh-skill-router.manifest.json'));
  return out;
}
