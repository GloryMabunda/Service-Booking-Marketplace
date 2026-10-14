import type { NextFunction, Request, Response } from 'express';

// Headers that make a browser a safer place to run the site (#85, spec
// section 9). They are set on every response, before the page or answer is
// produced, so a route can still say something more specific (the booking
// page sets Referrer-Policy: no-referrer itself, which replaces the default
// below).

// What a page may load. Everything comes from this site, except Bootstrap
// (checked by the integrity hash on each tag) from jsDelivr and the fonts from
// Google. Nothing may be run from the page itself (no inline scripts), the
// page may not be put in a frame, and it may only send forms and requests back
// to this site.
const SITE_POLICY = [
  "default-src 'self'",
  "script-src 'self' https://cdn.jsdelivr.net",
  "style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://fonts.googleapis.com",
  "font-src 'self' https://cdn.jsdelivr.net https://fonts.gstatic.com data:",
  "img-src 'self' data:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

// The client's private booking page runs only this site's own scripts: no
// third-party code on a page whose address is a secret (BR-15, spec section 9)
const BOOKING_PAGE_POLICY = SITE_POLICY.replace(
  "script-src 'self' https://cdn.jsdelivr.net",
  "script-src 'self'",
);

// JSON answers and photos are never pages: nothing in them may load anything
const DATA_POLICY = "default-src 'none'; frame-ancestors 'none'";

// Browser features the site never uses are switched off
const PERMISSIONS_POLICY =
  'camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()';

// A proof file is shown by the browser's own viewer, which a content policy
// can get in the way of; it keeps the other protections (nosniff, the exact
// type, no framing) instead.
const isProofFile = (path: string) =>
  /^\/api\/admin\/payment-proofs\/[^/]+\/file$/.test(path);

export function policyFor(path: string): string | null {
  if (/^\/booking\/[^/]+\/?$/.test(path)) return BOOKING_PAGE_POLICY;
  if (isProofFile(path)) return null;
  if (path.startsWith('/api/') || path.startsWith('/media/'))
    return DATA_POLICY;
  return SITE_POLICY;
}

export function securityHeaders(options: { production: boolean }) {
  return (req: Request, res: Response, next: NextFunction): void => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    // Only the site's own address goes in a Referer, and only over HTTPS: pages
    // that hold secrets replace this with no-referrer
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', PERMISSIONS_POLICY);
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    const policy = policyFor(req.path);
    if (policy) res.setHeader('Content-Security-Policy', policy);
    // Tell browsers to use HTTPS only: sent in production, where the site is
    // served over HTTPS (never locally, where it would lock a browser out)
    if (options.production) {
      res.setHeader(
        'Strict-Transport-Security',
        'max-age=31536000; includeSubDomains',
      );
    }
    next();
  };
}
