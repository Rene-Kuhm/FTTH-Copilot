/**
 * Parser preset for commitlint, referenced by `.commitlintrc.json` through
 * `"parserPreset": "./commitlint.config.js"`.
 *
 * Why a local preset instead of `conventional-changelog-conventionalcommits`:
 * the preset ships the Conventional Commits header grammar, including the
 * `!` breaking marker (`feat(api)!: drop the legacy endpoint`). That marker
 * is what release-please reads to decide a major bump, and pull requests are
 * squash-merged here, so the pull request title is the commit message and
 * has to be able to carry it. Vendoring the two patterns keeps the check
 * runnable with a standalone `@commitlint/cli` install, without adding a
 * workspace dependency.
 *
 * The rules themselves live in `.commitlintrc.json`, which is the file
 * commitlint loads (cosmiconfig resolves `.commitlintrc.json` before
 * `commitlint.config.js`). This module only supplies the parser grammar.
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
