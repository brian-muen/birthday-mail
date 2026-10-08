import assert from "node:assert/strict";
import test from "node:test";
import { paginateNote } from "../lib/paginate-note.ts";

const graphemes = (text) => Array.from(new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(text), ({ segment }) => segment);

test("keeps short notes on one page", () => {
  assert.deepEqual(paginateNote("Happy birthday!", (text) => text.length <= 40), ["Happy birthday!"]);
});

test("preserves all text across pages, including blank lines and long words", () => {
  for (const body of ["A memory together.\n\n".repeat(100), "x".repeat(2000), "\n".repeat(2000), "Happy birthday ".repeat(130)]) {
    const pages = paginateNote(body, (text) => text.length <= 80);
    assert.equal(pages.join(""), body);
    assert.ok(pages.every((page) => page.length > 0 && page.length <= 80));
  }
});

test("respects vertical capacity even for a note with few characters", () => {
  const body = "One\nTwo\nThree\nFour\nFive";
  const fits = (text) => text.split("\n").length <= 3;
  const pages = paginateNote(body, fits);
  assert.ok(pages.length > 1);
  assert.equal(pages.join(""), body);
  assert.ok(pages.every(fits));
});

test("does not split emoji or combining characters", () => {
  const body = "👨‍👩‍👧‍👦🎂e\u0301🇺🇸".repeat(50);
  const pages = paginateNote(body, (text) => graphemes(text).length <= 7);
  assert.equal(pages.join(""), body);
  assert.deepEqual(pages.flatMap(graphemes), graphemes(body));
});

test("prefers word boundaries and always advances in very small spaces", () => {
  assert.equal(paginateNote("Happy birthday dear friend", (text) => text.length <= 18)[0], "Happy birthday ");
  assert.deepEqual(paginateNote("abc", () => false), ["a", "b", "c"]);
  assert.deepEqual(paginateNote("", () => true), [""]);
});

test("lets later pages hold more than the first", () => {
  const body = "x".repeat(25);
  const pages = paginateNote(body, (text, page) => text.length <= (page === 0 ? 5 : 10));
  assert.deepEqual(pages.map((page) => page.length), [5, 10, 10]);
});
