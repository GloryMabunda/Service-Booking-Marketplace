# Style Guide

*Make Up by Glory · v1 · for [Specification v1.0](specification.md), sections 9 and 11*

How every page of the booking site looks: colours, type, shapes, components, logo and photos (#103). The live version, with every component rendered, is [`style-guide/index.html`](style-guide/index.html): open it in a browser. The values below are implemented as CSS variables in [`style-guide/tokens.css`](style-guide/tokens.css), which the frontend loads after Bootstrap 5.3 (#23).

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

- **The work is the star.** Gallery and service photos carry the most colour; the page supports them.
- **From the logo.** Every colour and the script font come from the Make Up by Glory logo, so the site and the brand feel like one thing.
- **Booking is always obvious.** Orange means "book". There is at most one Book now per view.
- **Readable for everyone.** All text meets WCAG 2.2 AA contrast; nothing relies on colour alone.

## 2. Colours

Taken from the logo's ink and lip splash (Option C, the full splash palette).

| Role | Name | Hex | Used for | Contrast |
| --- | --- | --- | --- | --- |
| Primary | Magenta | `#A02080` | Primary buttons, links, headings | White on it 7.0:1 |
| Primary hover | Magenta dark | `#831A69` | Hover and pressed states | |
| Action | Orange | `#FFA040` | **Book now** and the booking steps only | Text `#3A1A00` on it 7.8:1 |
| Bright | Pink | `#E04060` | Large headings (24 px and up), the "by Glory" flourish, decoration, backgrounds | 4.1:1 on white: **never small text** |
| Pink text | Pink text | `#C42B52` | Small pink text: prices, section labels, form errors | 5.5:1 on white |
| Highlight | Gold | `#FFC060` | Stars, highlights | Decoration only |
| Success | Green | `#2E7D3E` | Confirmed status, "payment received" | White on it 5.1:1 |
| Logo ink | Plum | `#673656` | The logo, footer background | 9.4:1 on white |
| Text | Ink | `#2A1A26` | Body text | 16.5:1 on white |
| Text | Muted | `#7A5A6E` | Secondary text, hints | 6.0:1 on white |
| Lines | Line | `#F1D9E4` | Borders, dividers | |

**Section tints** for alternating section backgrounds and message boxes: pink `#FFE3EC`, cream `#FFF1D6`, lilac `#F3E3F6`, mint `#E9F6EC`, blush `#FFF6F9`. The hero uses a soft gradient of pink, cream and lilac.

**Rules that keep the palette from getting busy:**

1. One bright colour leads each section; the others only decorate.
2. Photos sit on white or a light tint, never on a bright colour.
3. Orange is reserved for booking, so clients always know where to click.
4. Statuses and messages always pair colour with a word and an icon.

## 3. Typography

Three Google Fonts, all licensed for websites: **Josefin Sans** echoes the art-deco "MAKEUP BY" lettering in the logo; **Nunito Sans** keeps booking details clear; **Alex Brush** is the logo's own script. The logo itself is always an image, so its Bellerose lettering is never replaced by a web font.

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

Alex Brush is **decoration only**, for flourishes like "by Glory" or a testimonial's opening quote mark. Never use it for information, buttons, or anything a client must read.

Headings are magenta by default; card headings inside content use ink. Paragraphs stay under about 70 characters per line (`.mbg-readable`).

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

All components are Bootstrap 5.3, themed by `tokens.css`. See them rendered in the [live guide](style-guide/index.html).

### Buttons

| Class | Use | Look |
| --- | --- | --- |
| `.btn-book` | Book now and the booking steps | Orange, dark-brown text |
| `.btn-primary` | The main action of a page or dialog (Confirm payment, Save) | Magenta, white text |
| `.btn-outline-primary` | Secondary actions (See gallery, Cancel) | Magenta outline |
| Text link | Inline navigation | Magenta, underlined on hover |

- Labels say what happens: "Upload proof", not "Submit".
- Disabled buttons are faded and have a reason nearby ("Choose a time first").
- While working, a button shows a spinner and a present-tense label ("Booking…") and can't be pressed again.

### Forms

- Labels above fields; optional fields say "(optional)".
- Errors appear under the field in pink text (`#C42B52`) with an icon and a plain message ("Enter a valid email address."), and the field gets a pink border. Never rely on the red border alone.
- Focus shows a magenta ring (`--mbg-focus`); keyboard focus is always visible.

### Cards and chips

- **Service card:** photo, name, duration, price in pink text, deposit, Book and Photos buttons. Raised with the soft shadow (`.mbg-card-raised`).
- **Booking card and testimonial card:** flat, with a line border.
- **Chips** (`.mbg-chip`) for gallery filters; the selected chip is filled magenta.

### Messages

Four alert types, each tinted with a coloured left edge and **always an icon**:

| Type | Use | Icon |
| --- | --- | --- |
| Info (lilac) | "We've emailed your payment instructions." | `bi-info-circle` |
| Success (mint) | "Payment received. Your booking is confirmed." | `bi-check-circle` |
| Warning (cream) | "Deposit due by Sun 11 Oct, 14:00." | `bi-clock` |
| Error (pink) | "That time has just been booked. Please choose another." | `bi-x-circle` |

### Booking statuses

Every status has a word, an icon and a distinct shape, so they're distinguishable without colour (`.mbg-status-*`):

| Status | Look | Icon |
| --- | --- | --- |
| Pending | Cream, **dashed** outline | `bi-hourglass-split` |
| Confirmed | **Solid** green fill, white text | `bi-check-circle` |
| Completed | Lilac | `bi-stars` |
| No-show | Pink tint, pink outline | `bi-person-x` |
| Cancelled | Plain, **struck through** | `bi-x` |
| Expired | Plain, **struck through** | `bi-hourglass-bottom` |

## 6. Logo

The master logo is the white-background version supplied by the owner. The versions below were made from it with transparent backgrounds.

| File | What it is | Where it goes |
| --- | --- | --- |
| `logo/logo-horizontal.png` | Lips icon and lettering side by side | **The header on every page**: 48 px tall on desktop, 40 px on phones |
| `logo/logo.png` (1200 px), `logo/logo-600.png` | The full logo with brushes | **Large at the top of the home page**; footer, emails, social posts |
| `logo/logo-icon-512.png` | The lips only | Small spaces, social profile images |
| `logo/favicon-64.png` | The lips at 64 px | Browser tab icon |
| `logo/wordmark.png` | "MAKEUP BY Glory" lettering only | Building other layouts; pair it with the icon |

**Rules:**

- Keep clear space around the logo of at least the height of the "M".
- Never stretch, squash, recolour, rotate or add effects.
- Place it on white or a light tint; never on a strong colour or a busy photo.
- Always give it alt text: "Make Up by Glory".

## 7. Photos

- Natural light, true skin tones, faces in focus. No colour filters or heavy retouching that changes the result clients will get.
- **Gallery:** portrait, 4:5. **Hero:** wide, 16:9. Service cards: 4:3.
- Rounded 12 px corners; sit on white or a light tint.
- Every photo has alt text describing the look ("Bride with soft glam makeup"). Photo handling and metadata removal follow BR-16.

## 8. Accessibility

- All text meets WCAG 2.2 AA: 4.5:1 for normal text, 3:1 for large text (24 px, or 18.66 px bold). The bright pink `#E04060` is only used for large text and decoration.
- Information never relies on colour alone: statuses, errors and alerts all have words and icons.
- Visible focus on every interactive element; the whole site works with a keyboard.
- Text sizes use `rem`, so the site respects the visitor's browser font size.
- Touch targets are at least 44 × 44 px on phones.

## 9. Using the tokens

```html
<link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css" rel="stylesheet">
<link href="https://cdn.jsdelivr.net/npm/bootstrap-icons@1.11.3/font/bootstrap-icons.min.css" rel="stylesheet">
<link href="/css/tokens.css" rel="stylesheet">
```

- `tokens.css` imports the three Google Fonts, defines every colour, size, space and shape as a `--mbg-*` variable, sets Bootstrap's theme variables, and adds the brand classes (`.btn-book`, `.mbg-status-*`, `.mbg-chip`, `.mbg-label`, `.mbg-script`, `.mbg-section-*`).
- Use the variables, not raw hex codes, in any new CSS: `color: var(--mbg-pink-text);`.
- When the frontend is set up (#23), copy `tokens.css` and the logo files into `public/`. This folder stays the reference.

## 10. Decisions

| Decision | Why |
| --- | --- |
| Colours from the full lip splash (Option C) | The owner's choice from four options; bold and playful like the logo. Two colours were adjusted for readability: the green darkened to `#2E7D3E` and a deeper pink added for small text. |
| Josefin Sans, Nunito Sans, Alex Brush | Josefin echoes the logo's art-deco lettering, Nunito keeps details clear, Alex Brush is the logo's script. Bellerose (the logo's capitals) isn't available as a web font. |
| Horizontal lockup in the header, full logo large on the home page | The square logo's lettering is unreadable at header height; the lockup is about three times larger at the same height. The full logo still greets visitors at the top of the home page. |
| Light mode only | The owner's preference for v1. |
| Built on Bootstrap 5.3 | Matches the frontend stack in spec section 11; `tokens.css` themes it instead of replacing it. |
