/**
 * Library entry point. Every module is usable standalone:
 *
 *   import { discoverRoots, listSkills } from 'dsh-skill-router/src/roots.mjs';
 *   import { measureCatalog }          from 'dsh-skill-router/src/catalog.mjs';
 *   import { buildBuckets }            from 'dsh-skill-router/src/classify.mjs';
 *   import { link, unlink }            from 'dsh-skill-router/src/mount.mjs';
 *   import { routerText, indexText }   from 'dsh-skill-router/src/generate.mjs';
 *   import { verifyIndexes }           from 'dsh-skill-router/src/verify.mjs';
 *   import { routeQuery, validateRouting, resolveHubPath }
 *                                      from 'dsh-skill-router/src/route.mjs';
 */
export * from './roots.mjs';
export * from './catalog.mjs';
export * from './classify.mjs';
export * from './mount.mjs';
export * from './generate.mjs';
export * from './verify.mjs';
export * from './route.mjs';
