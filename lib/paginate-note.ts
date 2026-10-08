/**
 * Split at measured page capacity, preserving every character and grapheme.
 * `fits` gets the page index because the first page can hold less (a photo).
 */
export function paginateNote(
  body: string,
  fits: (text: string, page: number) => boolean,
): string[] {
  const segments = Array.from(new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(body), ({ segment }) => segment);
  const pages: string[] = [];
  let offset = 0;
  while (offset < segments.length) {
    let low = 1;
    let high = segments.length - offset;
    let count = 1;
    while (low <= high) {
      const mid = Math.floor((low + high) / 2);
      if (fits(segments.slice(offset, offset + mid).join(""), pages.length)) {
        count = mid;
        low = mid + 1;
      } else high = mid - 1;
    }
    if (offset + count < segments.length) {
      // Prefer a word boundary without leaving most of the page empty.
      for (let i = count - 1; i >= Math.floor(count * 0.6); i -= 1) {
        if (/\s/u.test(segments[offset + i])) {
          count = i + 1;
          break;
        }
      }
    }
    pages.push(segments.slice(offset, offset + count).join(""));
    offset += count;
  }
  return pages.length ? pages : [""];
}
