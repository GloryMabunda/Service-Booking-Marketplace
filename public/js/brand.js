// The business's own brand on every page: its name, tagline and logo, which the
// owner sets in the portal (Settings for the name, Website for the logo). The
// repository ships with no real brand: until the owner adds one, pages show a
// neutral name. Loaded before layout.js and admin.js.
//
//   <span data-brand-mark></span>      the logo, or the name as text when there is no logo
//   <span data-brand-name></span>      the name
//   <p data-brand-tagline></p>         the tagline (hidden when empty)
//   window.mbgBrand                    a promise of { name, tagline, logo }
//   window.mbgApplyBrand()             fills the page again, after new markup is added
//   window.mbgSetTitle('Services')     sets the page title to "Services · Name"
//
// Everything is added as text or as an image address, never as HTML.
(() => {
  const FALLBACK = { name: '', tagline: null, logo: null };
  const KEY = 'mbg-brand';
  const isAdmin = location.pathname.startsWith('/admin');

  let current = null;
  let baseTitle = document.title;
  try {
    current = JSON.parse(sessionStorage.getItem(KEY) ?? 'null');
  } catch {
    current = null;
  }

  function mark(box, brand) {
    box.replaceChildren();
    if (brand.logo) {
      const size = box.dataset.size === 'large' ? 60 : 48;
      const img = document.createElement('img');
      img.className =
        box.dataset.size === 'hero' ? 'mbg-hero-logo' : 'mbg-header-logo';
      img.src = (
        box.dataset.size === 'hero' ? brand.logo.large : brand.logo.thumb
      ).url;
      img.alt = brand.name;
      if (box.dataset.size !== 'hero') {
        img.height = size;
        img.width = Math.round(
          (size * brand.logo.thumb.width) / brand.logo.thumb.height,
        );
        img.style.width = 'auto';
        img.style.maxWidth = '100%';
      }
      box.append(img);
    } else if (brand.name) {
      const text = document.createElement('span');
      text.className = 'mbg-brand-text';
      text.textContent = brand.name;
      box.append(text);
    }
  }

  function applyTitle() {
    if (!current?.name) return;
    // The home page is called by the business's name alone
    document.title =
      baseTitle === 'Home'
        ? current.name
        : `${baseTitle} · ${current.name}${isAdmin ? ' admin' : ''}`;
  }

  function apply() {
    if (!current) return;
    for (const box of document.querySelectorAll('[data-brand-mark]'))
      mark(box, current);
    for (const el of document.querySelectorAll('[data-brand-name]')) {
      el.textContent = current.name;
    }
    for (const el of document.querySelectorAll('[data-brand-tagline]')) {
      el.textContent = current.tagline ?? '';
      el.hidden = !current.tagline;
    }
  }

  window.mbgApplyBrand = apply;
  window.mbgSetTitle = (text) => {
    baseTitle = text;
    applyTitle();
  };

  window.mbgBrand = fetch('/api/brand')
    .then((res) => (res.ok ? res.json() : FALLBACK))
    .catch(() => FALLBACK)
    .then((brand) => {
      current = brand;
      try {
        sessionStorage.setItem(KEY, JSON.stringify(brand));
      } catch {
        // No storage (a private window): the next page just asks again
      }
      apply();
      applyTitle();
      return brand;
    });

  // What we already know from the last page shows at once, with no flash
  document.addEventListener('DOMContentLoaded', () => {
    apply();
    applyTitle();
  });
})();
