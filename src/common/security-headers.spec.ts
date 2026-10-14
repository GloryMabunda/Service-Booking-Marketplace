import type { Request, Response } from 'express';
import { policyFor, securityHeaders } from './security-headers.js';

function run(path: string, production: boolean) {
  const headers = new Map<string, string>();
  const res = {
    setHeader: (name: string, value: string) => headers.set(name, value),
  } as unknown as Response;
  let called = false;
  securityHeaders({ production })({ path } as Request, res, () => {
    called = true;
  });
  return { headers, called };
}

const directive = (policy: string, name: string) =>
  policy
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name} `));

describe('securityHeaders', () => {
  it('sets the safe defaults on every response and passes the request on', () => {
    const { headers, called } = run('/', false);
    expect(called).toBe(true);
    expect(headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(headers.get('X-Frame-Options')).toBe('DENY');
    expect(headers.get('Referrer-Policy')).toBe(
      'strict-origin-when-cross-origin',
    );
    expect(headers.get('Cross-Origin-Opener-Policy')).toBe('same-origin');
    expect(headers.get('Permissions-Policy')).toContain('camera=()');
    expect(headers.get('Permissions-Policy')).toContain('geolocation=()');
    expect(headers.get('Content-Security-Policy')).toBeDefined();
  });

  it('asks for HTTPS only in production', () => {
    expect(run('/', true).headers.get('Strict-Transport-Security')).toBe(
      'max-age=31536000; includeSubDomains',
    );
    // Never locally: it would lock a browser out of http://localhost
    expect(run('/', false).headers.has('Strict-Transport-Security')).toBe(
      false,
    );
  });
});

describe('the content policy', () => {
  it('lets a site page use its own files, Bootstrap from jsDelivr and the fonts, and nothing else', () => {
    const policy = policyFor('/services.html') as string;
    expect(directive(policy, 'default-src')).toBe("default-src 'self'");
    expect(directive(policy, 'script-src')).toBe(
      "script-src 'self' https://cdn.jsdelivr.net",
    );
    expect(directive(policy, 'style-src')).toContain(
      'https://fonts.googleapis.com',
    );
    expect(directive(policy, 'font-src')).toContain(
      'https://fonts.gstatic.com',
    );
    expect(directive(policy, 'connect-src')).toBe("connect-src 'self'");
    expect(directive(policy, 'object-src')).toBe("object-src 'none'");
    expect(directive(policy, 'frame-ancestors')).toBe("frame-ancestors 'none'");
    expect(directive(policy, 'form-action')).toBe("form-action 'self'");
    expect(directive(policy, 'base-uri')).toBe("base-uri 'self'");
  });

  it('never allows a script to run from the page itself', () => {
    for (const path of ['/', '/admin/', '/booking/abc']) {
      const scripts = directive(
        policyFor(path) as string,
        'script-src',
      ) as string;
      expect(scripts).not.toContain('unsafe-inline');
      expect(scripts).not.toContain('unsafe-eval');
      expect(scripts).not.toContain('*');
    }
  });

  it('allows only this site’s own scripts on the private booking page', () => {
    expect(
      directive(
        policyFor(
          '/booking/RTrLxBUufMPCX9PZ3FNHWnA78RWMwcUufBlJlumAFv8',
        ) as string,
        'script-src',
      ),
    ).toBe("script-src 'self'");
    expect(directive(policyFor('/booking/abc/') as string, 'script-src')).toBe(
      "script-src 'self'",
    );
  });

  it('allows nothing at all for answers and photos', () => {
    for (const path of [
      '/api/services',
      '/api/admin/bookings',
      '/api/booking/abc/proofs',
      '/media/abc.webp',
    ]) {
      expect(policyFor(path)).toBe(
        "default-src 'none'; frame-ancestors 'none'",
      );
    }
  });

  it('leaves a proof file to the browser’s viewer, with the other protections', () => {
    expect(policyFor('/api/admin/payment-proofs/0000/file')).toBeNull();
    expect(
      run('/api/admin/payment-proofs/0000/file', false).headers.get(
        'X-Frame-Options',
      ),
    ).toBe('DENY');
  });

  it('is not fooled by a path that only looks like the booking page', () => {
    for (const path of [
      '/booking',
      '/booking/',
      '/booking/a/b',
      '/bookings/abc',
      '/x/booking/abc',
    ]) {
      expect(directive(policyFor(path) as string, 'script-src')).not.toBe(
        "script-src 'self'",
      );
    }
  });
});
