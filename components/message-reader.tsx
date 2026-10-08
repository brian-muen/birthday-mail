"use client";

import { useLayoutEffect, useRef, useState } from "react";
import {
  penBodyVar,
  penNoteClass,
  penSignatureClass,
  penVar,
  type PenId,
} from "@/lib/pen";
import { paginateNote } from "@/lib/paginate-note";

/**
 * Page at the actual font and available space; never shrink the handwriting.
 *
 * In the card, each page of a note is its own face: page 0 measures and
 * reports every page through `onPages`, later pages show `pages[page]`.
 * Without `page`, the reader flips through its own pages (compose preview).
 */
export default function MessageReader({
  body,
  authorName,
  pen,
  image,
  page,
  pages: givenPages,
  onPages,
}: {
  body: string;
  authorName: string;
  pen: PenId;
  image?: string | null;
  page?: number;
  pages?: string[];
  onPages?: (pages: string[]) => void;
}) {
  const readerRef = useRef<HTMLDivElement>(null);
  const areaRef = useRef<HTMLDivElement>(null);
  const probeRef = useRef<HTMLParagraphElement>(null);
  const photoRef = useRef<HTMLDivElement>(null);
  const signatureRef = useRef<HTMLDivElement>(null);
  const footerRef = useRef<HTMLDivElement>(null);
  const onPagesRef = useRef(onPages);
  const [layout, setLayout] = useState({ body, pen, image, pages: [body] });
  const [ownPage, setOwnPage] = useState(0);
  const [onCardFace, setOnCardFace] = useState(false);

  const controlled = page !== undefined;
  const measures = !controlled || page === 0;
  const measured =
    layout.body === body && layout.pen === pen && layout.image === image
      ? layout.pages
      : [body];
  const pages = measures ? measured : (givenPages ?? [body]);
  const index = Math.min(controlled ? page : ownPage, pages.length - 1);
  const text = pages[index] ?? "";
  const isLast = index >= pages.length - 1;
  const showPhoto = Boolean(image) && index === 0;
  const noteClass = `note-copy whitespace-pre-wrap font-card ${penNoteClass(pen)}`;
  const bodyFace = { ["--card-face" as string]: penBodyVar(pen) };
  const signFace = { ["--card-face" as string]: penVar(pen) };

  useLayoutEffect(() => {
    onPagesRef.current = onPages;
  });

  useLayoutEffect(() => {
    if (!measures) return;
    const reader = readerRef.current;
    const area = areaRef.current;
    const probe = probeRef.current;
    if (!reader || !area || !probe) return;
    let cancelled = false;
    setOnCardFace(Boolean(area.closest(".card-face")));

    function measure() {
      if (cancelled || !reader || !area || !probe || !reader.clientHeight) return;
      const style = getComputedStyle(reader);
      const gap = parseFloat(style.rowGap) || 0;
      const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
      // A photo takes a third of the page at most, so the writing keeps
      // its room on a short phone.
      const photoH = image
        ? Math.min(11 * rem, Math.max(5 * rem, reader.clientHeight * 0.34))
        : 0;
      reader.style.setProperty("--photo-h", `${photoH}px`);
      const footer = footerRef.current?.offsetHeight ?? 0;
      const sign = signatureRef.current?.scrollHeight ?? 0;
      // A page that continues has no signature, so it keeps that room for
      // writing; only the last page pays for it.
      const restFull = reader.clientHeight - footer - gap * 2;
      const firstFull = image ? restFull - photoH - gap : restFull;
      const full = (at: number) => (at === 0 ? firstFull : restFull);
      const signed = (at: number) => full(at) - sign;

      probe.style.width = `${area.clientWidth}px`;
      probe.textContent = "M";
      const line = probe.getBoundingClientRect().height;
      const fits = (text: string, room: number) => {
        probe.textContent = text;
        return probe.getBoundingClientRect().height <= Math.max(room, line * 2) - 4;
      };

      let next = paginateNote(body, (text, at) => fits(text, full(at)));
      const tail = next.length - 1;
      if (!fits(next[tail], signed(tail))) {
        next = [
          ...next.slice(0, tail),
          ...paginateNote(next[tail], (text, at) => fits(text, signed(tail + at))),
        ];
      }
      probe.textContent = "";
      onPagesRef.current?.(next);
      setLayout((previous) =>
        previous.body === body &&
        previous.pen === pen &&
        previous.image === image &&
        samePages(previous.pages, next)
          ? previous
          : { body, pen, image, pages: next },
      );
    }

    const observer = new ResizeObserver(measure);
    observer.observe(reader);
    void document.fonts.ready.then(measure);
    document.fonts.addEventListener("loadingdone", measure);
    measure();
    return () => {
      cancelled = true;
      observer.disconnect();
      document.fonts.removeEventListener("loadingdone", measure);
    };
  }, [measures, body, pen, image, authorName]);

  // On a card face the photo is painted by the face itself, so it turns
  // with the paper instead of as a separate layer.
  useLayoutEffect(() => {
    const spacer = photoRef.current;
    if (!spacer || !image || !showPhoto) return;
    const face = spacer.closest(".card-face");
    if (!(face instanceof HTMLElement)) return;
    let cancelled = false;
    function sync() {
      if (!spacer || !(face instanceof HTMLElement)) return;
      const slotW = spacer.offsetWidth;
      const slotH = spacer.offsetHeight;
      if (!slotW || !slotH) return;
      const probeImage = new Image();
      probeImage.onload = () => {
        if (cancelled) return;
        const aspect = probeImage.naturalWidth / probeImage.naturalHeight || 1;
        let width = slotW;
        let height = slotW / aspect;
        if (height > slotH) {
          height = slotH;
          width = slotH * aspect;
        }
        // Layout offsets, so a page caught mid-turn still lines up.
        const x = offsetWithin(spacer, face, "offsetLeft") + (slotW - width) / 2;
        const y = offsetWithin(spacer, face, "offsetTop");
        face.style.setProperty("--note-photo-x", `${x}px`);
        face.style.setProperty("--note-photo-y", `${y}px`);
        face.style.setProperty("--note-photo-w", `${width}px`);
        face.style.setProperty("--note-photo-h", `${height}px`);
      };
      probeImage.src = image as string;
    }
    const observer = new ResizeObserver(sync);
    observer.observe(spacer);
    sync();
    return () => {
      cancelled = true;
      observer.disconnect();
    };
  }, [image, showPhoto]);

  return (
    <div
      ref={readerRef}
      className="note-reader"
      data-photo={showPhoto ? "true" : undefined}
    >
      {showPhoto ? (
        <div
          ref={photoRef}
          role="img"
          aria-label={`Photo from ${authorName}`}
          className="note-photo"
        >
          {onCardFace ? null : (
            <img
              src={image as string}
              alt=""
              className="h-full w-full object-contain object-top"
            />
          )}
        </div>
      ) : null}
      <div ref={areaRef} className="note-page">
        <p className={noteClass} style={bodyFace}>
          {text}
        </p>
        {measures ? (
          <p
            ref={probeRef}
            aria-hidden="true"
            className={`note-probe ${noteClass}`}
            style={bodyFace}
          />
        ) : null}
      </div>
      <div
        ref={signatureRef}
        className="note-signature"
        aria-hidden={!isLast || undefined}
        style={
          isLast ? undefined : { height: 0, overflow: "hidden", visibility: "hidden" }
        }
      >
        <p
          className={`text-right font-card ${penSignatureClass(pen)}`}
          style={signFace}
        >
          {authorName}
        </p>
      </div>
      <div ref={footerRef} className="note-pagination">
        {pages.length > 1 && controlled ? (
          <span className="note-turn">
            {isLast ? `${index + 1} / ${pages.length}` : "continued →"}
          </span>
        ) : null}
        {pages.length > 1 && !controlled ? (
          <>
            <button
              type="button"
              className="ui-button"
              aria-label="Previous page of the note"
              disabled={index === 0}
              onClick={() => setOwnPage(index - 1)}
            >
              ←
            </button>
            <span role="status" aria-live="polite">
              Page {index + 1} of {pages.length}
            </span>
            <button
              type="button"
              className="ui-button"
              aria-label="Next page of the note"
              disabled={isLast}
              onClick={() => setOwnPage(index + 1)}
            >
              →
            </button>
          </>
        ) : null}
      </div>
    </div>
  );
}

function samePages(a: string[], b: string[]) {
  return a.length === b.length && a.every((page, i) => page === b[i]);
}

/** Offset from `ancestor` in layout pixels, ignoring any 3D transform. */
function offsetWithin(
  element: HTMLElement,
  ancestor: HTMLElement,
  axis: "offsetLeft" | "offsetTop",
) {
  let total = 0;
  let node: HTMLElement | null = element;
  while (node && node !== ancestor) {
    total += node[axis];
    node = node.offsetParent as HTMLElement | null;
  }
  return total;
}
