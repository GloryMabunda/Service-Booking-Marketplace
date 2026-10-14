// Shared code for every admin portal page (#27).
//
//   <admin-header></admin-header>   the portal header with Sign out
//
// On load it asks the API who is signed in. Without a session the page sends
// the owner to the login page, which brings her back here afterwards. The
// pages hold no data themselves: everything comes from /api/admin, which the
// server protects whatever the browser does.

const loginUrl = () =>
  `/admin/login.html?next=${encodeURIComponent(location.pathname)}`;

// The signed-in user ({ email, role }); never resolves if not signed in.
export const currentUser = fetch('/api/auth/me').then(async (res) => {
  if (res.status === 401) {
    location.replace(loginUrl());
    return new Promise(() => {});
  }
  if (!res.ok) throw new Error(`Could not check the session (${res.status})`);
  const body = await res.json();
  document.documentElement.classList.add('mbg-signed-in');
  return body.user;
});

// Calls an API path as the signed-in admin and returns { ok, status, data }
// (data is the parsed JSON, or null for a 204). If the session has ended it
// sends the owner to the login page and comes back here afterwards.
export async function adminApi(method, path, payload) {
  const res = await fetch(path, {
    method,
    headers: payload ? { 'Content-Type': 'application/json' } : undefined,
    body: payload ? JSON.stringify(payload) : undefined,
  });
  if (res.status === 401) {
    location.assign(
      `/admin/login.html?next=${encodeURIComponent(location.pathname)}`,
    );
    return new Promise(() => {});
  }
  const data = res.status === 204 ? null : await res.json().catch(() => null);
  return { ok: res.ok, status: res.status, data };
}

async function signOut() {
  await fetch('/api/auth/logout', { method: 'POST' });
  location.assign('/admin/login.html');
}

// The portal menu. <admin-header current="services"> marks that page.
const ADMIN_LINKS = [
  { id: 'dashboard', label: 'Dashboard', href: '/admin/' },
  { id: 'bookings', label: 'Bookings', href: '/admin/bookings.html' },
  { id: 'calendar', label: 'Calendar', href: '/admin/calendar.html' },
  { id: 'services', label: 'Services', href: '/admin/services.html' },
  {
    id: 'availability',
    label: 'Availability',
    href: '/admin/availability.html',
  },
  { id: 'settings', label: 'Settings', href: '/admin/settings.html' },
];

class AdminHeader extends HTMLElement {
  connectedCallback() {
    const current = this.getAttribute('current') ?? 'dashboard';
    const links = ADMIN_LINKS.map((link) => {
      const active = link.id === current;
      return `<li class="nav-item"><a class="nav-link${active ? ' active' : ''}" href="${link.href}"${active ? ' aria-current="page"' : ''}>${link.label}</a></li>`;
    }).join('');
    this.innerHTML = `
      <header class="mbg-site-header">
        <div class="mbg-container d-flex flex-wrap align-items-center justify-content-between gap-2 py-2">
          <a class="d-flex align-items-center gap-3 text-decoration-none" href="/admin/">
            <img class="mbg-header-logo" src="/images/logo/logo-horizontal.png" alt="Make Up by Glory" width="138" height="48">
            <span class="mbg-label d-none d-sm-inline">Admin portal</span>
          </a>
          <nav aria-label="Admin portal">
            <ul class="navbar-nav flex-row gap-3">${links}</ul>
          </nav>
          <div class="d-flex align-items-center gap-3">
            <span class="small text-secondary d-none d-lg-inline" data-user-email></span>
            <button class="btn btn-outline-primary btn-sm" type="button" data-sign-out>
              <i class="bi bi-box-arrow-right me-1" aria-hidden="true"></i>Sign out
            </button>
          </div>
        </div>
      </header>`;
    this.querySelector('[data-sign-out]').addEventListener('click', signOut);
    currentUser.then((user) => {
      this.querySelector('[data-user-email]').textContent = user.email;
    });
  }
}

customElements.define('admin-header', AdminHeader);
