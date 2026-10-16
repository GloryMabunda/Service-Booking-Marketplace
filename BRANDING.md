# Branding

This repository ships with **no real business's brand**. There is no business name in the code and no logo file except the demo's sample logo (the Fresh Start iron and bubbles in `demo-photos/`, loaded only by the demo data): a fresh install shows the neutral name "Your Business" and no logo. Each business brings its own name and logo, and sets them in the owner's portal, so they are stored in that business's own database and uploads and never in Git.

## Make it yours

Sign in to the portal (`/admin/`) and:

| What | Where | Used in |
| --- | --- | --- |
| **Business name** | Settings, "Your business" | The header and footer, page titles, and every email (the sign-off too) |
| **Logo** | Website, About tab, "Logo" | The header, the home page and the private booking page. A PNG with a transparent background looks best. Without a logo the business name is shown as text |
| **Tagline** | Website, About tab | The footer and the home page |
| **Contact, banking, social links** | Settings and Website | Emails, the booking page, the home page |

There is nothing to edit in the code. Changes show on the site within a minute.

| The site, with the sample logo | Where the owner uploads it |
| --- | --- |
| ![The home page with a logo](docs/images/home.jpg) | ![The Website page with the logo uploader](docs/images/admin-website.jpg) |

## A little more

- **Favicon:** replace [`public/images/brand/favicon-64.png`](public/images/brand/favicon-64.png) with a 64 px PNG of your own. It is the one brand file in the site's own files, and it is the sample Fresh Start mark (an iron and bubbles).
- **Colours:** every colour is in one file, [`public/css/theme.css`](public/css/theme.css). Change the values there (the default is a calm blue); the fonts, sizes and shapes are in [`public/css/tokens.css`](public/css/tokens.css). A private copy of the project can keep its own `theme.css` so new releases never replace its colours. [`docs/style-guide.md`](docs/style-guide.md) explains each one, and the contrast checks in the tests tell you if a new colour is too faint to read.
- **Wording:** the emails are in [`src/notifications/`](src/notifications/), the page text in [`public/`](public/).

## Keeping it neutral

An automated check (`src/common/brand-neutral.spec.ts`) fails if a real business name, a first name or a logo file is added to the shipped code, so the repository stays free of anyone's real brand. The example business, Fresh Start, is imaginary.

## About "Make Up by Glory"

The project was first built around a real business, **Make Up by Glory**. That name, its logo and its look are the property of its owner, Glory Mabunda, and are **not** covered by this repository's MIT licence, wherever they appear (including earlier versions of the repository). The example business now is the imaginary **Fresh Start**, whose sample logo is part of the project. The licence covers the code. Please use your own name and logo.
