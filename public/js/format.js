// Small formatting helpers shared by the public and admin pages (#31, #32).

// "650.00" → "R650"; "1200.50" → "R1,200.50". Amounts arrive from the API as
// strings with two decimals, so no floating-point maths is involved.
export function formatRand(amount) {
  const [rand, cents] = String(amount).split('.');
  const withSpaces = rand.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `R${withSpaces}${cents && cents !== '00' ? `.${cents}` : ''}`;
}

// 90 → "1h 30m"; 120 → "2h"; 45 → "45m"
export function formatDuration(minutes) {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `${rest}m`;
  return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`;
}

// Plain text into a new element: never builds HTML from data, so a service
// name or description can't inject markup.
export function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
