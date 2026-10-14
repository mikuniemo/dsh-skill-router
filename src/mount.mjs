/**
 * mount.mjs — cross-platform link management.
 *
 * WHY LINKS AND NOT MOVES
 * -----------------------
 * The obvious approach is "move the skills out of the scanned root". It has a trap:
 * an index that records `<skillsRoot>/<name>/SKILL.md` goes stale the moment that
 * directory is moved, so the router points at nothing and the agent concludes the
 * machine has no skills at all.
 *
 * Links avoid the trap entirely. The index records the link TARGET, which never
 * moves, and the scanned root stays empty apart from the router. Removing a link
 * never touches the target, so this is non-destructive by construction.
 *
 *   Windows : directory junction  (no elevation required, unlike symlinks)
 *   POSIX   : directory symlink
 */
import fs from 'node:fs';
import path from 'node:path';

export const IS_WINDOWS = process.platform === 'win32';

export function linkType(p) {
  try {
    const st = fs.lstatSync(p);
    if (st.isSymbolicLink()) return 'link';
    return 'dir';
  } catch {
    return null;
  }
}

export function readLinkTarget(p) {
  try {
    return fs.realpathSync(p);
  } catch {
    return null;
  }
}

/**
 * Create a link at `linkPath` pointing at `target`. Idempotent.
 * @returns {'created'|'exists'|'conflict'|'error'}
 */
export function link(target, linkPath, { dryRun = false } = {}) {
  const norm = (s) => path.resolve(s).replace(/[\\/]+$/, '').toLowerCase();

  let existing = null;
  try {
    existing = fs.lstatSync(linkPath);
  } catch {
    existing = null;
  }

  if (existing) {
    if (!existing.isSymbolicLink()) return 'conflict'; // a real dir/file: never clobber
    const cur = readLinkTarget(linkPath);
    if (cur && norm(cur) === norm(target)) return 'exists';
    return 'conflict';
  }

  if (dryRun) return 'created';
  fs.mkdirSync(path.dirname(linkPath), { recursive: true });
  try {
    fs.symlinkSync(path.resolve(target), linkPath, IS_WINDOWS ? 'junction' : 'dir');
    return 'created';
  } catch (e) {
    if (e.code === 'EPERM' && IS_WINDOWS) {
      throw new Error(
        `Cannot create a junction at ${linkPath}. On Windows junctions normally need no ` +
          `elevation; if this failed, enable Developer Mode or run once as Administrator.`
      );
    }
    return 'error';
  }
}

/** Remove a link. Refuses to touch anything that is not a link. */
export function unlink(linkPath, { dryRun = false } = {}) {
  let st;
  try {
    st = fs.lstatSync(linkPath);
  } catch {
    return 'absent';
  }
  if (!st.isSymbolicLink()) return 'refused-not-a-link';
  if (dryRun) return 'removed';
  // unlink() removes the link itself; the target is untouched.
  fs.unlinkSync(linkPath);
  return 'removed';
}

export function countLinks(dir) {
  if (!fs.existsSync(dir)) return 0;
  return fs.readdirSync(dir).length;
}
