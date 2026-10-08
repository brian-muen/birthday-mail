# Card object contract (wave 2)

Wave 1 (`docs/card-experience-contract.md`, merged as PR #12) shipped navigation queuing, a live homepage preview, draft recovery, and a long-note reader. The card still reads as a tinted UI panel: Caveat on the cover, a website CTA on the paper, heavy grain, script fonts used as body type, a clipped 10×7 closed state, and an organizer page that buries the three links.

This wave makes it feel like a folded birthday card on a quiet table.

## Direction

A physical 5×7 greeting card that happens to hold many handwritten notes. Thankbox is the reference for ceremony (the object arrives, you flip the object, chrome stays off the paper). Do not clone their catalog, gift pots, or media wall.

Keep the existing font families already loaded (Garamond, Karla, Caveat, Great Vibes, Satisfy, Caveat Brush, Source Sans, Cormorant). Do not add font packages or other dependencies. Do not change the database schema. Do not send Slack messages.

**Roles for type**

- Cover greeting and dedication: printed Garamond / Cormorant, not Caveat.
- Note body: a readable hand or print. Fountain and brush **bodies** must stay legible at paragraph size. Great Vibes and Satisfy are signature faces, not paragraph faces.
- Signatures: the chosen pen, including script pens.
- UI chrome: Karla, off the paper.

**Palette tokens** (paper agent may refine, not replace)

| Token | Role |
|---|---|
| `--paper` `#fafaf7` | Tabletop |
| `--paper-liner` `#fffdf8` | Writing interior (new if missing) |
| `--ink` | Interface navy stays for UI |
| `--ink-pen` | Warm brown-black or blue-black for writing (new) |
| `--muted` `#59617a` | Secondary UI |
| `--rule` `#dedcd4` | Rules |
| `--brass` `#7c5416` | Quiet accent |
| `--card-stock` | Chosen cover color |

Avoid tracked-out ALL-CAPS eyebrows, `01 / 02 / 03` markers unless the content is truly a sequence the user is in, and decorative hover theater.

## File ownership (do not edit outside this list)

### Paper — branch `polish/paper-design`

- `app/paper.css`
- `app/page.tsx`
- `components/create-card-form.tsx` (and a preview extract if you add one, e.g. `components/card-preview.tsx`)
- `app/globals.css` **tokens only** (`:root`, `@theme`). Do not move or rewrite `.card-*` rules.
- `lib/stock.ts` only if a hex must change to read as paper.
- `app/layout.tsx` only if a comment or a CSS import path must change.

May **override** grain / liner / edge / static crease from `paper.css` (it is imported after `card-motion.css`). Do not delete motion’s transform rules.

### Signing — branch `polish/signing-experience`

- `app/sign/[contributeToken]/page.tsx`
- `app/sign/[contributeToken]/message-form.tsx`
- `components/message-reader.tsx`
- `lib/pen.ts` (classes / sizes / `penSignatureClass`; keep pen ids stable)
- `components/pen-icon.tsx` if the picker must look like pens

Do not edit `card-book.tsx`. Motion already imports `MessageReader`; your reader API must stay compatible or remain a drop-in.

### Motion — branch `polish/card-motion`

- `app/card/[masterToken]/card-book.tsx`
- `app/card-motion.css`
- `app/card/[masterToken]/page.tsx` only if the page frame around the card must change (PDF link placement)

Do not restyle grain, liner, or homepage paper. Use paper tokens. Animated lighting and fold shadows live here.

### Organizer — branch `polish/organizer-flow`

- `app/created/[masterToken]/page.tsx`
- `components/copy-button.tsx`
- New share helpers under `components/` if needed (e.g. `components/share-link.tsx`)

Do not edit `card-book.tsx`. Motion hides recipient-only chrome (dates, “Open the card”, note counts on the gift cover). Organizer owns the created-card handoff.

### Shared / forbidden

- Do not add `audit-fixture` routes to production.
- Do not change `app/actions/*`, Slack routes, tokens, or schema.
- PDF (`app/card/[masterToken]/pdf/route.ts`): leave it unless a stock hex you own changes. Dedication placement in the PDF is a follow-up.
- No new npm dependencies.

## Shared markup contract

Motion implements this structure. Paper styles it. The homepage preview **reuses the same class names** so materials match.

```html
<!-- Cover (closed 5×7). Whole face is the open control. No "Open the card" text. -->
<span class="card-body card-cover">
  <span class="card-cover-mark" aria-hidden="true"></span>
  <span class="card-cover-greeting">Happy birthday</span>
  <span class="card-cover-name">{recipientName}</span>
</span>

<!-- First inside-left: printed dedication (recipient view). Organizer empty-state copy stays off this face or on a separate empty inside. -->
<div class="card-body card-dedication">
  <p>From your brothers and sisters in Christ</p>
</div>
```

Dedication copy stays exactly: `From your brothers and sisters in Christ`.

Cover name stays Garamond/Cormorant at a size that fits 80 characters (existing `coverTypeSize` logic may move onto `.card-cover-name`).

## Leaf model (motion)

Keep mobile = one note per leaf. Desktop bifold stays.

First opening when notes exist:

- Left: dedication (printed).
- Right: first note.

Then continue pairing remaining notes. An odd last note may sit alone; do not invent a blank “please write” panel for the recipient.

Empty card:

- Cover, then dedication or quiet liner inside. Organizer-only empty copy is allowed on the organizer view, not on the gift cover.

Close always returns to the **front cover**. Do not revive the closed-back flip unless you can do it as the same turn model without a second state machine.

Closed desktop card is a real centered 5×7. Prefer a dedicated closed geometry over `translateX(-25%)` + `clip-path: inset(0 0 0 50%)` if you can do it without a size jump.

## Motion timings and lighting

- Opening / cover: 700–850ms.
- Page turn: 450–600ms.
- Closing: 600–750ms.
- Ease: slow start, settle at the end (not the current mechanical ease-in-out). A short settle is fine; no bounce theater.
- One transition in flight; at most one queued action (already present — keep it).
- **Lighting:** as a leaf approaches 90°, darken the turning face; the arriving face brightens. A moving fold shadow lands on the page below. Drive this from `data-moving` / turn progress, not from static grain.
- Optional entrance: the closed card settles onto the table once. Nothing else auto-plays. `prefers-reduced-motion` skips it.
- Click / drag / swipe the **page** to turn. Underline Previous/Next become secondary or visually quieter. Vertical scroll must still work on mobile.
- Preserve the viewed note across the 52rem spread breakpoint (already present — keep it).
- Hidden faces stay `aria-hidden` and `tabIndex={-1}`.
- Reduced motion: instant state, no lighting animation.

## Paper materials

- Grain / fiber overlay opacity about **0.08**, not 0.42. Override `.card-face::after` from `paper.css`.
- Covers keep `--card-stock`. Interiors (`:not([data-stock="cover"])`) use `--paper-liner` so writing sits on lighter stock.
- Subtle edge thickness (inset highlight + a 1px outer shade). No skeuomorphic stickers or balloon clipart.
- One quiet cover ornament via `.card-cover-mark` (letterpress rule, small botanical stroke, or scored frame). Not a gallery of designs.
- Homepage preview is the same object: name, stock, cover classes, liner visible on the back if shown. Available on mobile. Creating a card is not required to explore paper.

Homepage: the live card is the hero. Cut ALL-CAPS kickers, `01 02 03` process chrome, and “For the person who has everything” if it fights the object. Form stays short: name, paper, optional note, create.

## Signing and reading

- Writing surface uses liner + grain tokens so it matches the finished interior.
- Drafts stay scoped per `contributeToken`, restore on refresh, clear after success, survive failed submit.
- Preview the contributor’s own note (body + signature) before or beside submit. Never other people’s notes.
- `penNoteClass`: fountain/brush readable as body (size/line-height, not a different font id).
- Add `penSignatureClass` for the signature line (script pens may be larger).
- Long notes: do **not** replace the handwriting with a “Read this note” link or shrink the pen. Overflow continues onto the next face, the way a real card runs onto the back of the page: each page is measured at the real font, non-final pages end with “continued →”, and the signature sits on the last page. The compose preview flips through the same pages in place.
- Privacy copy: only the recipient and organizer see a note. Delivery happens when the organizer shares the recipient link — there is no timed gate. Fix “on their birthday” if it implies a scheduled send.
- Dates do not belong on the recipient writing surface (motion). Signing preview may omit dates.

## Organizer handoff

Top of `/created/[token]`, in this order, each unmistakable:

1. **Signing link** — share with everyone writing.
2. **Recipient link** — send to the birthday person when ready. This *is* delivery.
3. **Organizer link** — keep private; can remove a note.

Show contribution count if you can do it with a read-only query on the created page (no schema change). If you add a count, it is organizer-only.

Slack invites stay in a collapsed `<details>` below the three links. Reviewing must not submit that form.

Copy + native `navigator.share` where supported. Failed clipboard still offers selectable URL text.

## Privacy and links

- Contribute token: write-only. Never list other notes.
- Gift token: recipient presentation. No remove, no counts, no “nothing inside yet” on the cover.
- Master token: same card plus remove.
- No accounts. A lost organizer link cannot be recovered — keep that warning.

## Verification (every agent)

Run in the **worktree** with hosted Postgres disabled so you do not write production data:

```bash
DATABASE_URL= PGLITE_DIR=".pglite" npx next dev -p <free-port>
```

Also `npm run lint`. Build with webpack if a `node_modules` symlink makes Turbopack fail.

Browser: 375px and desktop; keyboard; reduced motion; empty / one / many notes; long name; long message; every pen. Paper: preview tracks name + stock. Signing: refresh restores draft; success clears it. Motion: open, reverse, rapid tap, close, resize without losing the note. Organizer: three roles obvious; Slack stays closed.

Do not send Slack DMs. Do not use production `DATABASE_URL` for fixtures.

## Git / PR

- Work only in your assigned worktree and branch.
- Commit on your branch. Push. Open a **draft** PR **into `polish/card-object`** (not `main`).
- PR body: what changed, how you verified, known limitations. No merge.
- Do not rewrite unrelated wave-1 docs except a one-line pointer in your PR if needed.

Integration merge order (parent, not agents): paper → signing → motion → organizer.
