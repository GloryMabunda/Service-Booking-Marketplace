# Style Guide

*Default theme: calm blue · v2 · for [Specification v1.0](specification.md), sections 9 and 11*

How every page of the booking site looks: colours, type, shapes, components, logo and photos (#103). The live version, with every component rendered, is [`style-guide/index.html`](style-guide/index.html): open it in a browser. The values below are implemented as CSS variables in [`public/css/theme.css`](../public/css/theme.css) (the colours) and [`public/css/tokens.css`](../public/css/tokens.css) (type, space, shape and the Bootstrap theme), which the frontend loads after Bootstrap 5.3 (#23).

**Make it your own:** only [`theme.css`](../public/css/theme.css) needs to change to re-colour the whole site, and the logo is uploaded in the portal. See [BRANDING.md](../BRANDING.md).

**Light mode only.** There is no dark theme in v1.

## Contents

1. [Principles](#1-principles)
2. [Colours](#2-colours)
3. [Typography](#3-typography)
4. [Shape and spacing](#4-shape-and-spacing)
5. [Components](#5-components)
6. [Logo](#6-logo)
7. [Photos](#7-photos)
8. [Accessibility](#8-accessibility)
9. [Using the tokens](#9-using-the-tokens)
10. [Decisions](#10-decisions)

---

## 1. Principles

- **The work is the star.** Service photos carry the most colour; the page supports them.
- **One brand, one file.** Every colour comes from `theme.css`, so a business re-colours the site in one place and the logo it uploads fits.
- **Booking is always obvious.** Deep navy means "book". There is at most one Book now per view.
- **Readable for everyone.** All text meets WCAG 2.2 AA contrast; nothing relies on colour alone.

## 2. Colours

The default theme is a calm blue with a deep navy action colour, for a home services business. Change any value in `theme.css`; the tests in `src/common/colour-contrast.spec.ts` check every pairing of text and background and fail if a new colour is too faint.

| Role | Name | Hex | Used for | Contrast |
| --- | --- | --- | --- | --- |
| Primary | Primary | `#1A5BB5` | Primary buttons, links, headings | White on it 6.6:1 |
| Primary hover | Primary dark | `#134689` | Hover and pressed states | |
| Action | Action | `#123A66` | **Book now** and the booking steps only | White text on it 11.5:1 |
| Bright | Accent | `#3B8FE0` | Large headings (24 px and up), decoration, backgrounds | 3.4:1 on white: **never small text** |
| Accent text | Accent text | `#1E63A8` | Small accent text: prices, section labels | 6.2:1 on white, 5.3:1 on the light blue tint |
| Highlight | Gold | `#F2C94C` | Stars, highlights | Decoration only |
| Success | Green | `#2E7D3E` | Confirmed status, "payment received" | White on it 5.1:1 |
| Logo ink | Brand ink | `#123A66` | The logo's ink colour, the footer | 11:1 on white |
| Text | Ink | `#12233A` | Body text | 15.8:1 on white |
| Text | Muted | `#4D6178` | Secondary text, hints | 6.4:1 on white |
| Lines | Line | `#D6E3F3` | Borders, dividers | |

**Section tints** for alternating section backgrounds and message boxes: accent `#E3F0FC`, cream `#EEF4FB`, primary `#E8EEFB`, mint `#E9F6EC`, soft `#F5F9FE`. The hero uses a soft gradient of accent, pale blue and primary. Errors keep their own red (`#8E1E3B` on `#FDE8EC`) whatever the theme, so an error never looks like a normal message.

**Rules that keep the palette from getting busy:**

1. One bright colour leads each section; the others only decorate.
2. Photos sit on white or a light tint, never on a bright colour.
3. The action colour is reserved for booking, so clients always know where to click.
4. Statuses and messages always pair colour with a word and an icon.

## 3. Typography

Three Google Fonts, all licensed for websites: **Josefin Sans** for headings, **Nunito Sans** for body text and booking details, and **Alex Brush** for rare flourishes. To use other fonts, change the three `--mbg-font-*` values and the font address at the top of `tokens.css`.

| Style | Font | Size (phone → desktop) | Weight | Token |
| --- | --- | --- | --- | --- |
| Hero title | Josefin Sans | 32 → 44 px | 600 | `.mbg-hero-title` |
| Section heading (`h2`) | Josefin Sans | 24 → 30 px | 600 | `--mbg-size-h2` |
| Card heading (`h3`) | Josefin Sans | 18 → 20 px | 700 | `--mbg-size-h3` |
| Section label | Josefin Sans, uppercase, 0.16 em spacing | 12 px | 600 | `.mbg-label` |
| Body | Nunito Sans, line height 1.6 | 16 px | 400 | `--mbg-size-body` |
| Small print, hints | Nunito Sans | 14 px | 400 | `--mbg-size-small` |
| Buttons | Nunito Sans | 16 px | 700 | `.btn` |
| Flourish | Alex Brush | 36 → 48 px | 400 | `.mbg-script` |

Alex Brush is **decoration only**, for flourishes such as a testimonial's opening quote mark. Never use it for information, buttons, or anything a client must read.

Headings are in the primary colour by default; card headings inside content use ink. Paragraphs stay under about 70 characters per line (`.mbg-readable`).

## 4. Shape and spacing

| Item | Value |
| --- | --- |
| Buttons, chips | Pill (fully rounded) |
| Cards, photos | 12 px corners |
| Inputs, badges, alerts | 8 px corners |
| Shadow | One soft shadow (`0 8px 24px` at 8% ink), for raised cards and the sticky header only |
| Spacing scale | 4, 8, 16, 24, 32, 48 px (`--mbg-space-1` to `--mbg-space-6`) |
| Section padding | 48 px on phones up to 80 px on desktop (`--mbg-section-y`) |
| Content width | At most 1140 px (`.mbg-container`) |

## 5. Components

All components are Bootstrap 5.3, themed by `tokens.css` and `theme.css`. See them rendered in the [live guide](style-guide/index.html).

### Buttons

| Class | Use | Look |
| --- | --- | --- |
| `.btn-book` | Book now and the booking steps | Deep navy, white text, rounded corners; the hero one has a sparkle and an arrow |
| `.btn-primary` | The main action of a page or dialog (Confirm payment, Save) | Primary blue, white text |
| `.btn-outline-primary` | Secondary actions (See gallery, Cancel) | Primary outline |
| Text link | Inline navigation | Primary colour, underlined on hover |

- Labels say what happens: "Upload proof", not "Submit".
- Disabled buttons are faded and have a reason nearby ("Choose a time first").
- While working, a button shows a spinner and a present-tense label ("Booking…") and can't be pressed again.

### Forms

- Labels above fields; optional fields say "(optional)".
- Errors appear under the field in the error colour with an icon and a plain message ("Enter a valid email address."), and the field gets a coloured border. Never rely on the border alone.
- Focus shows a primary-colour ring (`--mbg-focus`); keyboard focus is always visible.

### Cards and chips

- **Service card:** picture, name, where it is done, duration, price in accent text, deposit, Book button. Raised with the soft shadow (`.mbg-card-raised`).
- **Booking card and testimonial card:** flat, with a line border.
- **Chips** (`.mbg-chip`) for gallery filters; the selected chip is filled with the primary colour.

### Messages

Four alert types, each tinted with a coloured left edge and **always an icon**:

| Type | Use | Icon |
| --- | --- | --- |
| Info (light blue) | "We've emailed your payment instructions." | `bi-info-circle` |
| Success (mint) | "Payment received. Your booking is confirmed." | `bi-check-circle` |
| Warning (cream) | "Deposit due by Sun 11 Oct, 14:00." | `bi-clock` |
| Error (red) | "That time has just been booked. Please choose another." | `bi-x-circle` |

### Booking statuses

Every status has a word, an icon and a distinct shape, so they're distinguishable without colour (`.mbg-status-*`):

| Status | Look | Icon |
| --- | --- | --- |
| Pending | Cream, **dashed** outline | `bi-hourglass-split` |
| Confirmed | **Solid** green fill, white text | `bi-check-circle` |
| Completed | Light blue | `bi-stars` |
| No-show | Red tint, red outline | `bi-person-x` |
| Cancelled | Plain, **struck through** | `bi-x` |
| Expired | Plain, **struck through** | `bi-hourglass-bottom` |

### Date and time picker

The client booking page uses a Monday-first month calendar (`.mbg-calendar`) of square day buttons (`.mbg-day`, at least 44 px): white with a pale line, primary colour when selected (`.is-selected`, with `aria-pressed`), and faded and not clickable when the date is outside the booking window. Open times are pill-outline buttons (`.mbg-slot`) that fill with the primary colour when chosen (`.active`). The Continue button is the navy booking button (`.btn-book`). A day with no times shows the info alert "No times are available on this day. Please choose another date."

### Service status

In the admin Services table, **Active** is a solid green badge with a check icon (`.mbg-badge-active`), and **Inactive** is a dashed grey outline with a crossed-eye icon (`.mbg-badge-inactive`), and its whole row is greyed (`.mbg-row-inactive`). Word, icon and outline all differ, so it never relies on colour.

## 6. Logo

The demo's example business, Fresh Start, has a sample logo of bubbles and an iron (`demo-photos/logo-fresh-start.png`, drawn for this project). Otherwise the repository ships with **no logo**: each business uploads its own in the portal (Website, About tab, Logo), and until it does the business name is shown as text in the header. A neutral favicon is in `public/images/brand/`; replace it with your own.

| Where | What is shown |
| --- | --- |
| The header on every page | The logo, 48 px tall on desktop and phones (60 px on the sign-in page), or the name as text |
| The top of the home page | The logo, large, above the business name |
| The footer and the emails | The business name |

**Tips for a good logo:**

- A PNG with a **transparent background**, wider than it is tall, at least 1200 px wide, looks best in the header.
- Keep clear space around it; never stretch, squash, recolour or add effects.
- Place it on white or a light tint; never on a strong colour or a busy photo.
- The portal asks for a short description of it for people who can't see it; the default is the business name.

## 7. Photos

- Natural light and true colours. No heavy filters or retouching that changes the result clients will get.
- **Service cards:** a 4:3 picture (shown 14 rem tall). **Hero:** wide, 16:9. **Gallery:** portrait, 4:5.
- Rounded 12 px corners; sit on white or a light tint.
- Every photo has alt text describing it ("A tidy, sunlit kitchen"). Photo handling and metadata removal follow BR-16.

## 8. Accessibility

- All text meets WCAG 2.2 AA: 4.5:1 for normal text, 3:1 for large text (24 px, or 18.66 px bold). The accent colour `#3B8FE0` is only used for large text and decoration.
- Information never relies on colour alone: statuses, errors and alerts all have words and icons.
- Visible focus on every interactive element; the whole site works with a keyboard.
- Text sizes use `rem`, so the site respects the visitor's browser font size.
- Touch targets are at least 44 × 44 px on phones.

## 9. Using the tokens

```html
<link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css" rel="stylesheet">
<link href="https://cdn.jsdelivr.net/npm/bootstrap-icons@1.11.3/font/bootstrap-icons.min.css" rel="stylesheet">
<link href="/css/tokens.css" rel="stylesheet">
<link href="/css/theme.css" rel="stylesheet">
```

- `theme.css` defines every colour as a `--mbg-*` variable (and the `rgb` triplets Bootstrap needs). It is the only file to change to re-colour the site.
- `tokens.css` imports the three Google Fonts, defines every size, space and shape, sets Bootstrap's theme variables from the colours, and adds the site's classes (`.btn-book`, `.mbg-status-*`, `.mbg-chip`, `.mbg-label`, `.mbg-script`, `.mbg-section-*`).
- Use the variables, not raw hex codes, in any new CSS: `color: var(--mbg-accent-text);`.
- The calendar's status colours are in `public/js/admin-calendar.js` (FullCalendar needs real colour values); the tests check them too.
- Both CSS files are hand-formatted, so Prettier skips them. The live guide at `style-guide/index.html` loads them directly from `public/css/`.
- Every page shares one header and footer: `<site-header>` and `<site-footer>`, defined in `public/js/layout.js`. Page frame styles (header, footer, skip link) are in `public/css/site.css`. The business name, tagline and logo come from `public/js/brand.js`.

## 10. Decisions

| Decision | Why |
| --- | --- |
| Colours in their own file (`theme.css`) | A business re-colours the site by editing one file, and a private copy of the project can keep its own colours without conflicts when it takes new releases (`BRANDING.md`). |
| A calm blue with a deep navy action colour | Blue reads as clean and trustworthy for a home services business; the darkest, strongest blue marks the Book button, so it is always the easiest thing to find. Every pairing passes WCAG AA. |
| Josefin Sans, Nunito Sans, Alex Brush | Josefin gives headings a friendly geometric look, Nunito keeps details clear, Alex Brush is for rare decoration. |
| Light mode only | The owner's preference for v1. |
| Built on Bootstrap 5.3 | Matches the frontend stack in spec section 11; the tokens theme it instead of replacing it. |
