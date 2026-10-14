/**
 * generate.mjs — write the router skill and the per-category index files.
 *
 * The router is the ONLY thing left in a scanned root, so it is the only skill in
 * the catalog. It must therefore do three jobs in as few tokens as possible:
 *   1. tell the model how many skills exist and where the indexes live,
 *   2. give a one-line "use this when…" label per category — this is the ONLY signal
 *      the model has for choosing a category, so bare slugs make the router useless,
 *   3. state the anti-pattern explicitly ("do not load every index").
 */
import fs from 'node:fs';
import path from 'node:path';
import { estimateTokens, DEFAULT_DESC_CAP } from './catalog.mjs';

export const ROUTER_NAME = 'skill-router';
export const MANAGER_NAME = 'skill-manager';

export function routerText({ buckets, indexDir, skillsRoot, offDir, total, locale = 'en' }) {
  const zh = locale === 'zh';
  const lines = [];
  lines.push('---');
  lines.push(`name: ${ROUTER_NAME}`);
  lines.push(
    'description: ' +
      (zh
        ? '技能总目录（路由）。当任务需要专门技能而手上没有对应指令时，先读本文件确定类别，再读该类别的索引，最后 read 具体技能的 SKILL.md。不要在未读索引前猜测技能内容。'
        : 'Skill catalog router. When a task needs a specialised skill and you do not already have its instructions, read this file to pick a category, then read that category index, then read the chosen SKILL.md. Never guess a skill\u2019s contents before reading its index.')
  );
  lines.push('---');
  lines.push('');
  lines.push(zh ? '# 技能路由器' : '# Skill router');
  lines.push('');
  lines.push(
    zh
      ? `本机共 **${total}** 个技能，分 **${buckets.length}** 类。它们**不在**当前会话的技能目录里，按需加载：`
      : `This machine has **${total}** skills in **${buckets.length}** categories. They are NOT in the session skill catalog; load them on demand:`
  );
  lines.push('');
  lines.push(zh ? '1. 判断任务属于哪一类（见下表）' : '1. Decide which category the task belongs to (table below)');
  lines.push(zh ? `2. 用 \`read\` 读取 \`${path.join(indexDir, '<category>.md')}\`` : `2. \`read\` \`${path.join(indexDir, '<category>.md')}\``);
  lines.push(zh ? '3. 从索引里挑出需要的技能，`read` 它的 `SKILL.md` 完整路径' : '3. Pick the skills you need from that index and `read` their `SKILL.md` paths');
  lines.push('');
  lines.push(zh ? '> 一次只加载真正需要的那一类，**不要把所有索引都读了**。' : '> Load only the one category you need. Do NOT read every index.');
  lines.push('');
  lines.push(
    zh
      ? `**技能库管理**：要添加 / 删除 / 查找 / 更新技能，读 \`${path.join(indexDir, MANAGER_NAME + '.md')}\`。`
      : `**Managing skills**: to add, remove, find or update skills, read \`${path.join(indexDir, MANAGER_NAME + '.md')}\`.`
  );
  lines.push('');
  lines.push(zh ? '| 类别 | 技能数 | 适用于 |' : '| category | skills | use when |');
  lines.push('|---|---:|---|');
  for (const b of buckets) {
    const label = b.label ? b.label : (zh ? '（未分类）' : '(uncategorised)');
    lines.push(`| \`${b.category}\` | ${b.items.length} | ${label} |`);
  }
  lines.push('');
  return lines.join('\n');
}

export function indexText(bucket, { locale = 'en', descCap = DEFAULT_DESC_CAP } = {}) {
  const zh = locale === 'zh';
  const lines = [];
  lines.push(`# ${bucket.category} (${bucket.items.length})`);
  lines.push('');
  lines.push(
    zh
      ? '需要时用 `read` 工具读取下面任一项的完整路径，即可获得该技能的完整指令。'
      : 'Use the `read` tool on any full path below to load that skill\u2019s complete instructions.'
  );
  lines.push('');
  for (const s of [...bucket.items].sort((a, b) => a.name.localeCompare(b.name))) {
    const d = (s.description || '').slice(0, descCap);
    lines.push(`- **${s.name}**${d ? ' — ' + d : ''}`);
    lines.push(`  \`${s.skillFile}\``);
  }
  lines.push('');
  return lines.join('\n');
}

export function managerText({ indexDir, skillsRoot, offDir, cli, locale = 'en' }) {
  const zh = locale === 'zh';
  return `---
name: ${MANAGER_NAME}
description: ${
    zh
      ? '管理本机技能库（增删改查、分类索引、路由）。当用户要求添加、删除、更新、查找技能，或询问“有哪些技能”“某类技能”时使用。'
      : 'Manage the local skill library (add/remove/update/find, category indexes, routing). Use when the user asks to add, remove, update or find skills, or asks what skills exist.'
  }
---

${zh ? '# 技能管理器' : '# Skill manager'}

${zh ? '本机采用**路由器 + 分类索引**架构，降低每次请求的技能目录开销。' : 'This machine uses a **router + category index** layout to keep the per-request skill catalog small.'}

## ${zh ? '目录' : 'Layout'}

\`\`\`
${skillsRoot}     ${zh ? '← DSH 扫描这里；只放路由器' : '<- DSH scans this; router only'}
${indexDir}     ${zh ? '← 分类索引（不在技能库内，不被扫描）' : '<- category indexes (outside the scanned root)'}
${offDir}     ${zh ? '← 归档的真实技能（链接）' : '<- the real skills, linked'}
\`\`\`

## ${zh ? '常用操作' : 'Common operations'}

\`\`\`bash
${cli} scan       ${zh ? '# 查看各扫描根与目录开销' : '# show roots and catalog cost'}
${cli} plan       ${zh ? '# 预览分类与索引大小，不写文件' : '# preview classification, write nothing'}
${cli} apply      ${zh ? '# 建链接 + 生成路由器与索引' : '# link skills, write router and indexes'}
${cli} verify     ${zh ? '# 校验每条索引路径是否有效' : '# check every index path resolves'}
${cli} restore    ${zh ? '# 回滚（保留源库）' : '# roll back (source libraries untouched)'}
\`\`\`

## ${zh ? '维护' : 'Maintenance'}

${zh ? '加技能：把 SKILL.md 放进源库，重跑 `' + cli + ' apply`。' : 'Adding a skill: put its SKILL.md in a source library, then re-run `' + cli + ' apply`.'}
${zh ? '手改索引：直接编辑 `' + indexDir + '/<类别>.md` 也行。' : 'Hand-editing an index under `' + indexDir + '` also works.'}

## ${zh ? '两条硬约束' : 'Two hard rules'}

| ${zh ? '约束' : 'Rule'} | ${zh ? '原因' : 'Why'} |
|---|---|
| ${zh ? '技能库里只放路由器' : 'Keep only the router in the scanned root'} | ${zh ? '放别的会重新撑大 catalog' : 'anything else re-inflates the catalog'} |
| ${zh ? '不移动源库文件' : 'Never move source files'} | ${zh ? '索引记录的是链接目标，移动即失效' : 'indexes record link targets; moving breaks them'} |
`;
}

export function writeIfChanged(file, content) {
  let prev = null;
  try {
    prev = fs.readFileSync(file, 'utf8');
  } catch {
    /* new file */
  }
  if (prev === content) return false;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content, 'utf8');
  return true;
}

export function measureBuckets(buckets) {
  return buckets.map((b) => ({ category: b.category, skills: b.items.length, tokens: estimateTokens(indexText(b)) }));
}
