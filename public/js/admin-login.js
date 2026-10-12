// Admin login page (#27): sends the email and password to POST
// /api/auth/login and, on success, goes to the portal page the owner was
// trying to open (?next=/admin/...), or the portal home.

const form = document.querySelector('#login-form');
const button = document.querySelector('#login-button');
const errorBox = document.querySelector('#login-error');
const errorText = document.querySelector('#login-error-text');

// Only portal pages on this site, never another website (open redirect).
function nextPage() {
  const next = new URLSearchParams(location.search).get('next');
  return next && /^\/admin\/[\w\-./]*$/.test(next) && !next.includes('..')
    ? next
    : '/admin/';
}

// Already signed in? Go straight to the portal.
fetch('/api/auth/me').then((res) => {
  if (res.ok) location.replace(nextPage());
});

function showError(message) {
  errorText.textContent = message;
  errorBox.classList.remove('d-none');
}

function showFieldErrors(details) {
  for (const { field, message } of details ?? []) {
    const input = form.elements.namedItem(field);
    const feedback = document.querySelector(`#${field}-error`);
    if (input && feedback) {
      input.classList.add('is-invalid');
      feedback.textContent = message;
    }
  }
}

function clearErrors() {
  errorBox.classList.add('d-none');
  for (const input of form.querySelectorAll('.is-invalid')) {
    input.classList.remove('is-invalid');
  }
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  clearErrors();
  button.disabled = true;
  button.innerHTML =
    '<span class="spinner-border spinner-border-sm me-2" aria-hidden="true"></span>Signing in…';

  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: form.email.value,
        password: form.password.value,
      }),
    });

    if (res.ok) {
      location.assign(nextPage());
      return;
    }

    const body = await res.json().catch(() => ({}));
    if (res.status === 400) {
      showFieldErrors(body.details);
    } else if (res.status === 401) {
      showError('The email or password is incorrect.');
      form.password.value = '';
      form.password.focus();
    } else if (res.status === 429) {
      const minutes = Math.ceil(Number(res.headers.get('Retry-After')) / 60);
      showError(
        `Too many attempts. Please try again in ${minutes} minute${minutes === 1 ? '' : 's'}.`,
      );
    } else {
      showError('Something went wrong. Please try again.');
    }
  } catch {
    showError("Can't reach the server. Check your connection and try again.");
  } finally {
    button.disabled = false;
    button.textContent = 'Sign in';
  }
});
