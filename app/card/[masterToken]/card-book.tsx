"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  useTransition,
} from "react";
import { deleteMessage } from "@/app/actions/delete-message";
import { resolveDedication } from "@/lib/dedication";
import { penVar, type PenId } from "@/lib/pen";
import CoverSurface from "@/components/cover-surface";
import MessageReader from "@/components/message-reader";
import {
  CardObject,
  CardSheet,
  FaceChrome,
  getReducedMotion,
  getServerFalse,
  getSpread,
  subscribeToMotion,
  subscribeToSpread,
} from "@/components/folded-card";
import { useCardTurn } from "@/components/use-card-turn";

type Note = {
  id: number;
  authorName: string;
  body: string;
  date: string;
  pen: PenId;
  image?: string | null;
};

type Face =
  | { kind: "cover" }
  | { kind: "dedication" }
  | { kind: "note"; note: Note; page: number; count: number }
  | { kind: "empty" }
  | { kind: "back" };

type Leaf = { front: Face; back: Face };

type View =
  | { kind: "cover" }
  | { kind: "dedication" }
  | { kind: "note"; id: number; page: number };

/** Measured pages of each note, keyed by note id. */
type NotePages = Record<number, string[]>;

function hashOf(value: string) {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 33 + value.charCodeAt(i)) % 10007;
  }
  return hash;
}

function inkFor(text: string) {
  return 0.8 + (hashOf(text) % 16) / 100;
}

function isChromeTarget(target: EventTarget | null) {
  if (!(target instanceof Element)) return false;
  return Boolean(
    target.closest("button, a, summary, input, textarea, select, label"),
  );
}

function hasTextSelection() {
  const selection = window.getSelection();
  return Boolean(selection && !selection.isCollapsed && selection.toString().trim());
}

function withBackCover(leaves: Leaf[]): Leaf[] {
  const last = leaves[leaves.length - 1];
  if (!last) {
    return [{ front: { kind: "cover" }, back: { kind: "back" } }];
  }
  if (last.back.kind === "back") return leaves;
  if (last.front.kind === "empty" && last.back.kind === "empty") {
    return [
      ...leaves.slice(0, -1),
      { front: { kind: "empty" }, back: { kind: "back" } },
    ];
  }
  return [...leaves, { front: { kind: "empty" }, back: { kind: "back" } }];
}

/** Every page of every note, in order: a long note runs onto the next face. */
function notePageFaces(notes: Note[], notePages: NotePages): Face[] {
  return notes.flatMap((note) => {
    const count = Math.max(1, notePages[note.id]?.length ?? 1);
    return Array.from({ length: count }, (_, page) => ({
      kind: "note" as const,
      note,
      page,
      count,
    }));
  });
}

/**
 * Dedication is the first inner leaf when a card has one. Desktop then
 * pairs note pages across the spread, so a long note continues on the
 * back of its page. Mobile keeps one face per leaf so the writing turns
 * with the page.
 */
function buildLeaves(
  notes: Face[],
  spread: boolean,
  hasDedication: boolean,
): Leaf[] {
  if (!spread) {
    const leaves: Leaf[] = [
      { front: { kind: "cover" }, back: { kind: "empty" } },
    ];
    if (hasDedication) {
      leaves.push({ front: { kind: "dedication" }, back: { kind: "empty" } });
    } else if (notes.length === 0) {
      leaves.push({ front: { kind: "empty" }, back: { kind: "empty" } });
    }
    leaves.push(
      ...notes.map((face) => ({
        front: face,
        back: { kind: "empty" as const },
      })),
    );
    return withBackCover(leaves);
  }

  const coverBack: Face = hasDedication
    ? { kind: "dedication" }
    : { kind: "empty" };

  if (notes.length === 0) {
    return withBackCover([
      { front: { kind: "cover" }, back: coverBack },
      { front: { kind: "empty" }, back: { kind: "empty" } },
    ]);
  }

  const leaves: Leaf[] = [{ front: { kind: "cover" }, back: coverBack }];
  for (let i = 0; i < notes.length; i += 2) {
    leaves.push({
      front: notes[i],
      back: notes[i + 1] ?? { kind: "empty" },
    });
  }
  return withBackCover(leaves);
}

function lastPlace(
  leaves: Leaf[],
  spread: boolean,
  noteCount: number,
  hasDedication: boolean,
) {
  if (!spread) return Math.max(1, (hasDedication ? 1 : 0) + noteCount);
  if (noteCount === 0) return 1;
  let max = 1;
  for (let i = 1; i < leaves.length; i += 1) {
    const revealsLeft = leaves[i].back.kind === "note";
    const revealsRight = leaves[i + 1]?.front.kind === "note";
    if (revealsLeft || revealsRight) max = i + 1;
  }
  return max;
}

function visibleView(leaves: Leaf[], spread: boolean, place: number): View {
  if (place <= 0) return { kind: "cover" };
  if (spread) {
    const left = leaves[place - 1]?.back;
    const right = leaves[place]?.front;
    if (right?.kind === "note") return noteView(right);
    if (left?.kind === "note") return noteView(left);
    return { kind: "dedication" };
  }
  const front = leaves[place]?.front;
  if (front?.kind === "note") return noteView(front);
  return { kind: "dedication" };
}

function noteView(face: Extract<Face, { kind: "note" }>): View {
  return { kind: "note", id: face.note.id, page: face.page };
}

function showsNote(face: Face | undefined, id: number, page?: number) {
  return (
    face?.kind === "note" &&
    face.note.id === id &&
    (page === undefined || face.page === page)
  );
}

function placeForView(
  leaves: Leaf[],
  spread: boolean,
  view: View,
  last: number,
) {
  if (view.kind === "cover") return 0;
  if (view.kind === "dedication") return Math.min(1, last);
  // Exact page first; if that page no longer exists, the note's first page.
  for (const page of [view.page, 0]) {
    for (let place = 1; place <= last; place += 1) {
      const right = leaves[place]?.front;
      const left = spread ? leaves[place - 1]?.back : undefined;
      if (showsNote(right, view.id, page) || showsNote(left, view.id, page)) {
        return place;
      }
    }
  }
  return Math.min(1, last);
}

function describeFace(face: Face | undefined) {
  if (!face) return null;
  if (face.kind === "note") {
    const note = `Note from ${face.note.authorName}`;
    return face.count > 1 ? `${note}, page ${face.page + 1} of ${face.count}` : note;
  }
  if (face.kind === "dedication") return "Dedication";
  if (face.kind === "cover") return "Front cover";
  return null;
}

function faceKey(face: Face) {
  return face.kind === "note" ? `note-${face.note.id}-${face.page}` : face.kind;
}

/** Stable keys, so a page keeps its DOM when a note before it gains a page. */
function leafKeys(leaves: Leaf[]) {
  const seen = new Map<string, number>();
  return leaves.map((leaf) => {
    const key = `${faceKey(leaf.front)}|${faceKey(leaf.back)}`;
    const n = seen.get(key) ?? 0;
    seen.set(key, n + 1);
    return n ? `${key}#${n}` : key;
  });
}

function faceStock(face: Face) {
  if (face.kind === "cover" || face.kind === "back") return "cover";
  return "liner";
}

const OPEN_TO_NOTE_DELAY = 900;

export default function CardBook({
  masterToken,
  canManage,
  recipientName,
  dedication,
  notes,
  stock,
  design = "plain",
  openToNote = null,
}: {
  masterToken: string;
  canManage: boolean;
  recipientName: string;
  intro: string | null;
  dedication: string | null;
  notes: Note[];
  stock: string;
  design?: string;
  /** Lands closed, then turns to this note; opens there at once under reduced motion. */
  openToNote?: number | null;
}) {
  const dedicationText = resolveDedication(dedication);
  const hasDedication = Boolean(dedicationText);
  const spread = useSyncExternalStore(
    subscribeToSpread,
    getSpread,
    getServerFalse,
  );
  const reducedMotion = useSyncExternalStore(
    subscribeToMotion,
    getReducedMotion,
    getServerFalse,
  );

  const [notePages, setNotePages] = useState<NotePages>({});
  const reportPages = useCallback((id: number, pages: string[]) => {
    setNotePages((previous) => {
      const known = previous[id];
      if (
        known &&
        known.length === pages.length &&
        known.every((page, i) => page === pages[i])
      ) {
        return previous;
      }
      return { ...previous, [id]: pages };
    });
  }, []);
  const pageFaces = useMemo(
    () => notePageFaces(notes, notePages),
    [notes, notePages],
  );
  const leaves = useMemo(
    () => buildLeaves(pageFaces, spread, hasDedication),
    [pageFaces, spread, hasDedication],
  );
  const keys = useMemo(() => leafKeys(leaves), [leaves]);
  const last = lastPlace(leaves, spread, pageFaces.length, hasDedication);

  // The viewed face survives a resize that swaps the leaf model; the
  // settled place is derived from it.
  const hasOpenNote =
    openToNote !== null && notes.some((note) => note.id === openToNote);
  const [view, setView] = useState<View>(() =>
    hasOpenNote && reducedMotion
      ? { kind: "note", id: openToNote as number, page: 0 }
      : { kind: "cover" },
  );
  const pendingOpen = useRef(hasOpenNote && !reducedMotion ? openToNote : null);
  const [touched, setTouched] = useState(false);
  const place = placeForView(leaves, spread, view, last);
  const closed = place === 0;

  const { frameRef, sliderRef, goTo, jump, target, frameHandlers, sliderHandlers } =
    useCardTurn({
      last,
      reducedMotion,
      onRest: (t) => {
        setTouched(true);
        if (Number.isInteger(t)) setView(visibleView(leaves, spread, t));
      },
    });

  const placeRef = useRef(place);
  useLayoutEffect(() => {
    placeRef.current = place;
  });
  useLayoutEffect(() => {
    jump(placeRef.current);
  }, [leaves, jump]);

  const go = useCallback(
    (next: number) => {
      setTouched(true);
      goTo(next > last ? 0 : Math.max(0, next));
    },
    [goTo, last, setTouched],
  );

  const goForward = useCallback(() => {
    const at = target();
    go(at >= last ? 0 : at + 1);
  }, [go, last, target]);

  const goBack = useCallback(() => {
    const at = target();
    go(at <= 1 ? 0 : at - 1);
  }, [go, target]);

  const turnToNote = useRef<(id: number) => void>(() => {});
  useLayoutEffect(() => {
    turnToNote.current = (id) => {
      if (target() !== 0) return;
      go(placeForView(leaves, spread, { kind: "note", id, page: 0 }, last));
    };
  });
  useEffect(() => {
    const id = pendingOpen.current;
    if (id === null) return;
    const timer = window.setTimeout(() => turnToNote.current(id), OPEN_TO_NOTE_DELAY);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const element = event.target as HTMLElement | null;
      if (element && /^(input|textarea|select)$/i.test(element.tagName)) return;
      if (element?.closest("dialog")) return;
      if (event.key === "ArrowRight") goForward();
      else if (event.key === "ArrowLeft") goBack();
      else return;
      event.preventDefault();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [goForward, goBack]);

  function onScrubKey(event: React.KeyboardEvent<HTMLInputElement>) {
    const moves: Record<string, () => void> = {
      ArrowRight: () => go(Math.min(last, target() + 1)),
      ArrowUp: () => go(Math.min(last, target() + 1)),
      ArrowLeft: () => go(target() - 1),
      ArrowDown: () => go(target() - 1),
      Home: () => go(0),
      End: () => go(last),
    };
    const move = moves[event.key];
    if (!move) return;
    event.preventDefault();
    event.stopPropagation();
    move();
  }

  const leftFace = spread && place > 0 ? leaves[place - 1]?.back : undefined;
  const rightFace = closed ? leaves[0]?.front : leaves[place]?.front;
  const announcement = closed
    ? `Birthday card for ${recipientName}, closed`
    : [describeFace(leftFace), describeFace(rightFace)]
        .filter(Boolean)
        .filter((item, index, all) => all.indexOf(item) === index)
        .join(". ") || `Inside ${recipientName}'s card`;

  function activatePage(direction: 1 | -1) {
    if (direction === 1) goForward();
    else goBack();
  }

  const noteCountLabel =
    notes.length === 0
      ? "Nothing inside yet"
      : notes.length === 1
        ? "One note"
        : `${notes.length} notes`;

  const pageLabel = closed ? "Cover" : `Page ${place} of ${last}`;

  return (
    <div className="card-book">
      <div className="sr-only" aria-hidden>
        {notes.map((note) =>
          note.image ? <img key={note.id} src={note.image} alt="" /> : null,
        )}
      </div>
      <CardObject
        stock={stock}
        spread={spread}
        frameRef={frameRef}
        handlers={frameHandlers}
      >
        {leaves.map((leaf, index) => {
          const facingFront = closed ? index === 0 : index === place;
          const facingBack = Boolean(spread && place > 0 && index === place - 1);

          return (
            <CardSheet key={keys[index]} cover={index === 0}>
              <LeafFace
                face={leaf.front}
                side="right"
                facing={facingFront}
                masterToken={masterToken}
                canManage={canManage}
                recipientName={recipientName}
                dedication={dedicationText}
                design={design}
                notePages={notePages}
                onPages={reportPages}
                onOpen={index === 0 ? () => go(1) : undefined}
                onPageTurn={index === 0 ? undefined : () => activatePage(1)}
              />
              <LeafFace
                face={leaf.back}
                side="left"
                facing={facingBack}
                masterToken={masterToken}
                canManage={canManage}
                recipientName={recipientName}
                dedication={dedicationText}
                design={design}
                notePages={notePages}
                onPages={reportPages}
                onPageTurn={() => activatePage(-1)}
              />
            </CardSheet>
          );
        })}
      </CardObject>

      <p role="status" aria-live="polite" className="sr-only">
        {announcement}
      </p>

      <div className="card-scrub">
        <input
          ref={sliderRef}
          type="range"
          min={0}
          max={last}
          step="any"
          defaultValue={0}
          className="card-scrub-range"
          aria-label={`Turn the pages of ${recipientName}'s card`}
          aria-valuetext={pageLabel}
          onInputCapture={() => setTouched(true)}
          onKeyDown={onScrubKey}
          {...sliderHandlers}
        />
        <p className="card-scrub-caption" aria-hidden>
          {closed && !touched ? "Drag the cover open, or tap it" : pageLabel}
        </p>
      </div>

      {canManage ? (
        <p className="card-nav-meta">
          {notes.length === 0
            ? `Nobody has signed ${recipientName}’s card yet. Share the signing link and every note will land in here.`
            : noteCountLabel}
        </p>
      ) : null}
    </div>
  );
}

function LeafFace({
  design,
  face,
  side,
  facing,
  masterToken,
  canManage,
  recipientName,
  dedication,
  notePages,
  onPages,
  onOpen,
  onPageTurn,
}: {
  design: string;
  face: Face;
  side: "left" | "right";
  facing: boolean;
  masterToken: string;
  canManage: boolean;
  recipientName: string;
  dedication: string;
  notePages: NotePages;
  onPages: (id: number, pages: string[]) => void;
  onOpen?: () => void;
  onPageTurn?: () => void;
}) {
  const photo =
    face.kind === "note" && face.page === 0 ? face.note.image : null;
  const faceStyle = photo
    ? { ["--note-photo" as string]: `url(${JSON.stringify(photo)})` }
    : undefined;
  const contents = (
    <>
      <FaceChrome side={side} />
      <FaceContents
        design={design}
        face={face}
        side={side}
        masterToken={masterToken}
        canManage={canManage}
        recipientName={recipientName}
        dedication={dedication}
        notePages={notePages}
        onPages={onPages}
      />
    </>
  );

  function handlePageClick(event: React.MouseEvent<HTMLElement>) {
    if (!onPageTurn || !facing) return;
    if (isChromeTarget(event.target) || hasTextSelection()) return;
    onPageTurn();
  }

  function handleCoverKey(event: React.KeyboardEvent<HTMLButtonElement>) {
    if (!facing || !onOpen) return;
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    onOpen();
  }

  if (face.kind === "cover") {
    return (
      <button
        type="button"
        onClick={facing ? onOpen : undefined}
        onKeyDown={handleCoverKey}
        className="card-face"
        data-face="front"
        data-stock="cover"
        aria-label={`Open ${recipientName}'s birthday card`}
        aria-hidden={!facing}
        tabIndex={facing ? 0 : -1}
        inert={!facing || undefined}
      >
        {contents}
      </button>
    );
  }

  return (
    <div
      className="card-face"
      data-face={side === "left" ? "back" : "front"}
      data-stock={faceStock(face)}
      data-photo={photo ? "true" : undefined}
      style={faceStyle}
      aria-hidden={!facing}
      tabIndex={-1}
      inert={!facing || undefined}
      onClick={handlePageClick}
    >
      {contents}
    </div>
  );
}

function FaceContents({
  design,
  face,
  side,
  masterToken,
  canManage,
  recipientName,
  dedication,
  notePages,
  onPages,
}: {
  design: string;
  face: Face;
  side: "left" | "right";
  masterToken: string;
  canManage: boolean;
  recipientName: string;
  dedication: string;
  notePages: NotePages;
  onPages: (id: number, pages: string[]) => void;
}) {
  switch (face.kind) {
    case "cover":
      return <CoverFace recipientName={recipientName} design={design} />;
    case "dedication":
      return (
        <div className="card-body card-dedication">
          {dedication ? <p>{dedication}</p> : null}
        </div>
      );
    case "note":
      return (
        <NoteFace
          masterToken={masterToken}
          canManage={canManage}
          note={face.note}
          page={face.page}
          pages={notePages[face.note.id]}
          onPages={onPages}
          side={side}
        />
      );
    case "empty":
    case "back":
      return <div className="card-body" />;
  }
}

function CoverFace({ recipientName, design }: { recipientName: string; design: string }) {
  return <CoverSurface design={design} recipientName={recipientName} />;
}

function NoteFace({
  masterToken,
  canManage,
  note,
  page,
  pages,
  onPages,
  side,
}: {
  masterToken: string;
  canManage: boolean;
  note: Note;
  page: number;
  pages: string[] | undefined;
  onPages: (id: number, pages: string[]) => void;
  side: "left" | "right";
}) {
  const pad =
    side === "left"
      ? "pl-7 pr-9 py-8 sm:pl-8 sm:pr-11 sm:py-10"
      : "pl-9 pr-7 py-8 sm:pl-11 sm:pr-8 sm:py-10";

  return (
    <div
      className={`card-body ${pad}`}
      style={{ ["--card-face" as string]: penVar(note.pen) }}
    >
      <div className="min-h-0 flex-1">
        <div className="h-full" style={{ color: `rgb(27 36 64 / ${inkFor(note.body)})` }}>
          <MessageReader
            body={note.body}
            authorName={note.authorName}
            pen={note.pen}
            image={note.image}
            page={page}
            pages={pages}
            onPages={page === 0 ? (next) => onPages(note.id, next) : undefined}
          />
        </div>
      </div>

      {canManage && page === 0 ? (
        <div className="mt-8">
          <RemoveControl masterToken={masterToken} messageId={note.id} />
        </div>
      ) : null}
    </div>
  );
}

function RemoveControl({
  masterToken,
  messageId,
}: {
  masterToken: string;
  messageId: number;
}) {
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function confirmDelete() {
    setError(null);
    startTransition(async () => {
      const result = await deleteMessage(masterToken, messageId);
      if (result.ok) {
        setConfirming(false);
      } else {
        setError(result.error);
      }
    });
  }

  if (confirming) {
    return (
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[0.75rem] text-muted">
        <span>
          {error ?? (isPending ? "Removing…" : "Remove this note for good?")}
        </span>
        <button
          type="button"
          onClick={confirmDelete}
          disabled={isPending}
          className="quiet-link font-medium text-ink"
        >
          Remove
        </button>
        <button
          type="button"
          onClick={() => {
            setConfirming(false);
            setError(null);
          }}
          disabled={isPending}
          className="quiet-link"
        >
          Keep it
        </button>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => setConfirming(true)}
      className="quiet-link text-[0.75rem] text-muted"
    >
      Remove this note
    </button>
  );
}
