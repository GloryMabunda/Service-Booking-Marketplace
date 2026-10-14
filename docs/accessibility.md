# Accessibility and mobile check

Checked for #84 against WCAG 2.2 level AA.

## Checked automatically on every build

| Check | Where |
| --- | --- |
| axe rules (names, labels, language, headings, landmarks, ARIA) on every page | `src/common/accessibility.spec.ts` |
| Colour contrast of every text/background pairing in the style tokens and calendar | `src/common/colour-contrast.spec.ts` |
| Pages allow pinch-zoom; unique ids; every field labelled | `src/common/accessibility.spec.ts` |

## Checked by hand in a browser (phone 375 px and small phone 320 px)

Pages: home, services, book, your details, look-up, the private booking page, and the admin dashboard, bookings, one booking, calendar, website.

- No page scrolls sideways. The bookings table scrolls inside its own box.
- Form fields are 16 px or larger, so phones do not zoom in on focus.
- Every picture has text for screen readers.

## Findings

| Finding | Status |
| --- | --- |
| Pink text on lilac was 4.49 to 1 (needs 4.5) | Fixed: `--mbg-pink-text` is now `#C0284F` |
| "Change" link on the booking page was 22 px tall | Fixed: now 38 px |
| Filter checkboxes on admin Bookings are 16 px | Accepted: their labels are the tap target, and this page is the owner's |
| Pages were checked before scripts run, so content added by scripts is covered by hand only | Logged here; re-check after large page changes |
