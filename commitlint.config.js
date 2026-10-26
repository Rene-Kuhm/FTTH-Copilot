/**
 * Parser preset for commitlint, referenced by `.commitlintrc.json` through
 * `"parserPreset": "./commitlint.config.js"`.
 *
 * Why a local preset: commitlint's default parser (the `conventional-changelog-angular`
 * preset) does not accept the `!` breaking marker, so `feat(api)!: drop the legacy
 * endpoint` is parsed as an empty type and rejected with "type may not be empty".
 * That marker is what release-please reads to decide a major bump, and the pull
 * requests here are squash-merged, so the pull request title is the commit message
 * and has to be able to carry it.
 *
 * The two patterns below are the Conventional Commits 1.0.0 header grammar
 * (`type(scope)!: subject`). Vendoring them keeps the check runnable with a
 * standalone `@commitlint/cli` install, without adding a workspace dependency.
 *
 * The rules themselves live in `.commitlintrc.json` (the allowed types, including
 * the `swarm` type the repository automation uses, and the rest of the policy).
 * That is the file commitlint loads: its search order resolves
 * `.commitlintrc.json` before `commitlint.config.js`. This module only supplies
 * the parser grammar.
 */

/**
 * `type(scope)!: subject` — the type is required, the scope is optional and
 * the `!` marks the change as breaking.
 */
const headerPattern = /^(\w*)(?:\((.*)\))?!?: (.*)$/;

/**
 * Same grammar, used to detect the breaking marker in the header.
 */
const breakingHeaderPattern = /^(\w*)(?:\((.*)\))?!: (.*)$/;

module.exports = {
  parserOpts: {
    headerPattern,
    breakingHeaderPattern,
  },
};
