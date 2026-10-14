/**
 * roots.mjs — discover every directory DSH actually scans for skills.
 *
 * WHY THIS EXISTS
 * ---------------
 * Most tools in this space hardcode `~/.dsh/skills`. DSH scans FIVE roots, in this
 * priority order (`@deepseek-ai/dsh-skill-filesystem`):
 *
 *   rank 100  project-dsh     <projectRoot>/.dsh/skills
 *   rank 200  project-agents  <projectRoot>/.agents/skills
 *   rank 300  custom          Config.customSkillDirs
 *   rank 400  user-dsh        <dshHome>/skills        (skips its `.system` child)
 *   rank 500  user-agents     <agentsHome>/skills
 *
 * where `<projectRoot>` is the nearest ancestor containing `.git` (falling back to
 * cwd) and `dshHome` is `$DSH_HOME` or `~/.dsh`.
 *
 * Skills that live in a root you did not touch keep costing catalog tokens, so a
 * tool that only manages rank 400 silently under-delivers. This module enumerates
 * all of them.
 *
 * DISCOVERY IS ONE LEVEL DEEP. The provider recognises exactly:
 *     <root>/<name>/SKILL.md        (directory bundle)
 *     <root>/<name>.md              (flat file)
 * and deliberately ignores nested `**\/SKILL.md`. We mirror that exactly, so what
 * this tool counts is what DSH counts.
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

/** Walk up from `start` looking for the nearest `.git`, like DSH does. */
export function findProjectRoot(start = process.cwd()) {
  let dir = path.resolve(start);
  for (;;) {
    if (fs.existsSync(path.join(dir, '.git'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return path.resolve(start);
    dir = parent;
  }
}

/**
 * Best-effort extraction of `customSkillDirs` from a DSH profile patch file.
 * Deliberately dependency-free: we only need a list of strings, so we scan for the
 * key and read the sibling `- item` lines rather than pulling in a YAML parser.
 * Returns [] when the key is absent, and records a warning when it looks present
 * but unparseable, so callers can surface that instead of silently under-reporting.
 */
export function readCustomSkillDirs(profileDir, warnings = []) {
  const patch = path.join(profileDir, 'cordis.patch.yml');
  if (!fs.existsSync(patch)) return [];
  let text;
  try {
    text = fs.readFileSync(patch, 'utf8');
  } catch {
    return [];
  }
  const lines = text.split(/\r?\n/);
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const m = /^(\s*)customSkillDirs\s*:\s*(.*)$/.exec(lines[i]);
    if (!m) continue;
    const indent = m[1].length;
    const inline = m[2].trim();
    if (inline.startsWith('[')) {
      for (const part of inline.replace(/^\[|\]$/g, '').split(',')) {
        const v = part.trim().replace(/^['"]|['"]$/g, '');
        if (v) out.push(v);
      }
      continue;
    }
    for (let j = i + 1; j < lines.length; j++) {
      const raw = lines[j];
      if (!raw.trim()) continue;
      const ind = raw.match(/^\s*/)[0].length;
      if (ind <= indent) break;
      const item = /^\s*-\s*(.+?)\s*$/.exec(raw);
      if (item) {
        const v = item[1].replace(/\s+#.*$/, '').trim().replace(/^['"]|['"]$/g, '');
        if (v) out.push(v);
      }
    }
  }
  if (!out.length && /customSkillDirs/.test(text)) {
    warnings.push(
      `customSkillDirs appears in ${patch} but no entries could be parsed; ` +
        `if you configured it, pass the paths via --extra-root.`
    );
  }
  return out;
}

/**
 * @returns {Array<{rank:number,source:string,dir:string,exists:boolean,skipSystem:boolean}>}
 */
export function discoverRoots(opts = {}) {
  const warnings = [];
  const cwd = opts.cwd ?? process.cwd();
  const projectRoot = opts.projectRoot ?? findProjectRoot(cwd);
  const dshHome = opts.dshHome ?? process.env.DSH_HOME ?? path.join(os.homedir(), '.dsh');
  const agentsHome = opts.agentsHome ?? process.env.DSH_AGENTS_HOME ?? path.join(os.homedir(), '.agents');
  const profileDir = opts.profileDir ?? path.join(dshHome, 'profiles', opts.profile ?? 'desktop');

  const roots = [
    { rank: 100, source: 'project-dsh', dir: path.join(projectRoot, '.dsh', 'skills') },
    { rank: 200, source: 'project-agents', dir: path.join(projectRoot, '.agents', 'skills') },
    // rank 300 is filled from profile config below
    { rank: 400, source: 'user-dsh', dir: path.join(dshHome, 'skills'), skipSystem: true },
    { rank: 500, source: 'user-agents', dir: path.join(agentsHome, 'skills') },
  ];

  for (const d of readCustomSkillDirs(profileDir, warnings)) {
    roots.push({ rank: 300, source: 'custom', dir: path.resolve(d.replace(/^~(?=$|[\\/])/, os.homedir())) });
  }
  for (const extra of opts.extraRoots ?? []) {
    roots.push({ rank: 300, source: 'custom', dir: path.resolve(String(extra)) });
  }

  roots.sort((a, b) => a.rank - b.rank);
  for (const r of roots) {
    r.exists = fs.existsSync(r.dir);
    r.skipSystem = !!r.skipSystem;
  }
  roots.warnings = warnings;
  return roots;
}

/**
 * Enumerate the skills in one root, honouring DSH's one-level rule exactly.
 *
 * @param {{dir:string, skipSystem?:boolean}} root
 * @param {Set<string>} [seenNames] de-duplication set (lower-cased skill name);
 *        DSH surfaces the first root that defines a name, so later duplicates are
 *        shadowed and must not be counted twice.
 * @returns {Array<{name:string, skillFile:string, kind:'dir'|'file', root:string, shadowed:boolean, reason?:string}>}
 */
export function listSkills(root, seenNames = new Set()) {
  const found = [];
  if (!root.exists) return found;

  let entries;
  try {
    entries = fs.readdirSync(root.dir, { withFileTypes: true });
  } catch {
    return found;
  }

  for (const e of entries) {
    // DSH skips the `.system` child of the user root.
    if (root.skipSystem && e.name === '.system') continue;

    let skillFile = null;
    let kind = null;

    if (e.isDirectory() || e.isSymbolicLink()) {
      const p = path.join(root.dir, e.name, 'SKILL.md');
      if (fs.existsSync(p)) {
        skillFile = p;
        kind = 'dir';
      }
    }
    if (!skillFile && e.isFile()) {
      // flat-file form: <name>.md at the TOP LEVEL of a scanned root
      if (e.name.toLowerCase().endsWith('.md') && e.name.toLowerCase() !== 'skill.md') {
        skillFile = path.join(root.dir, e.name);
        kind = 'file';
      }
    }
    if (!skillFile) continue;

    const skill = parseSkillName(skillFile, e.name.replace(/\.md$/i, ''));
    const key = (skill.name || e.name).toLowerCase();
    const shadowed = seenNames.has(key);
    if (!shadowed) seenNames.add(key);

    found.push({
      name: skill.name || e.name,
      dirName: e.name.replace(/\.md$/i, ''),
      skillFile,
      kind,
      root: root.dir,
      rootSource: root.source,
      rootRank: root.rank,
      shadowed,
      valid: skill.valid,
      reason: skill.reason,
    });
  }
  return found;
}

/**
 * Minimal frontmatter reader.
 *
 * DSH requires valid `name` and `description`, and SKIPS the whole skill (with only
 * a log warning) when either is missing or malformed. Two real-world shapes defeat a
 * naive `^---` match and are handled here because they silently cost you skills:
 *   1. a UTF-8 BOM before the opening `---`
 *   2. a `/* ... *\/` comment banner before the frontmatter
 */
export function parseSkillName(file, fallbackName) {
  let raw;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch {
    return { name: fallbackName, valid: false, reason: 'unreadable' };
  }
  // strip BOM
  if (raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1);
  // tolerate a leading comment banner (block or line comments) before the frontmatter
  const stripped = raw.replace(/^(?:\s*(?:\/\*[\s\S]*?\*\/|\/\/[^\n]*\n|<!--[\s\S]*?-->))+\s*/, '');
  const m = /^---\s*\r?\n([\s\S]*?)\r?\n---/.exec(stripped);
  if (!m) return { name: fallbackName, valid: false, reason: 'no-frontmatter' };

  const block = m[1];
  const nameM = /^\s*name\s*:\s*(.+?)\s*$/m.exec(block);
  const name = nameM ? nameM[1].replace(/^['"]|['"]$/g, '').trim() : '';
  if (!name) return { name: fallbackName, valid: false, reason: 'no-name-key' };

  const descM = /^\s*description\s*:\s*([\s\S]*?)(?=\r?\n[A-Za-z0-9_-]+\s*:|\s*$)/m.exec(block);
  const desc = descM ? descM[1].replace(/\s+/g, ' ').trim().replace(/^['"]|['"]$/g, '') : '';
  if (!desc) return { name, valid: false, reason: 'no-description' };

  return { name, valid: true, reason: null, description: desc, block };
}
