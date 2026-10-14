/**
 * smoke.mjs — end-to-end test against a throwaway sandbox.
 * Run: node test/smoke.mjs
 * No network, no admin rights, no user directories touched.
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const CLI = path.join(ROOT, 'bin', 'dsh-skill-luyou.mjs');

let pass = 0; let fail = 0;
function ok(cond, label) {
  if (cond) { pass++; console.log(`  ok    ${label}`); }
  else { fail++; console.error(`  FAIL  ${label}`); }
}

// ── sandbox ─────────────────────────────────────────────────────────────
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-router-test-'));
const home = path.join(tmp, 'dsh');
const libA = path.join(tmp, 'libA');   // proper skills
const libB = path.join(tmp, 'libB');   // broken / tricky skills
for (const d of [path.join(home, 'skills'), path.join(home, 'skills-off'), path.join(home, 'skill-index'), libA, libB]) {
  fs.mkdirSync(d, { recursive: true });
}

function mkSkill(lib, dirName, { name, desc, banner = '', bom = false, extra = '' }) {
  const dir = path.join(lib, dirName);
  fs.mkdirSync(dir, { recursive: true });
  let fm = `---\nname: ${name}\ndescription: ${desc}\n${extra}---\n\n# ${name}\nbody\n`;
  if (banner) fm = banner + fm;
  let buf = Buffer.from(fm, 'utf8');
  if (bom) buf = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), buf]);
  fs.writeFileSync(path.join(dir, 'SKILL.md'), buf);
}

// A: nine well-formed skills across categories
mkSkill(libA, 'ctf-crypto', { name: 'ctf-crypto', desc: 'CTF cryptography techniques: RSA, AES, lattices' });
mkSkill(libA, 'ctf-pwn', { name: 'ctf-pwn', desc: 'CTF binary exploitation: ROP, heap, shellcode' });
mkSkill(libA, 'ctf-reverse', { name: 'ctf-reverse', desc: 'CTF reverse engineering: disassembly, anti-analysis' });
mkSkill(libA, 'malware-volatility', { name: 'malware-volatility', desc: 'Memory forensics for malware with volatility' });
mkSkill(libA, 'malware-yara', { name: 'malware-yara', desc: 'YARA rule authoring for malware detection' });
mkSkill(libA, 'web-sqli', { name: 'web-sqli', desc: 'SQL injection playbook for web applications' });
mkSkill(libA, 'web-xss', { name: 'web-xss', desc: 'Cross-site scripting playbook for web apps' });
mkSkill(libA, 'api-authz', { name: 'api-authz', desc: 'API authorization testing: IDOR, BOLA, scopes' });
mkSkill(libA, 'misc-tools', { name: 'misc-tools', desc: 'Assorted helper utilities', extra: 'subdomain: toolbox\n' });

// B: the three real-world breakage shapes this tool was built to survive
mkSkill(libB, 'bom-skill', { name: 'bom-skill', desc: 'a UTF-8 BOM precedes the frontmatter', bom: true });
mkSkill(libB, 'banner-skill', { name: 'banner-skill', desc: 'a comment banner precedes the frontmatter', banner: '/*===== banner =====*/\n\n' });
mkSkill(libB, 'noname-skill', { name: 'noname-skill', desc: 'frontmatter without a name key', extra: '', name: '' });
// write the noname one manually (mkSkill would render "name: ")
fs.writeFileSync(path.join(libB, 'noname-skill', 'SKILL.md'),
  '---\ndescription: frontmatter without a name key\n---\n\nbody\n');
// a nested skill that DSH would NOT discover (one-level rule) — must be ignored
fs.mkdirSync(path.join(libB, 'nested-parent', 'child'), { recursive: true });
fs.writeFileSync(path.join(libB, 'nested-parent', 'child', 'SKILL.md'), '---\nname: nested\ndescription: should be ignored\n---\n');

const overridesFile = path.join(tmp, 'overrides.json');
fs.writeFileSync(overridesFile, JSON.stringify({ 'misc-tools': 'toolbox' }));

const args = [
  '--dsh-home', home, '--project-root', tmp,
  '--source', libA, '--source', libB,
  '--overrides', overridesFile, '--locale', 'en',
];
const run = (cmd, extra = []) => execFileSync(process.execPath, [CLI, cmd, ...args, ...extra], { encoding: 'utf8' });

// ── scan ────────────────────────────────────────────────────────────────
console.log('\n[scan]');
const scanJson = JSON.parse(run('scan', ['--json']));
ok(scanJson.roots.length >= 4, 'scan discovers at least 4 root ranks');
ok(scanJson.roots.some((r) => r.source === 'user-dsh'), 'scan includes the user-dsh root');

// ── plan ────────────────────────────────────────────────────────────────
console.log('\n[plan]');
// 12 skills written; the no-name one is invalid => 11 catalog-able
const planJson = JSON.parse(run('plan', ['--json']));
ok(planJson.skills === 11, `plan finds 11 catalog-able skills (got ${planJson.skills})`);
ok(planJson.skippedInvalid === 1, `plan skips the no-name skill (got ${planJson.skippedInvalid})`);
ok(planJson.categories.every((c) => c.tokens <= 4000), 'every planned index fits the token budget');

// ── apply (dry run writes nothing) ──────────────────────────────────────
console.log('\n[apply --dry-run]');
const dry = JSON.parse(run('apply', ['--json', '--dry-run']));
ok(dry.links.created === 11, `dry run would create 11 links (got ${dry.links.created})`);
ok(!fs.existsSync(path.join(home, 'skill-router')), 'dry run wrote nothing');

// ── apply for real ──────────────────────────────────────────────────────
console.log('\n[apply]');
const applied = JSON.parse(run('apply', ['--json']));
ok(applied.links.created === 11, `11 links created (got ${applied.links.created})`);
ok(fs.existsSync(path.join(home, 'skills', 'skill-router', 'SKILL.md')), 'router written into the scanned root');
const routerBody = fs.readFileSync(path.join(home, 'skills', 'skill-router', 'SKILL.md'), 'utf8');
ok(/\| `[^`]+` \| \d+ \|/.test(routerBody), 'router has a category table');
ok(fs.readdirSync(path.join(home, 'skills')).filter((n) => n !== 'skill-router').length === 0,
  'scanned root contains ONLY the router');
ok(fs.readdirSync(path.join(home, 'skill-index')).some((f) => f.endsWith('.md')), 'category indexes written');
ok(fs.existsSync(path.join(home, 'skill-index', '.dsh-skill-luyou.manifest.json')), 'manifest written');

// source libraries untouched
ok(fs.existsSync(path.join(libA, 'ctf-crypto', 'SKILL.md')), 'source library A intact');
ok(fs.existsSync(path.join(libB, 'banner-skill', 'SKILL.md')), 'source library B intact');

// ── idempotency ─────────────────────────────────────────────────────────
console.log('\n[apply again — idempotent]');
const again = JSON.parse(run('apply', ['--json']));
ok(again.links.created === 0 && again.links.exists === 11, `second apply is a no-op (created=${again.links.created})`);

// ── verify ──────────────────────────────────────────────────────────────
console.log('\n[verify]');
const verJson = JSON.parse(run('verify', ['--json']));
ok(verJson.dead.length === 0, `no dead index paths (got ${verJson.dead.length})`);
ok(verJson.checked >= 11, `verify checked >=11 paths (got ${verJson.checked})`);
ok(verJson.extraneous.length === 0, 'no extraneous entries in the scanned root');

// ── token arithmetic sanity ─────────────────────────────────────────────
console.log('\n[token math]');
// Windows note: drive-letter paths are not valid import() specifiers; go through
// pathToFileURL. This is exactly the portability trap the CLI avoids by using
// static imports only.
const { pathToFileURL } = await import('node:url');
const { measureCatalog } = await import(pathToFileURL(path.join(ROOT, 'src', 'catalog.mjs')));
const m = measureCatalog([
  { name: 'a', description: 'x'.repeat(600) },          // gets capped at 500
  { name: 'b', description: '中'.repeat(300) },          // CJK-heavy
]);
ok(m.cappedCount === 1, 'cap detection works');
// CJK prices ~1 token/char (300 chars ≈ 300 tok) vs Latin ~4 chars/tok (capped
// 500 chars ≈ 125 tok) — so the CJK entry should dominate. 300..500 is the sane band.
ok(m.tokens >= 300 && m.tokens <= 500, `CJK-aware token estimate in a sane range (got ${m.tokens})`);

// ── restore ─────────────────────────────────────────────────────────────
console.log('\n[restore]');
const restored = JSON.parse(run('restore', ['--json']));
ok(restored.linksRemoved === 11, `restore removed 11 links (got ${restored.linksRemoved})`);
ok(fs.readdirSync(path.join(home, 'skills-off')).length === 0, 'off-root empty after restore');
ok(fs.existsSync(path.join(libA, 'ctf-crypto', 'SKILL.md')), 'sources still intact after restore');

// ── cleanup ─────────────────────────────────────────────────────────────
fs.rmSync(tmp, { recursive: true, force: true });

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
