// Shared header and footer for every public page (#23), as two small Web
// Components. A page uses them like this:
//
//   <site-header current="services"></site-header>
//   <main id="main"> ... </main>
//   <site-footer></site-footer>
//
// `current` marks the matching menu link as the page you're on. The markup is
// rendered into the page itself (no shadow DOM), so Bootstrap and tokens.css
// style it like everything else. Layout rules: docs/style-guide.md.

const NAV_LINKS = [
  { id: 'about', label: 'About', href: '/#about' },
  { id: 'services', label: 'Services', href: '/services.html' },
  { id: 'gallery', label: 'Gallery', href: '/#gallery' },
  { id: 'policies', label: 'Booking info', href: '/#policies' },
  { id: 'contact', label: 'Contact', href: '/#contact' },
  { id: 'lookup', label: 'Find my booking', href: '/lookup.html' },
];

// In demo mode (docs/demo.md) every page says so, and points to the demo
// mailbox where the emails appear. /api/health says whether this is a demo.
async function showDemoBanner(header) {
  try {
    const res = await fetch('/api/health', { cache: 'no-store' });
    if (!res.ok || !(await res.json()).demo) return;
  } catch {
    return;
  }
  const bar = document.createElement('div');
  bar.className = 'mbg-demo-banner text-center small py-2 px-3';
  bar.setAttribute('role', 'note');
  bar.append(
    document.createTextNode(
      'Demo: nothing here is real and no email is sent. ',
    ),
  );
  const link = document.createElement('a');
  link.href = '/demo-mailbox.html';
  link.textContent = 'Open the demo mailbox';
  bar.append(link);
  header.prepend(bar);
}

class SiteHeader extends HTMLElement {
  connectedCallback() {
    const current = this.getAttribute('current');
    const links = NAV_LINKS.map((link) => {
      const active = link.id === current;
      return `<li class="nav-item"><a class="nav-link${active ? ' active' : ''}" href="${link.href}"${active ? ' aria-current="page"' : ''}>${link.label}</a></li>`;
    }).join('');

    this.innerHTML = `
      <a class="visually-hidden-focusable mbg-skip-link" href="#main">Skip to main content</a>
      <header class="mbg-site-header sticky-top">
        <nav class="navbar navbar-expand-lg" aria-label="Main">
          <div class="mbg-container w-100 d-flex flex-wrap align-items-center justify-content-between">
            <a class="navbar-brand py-0" href="/" aria-label="Home">
              <span data-brand-mark></span>
            </a>
            <button class="navbar-toggler" type="button" data-bs-toggle="collapse" data-bs-target="#site-nav" aria-controls="site-nav" aria-expanded="false" aria-label="Open the menu">
              <span class="navbar-toggler-icon"></span>
            </button>
            <div class="collapse navbar-collapse" id="site-nav">
              <ul class="navbar-nav ms-auto align-items-lg-center gap-lg-1">
                ${links}
                <li class="nav-item ms-lg-2 my-2 my-lg-0">
                  <a class="btn btn-book" href="/services.html">Book now</a>
                </li>
              </ul>
            </div>
          </div>
        </nav>
      </header>`;
    window.mbgApplyBrand?.();
    showDemoBanner(this);
  }
}

class SiteFooter extends HTMLElement {
  connectedCallback() {
    const year = new Date().getFullYear();
    this.innerHTML = `
      <footer class="mbg-site-footer">
        <div class="mbg-container d-flex flex-column flex-md-row flex-wrap justify-content-between gap-3">
          <div>
            <p class="mbg-footer-name mb-1" data-brand-name></p>
            <p class="mb-0 small" data-brand-tagline hidden></p>
          </div>
          <nav aria-label="Footer">
            <ul class="list-unstyled d-flex flex-wrap gap-3 mb-0 small">
              <li><a href="/lookup.html">Find my booking</a></li>
              <li><a href="/#policies">Booking info</a></li>
              <li><a href="/#contact">Contact</a></li>
            </ul>
          </nav>
        </div>
        <div class="mbg-container mt-3">
          <p class="mb-0 small mbg-footer-legal">© ${year} <span data-brand-name></span>. All rights reserved.</p>
        </div>
      </footer>`;
    window.mbgApplyBrand?.();
  }
}

customElements.define('site-header', SiteHeader);
customElements.define('site-footer', SiteFooter);
