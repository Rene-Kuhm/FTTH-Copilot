import assert from "node:assert/strict";
import { test } from "node:test";
import {
  findReleaseRangeViolations,
  normalizeEntryText,
  parseChangelog,
  type ChangelogSection,
} from "../lib/release-range.ts";

/**
 * Un historial lineal de mentira: los SHAs están ordenados de más viejo a
 * más nuevo, así que "a es ancestro de b" es "a aparece antes que b".
 */
function linealHistory(shas: string[]): (ancestor: string, descendant: string) => boolean {
  const position = new Map(shas.map((sha, index) => [sha, index]));
  return (ancestor, descendant) => {
    const from = position.get(ancestor);
    const to = position.get(descendant);
    if (from === undefined || to === undefined) return false;
    return from <= to;
  };
}

const AAA = "a".repeat(40);
const BBB = "b".repeat(40);
const CCC = "c".repeat(40);

function section(version: string, entries: { text: string; commit?: string }[]): ChangelogSection {
  return { version, entries };
}

test("parseChangelog parte las secciones de versión y extrae el commit de cada entrada", () => {
  const markdown = [
    "## [0.4.0](https://github.com/acme/repo/compare/v0.3.0...v0.4.0) (2026-11-02)",
    "",
    "### Added",
    "",
    `* **laya:** add the expert system ([${AAA}](https://github.com/acme/repo/commit/${AAA}))`,
    `* **api:** fiber-plans CRUD ([#330](https://github.com/acme/repo/issues/330)) ([${BBB}](https://github.com/acme/repo/commit/${BBB}))`,
    "",
    "## [0.3.0] — 2026-10-05 — Lo que ya se publicó",
    "",
    "- Corregido el bucle de inicio de sesión.",
  ].join("\n");

  const sections = parseChangelog(markdown);

  assert.equal(sections.length, 2);
  assert.equal(sections[0].version, "0.4.0");
  assert.equal(sections[0].entries.length, 2);
  assert.equal(sections[0].entries[0].commit, AAA);
  assert.equal(sections[0].entries[1].commit, BBB);
  assert.equal(sections[1].version, "0.3.0");
  assert.equal(sections[1].entries.length, 1);
});

test("parseChangelog ignora los títulos que no son versiones", () => {
  const sections = parseChangelog(["# Changelog", "", "## Upgrade notes", "- algo"].join("\n"));
  assert.deepEqual(sections, []);
});

test("normalizeEntryText quita links, énfasis y espacios", () => {
  assert.equal(
    normalizeEntryText("**laya:**  add the expert system ([#330](https://example.test/330))"),
    "laya: add the expert system (#330)",
  );
});

test("findReleaseRangeViolations acusa una entrada que ya estaba publicada antes de la línea base", () => {
  const violations = findReleaseRangeViolations({
    sections: [section("0.4.0", [{ text: "laya: add the expert system", commit: AAA }])],
    base: BBB,
    head: CCC,
    isAncestor: linealHistory([AAA, BBB, CCC]),
  });

  assert.equal(violations.length, 1);
  assert.match(violations[0], /anterior a la línea base/);
  assert.match(violations[0], /ya estaba publicada/);
});

test("findReleaseRangeViolations no se queja cuando todas las entradas están en el rango", () => {
  const violations = findReleaseRangeViolations({
    sections: [
      section("0.4.0", [
        { text: "laya: add the expert system", commit: BBB },
        { text: "api: fiber-plans CRUD", commit: CCC },
      ]),
    ],
    base: AAA,
    head: CCC,
    isAncestor: linealHistory([AAA, BBB, CCC]),
  });

  assert.deepEqual(violations, []);
});

test("findReleaseRangeViolations acusa una entrada que repite la versión anterior", () => {
  const violations = findReleaseRangeViolations({
    sections: [
      section("0.4.0", [{ text: "laya: add the expert system", commit: CCC }]),
      section("0.3.0", [{ text: "laya: add the expert system", commit: BBB }]),
    ],
    base: BBB,
    head: CCC,
    isAncestor: linealHistory([AAA, BBB, CCC]),
  });

  assert.equal(violations.length, 1);
  assert.match(violations[0], /repite una entrada ya publicada/);
  assert.match(violations[0], /0\.3\.0/);
});

test("findReleaseRangeViolations acusa una línea base que no es ancestro de HEAD", () => {
  const violations = findReleaseRangeViolations({
    sections: [section("0.4.0", [])],
    base: CCC,
    head: AAA,
    isAncestor: linealHistory([AAA, BBB, CCC]),
  });

  assert.equal(violations.length, 1);
  assert.match(violations[0], /no es ancestro de HEAD/);
});

test("findReleaseRangeViolations sin línea base sólo revisa las entradas repetidas", () => {
  const violations = findReleaseRangeViolations({
    sections: [
      section("0.4.0", [{ text: "laya: add the expert system", commit: AAA }]),
      section("0.3.0", [{ text: "laya: add the expert system", commit: AAA }]),
    ],
    head: AAA,
    isAncestor: linealHistory([AAA]),
  });

  assert.equal(violations.length, 1);
  assert.match(violations[0], /repite una entrada ya publicada/);
});
