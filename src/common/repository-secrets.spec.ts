import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { extname } from 'node:path';

// No secrets in the repository (#85, spec section 9). Every file Git tracks is
// read and checked for the shapes real secrets take, and for the files that
// must never be tracked at all.

function trackedFiles(): string[] | null {
  try {
    return execFileSync('git', ['ls-files'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
      .split('\n')
      .filter(Boolean);
  } catch {
    return null; // not a Git checkout (for example a downloaded copy)
  }
}

const tracked = trackedFiles();
const TEXT = new Set([
  '.ts',
  '.js',
  '.mjs',
  '.cjs',
  '.json',
  '.md',
  '.html',
  '.css',
  '.yml',
  '.yaml',
  '.sql',
  '.example',
  '.txt',
  '.cmd',
  '.sh',
  '',
]);
const textFiles = (tracked ?? []).filter(
  (f) => TEXT.has(extname(f)) && !f.endsWith('package-lock.json'),
);

// Each pattern is the shape of a real credential, so a hit is worth a look
const SECRET_SHAPES: [string, RegExp][] = [
  [
    'a private key',
    /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----/,
  ],
  ['an AWS access key', /\bAKIA[0-9A-Z]{16}\b/],
  ['a GitHub token', /\bgh[pousr]_[A-Za-z0-9]{36,}\b/],
  ['a GitHub fine-grained token', /\bgithub_pat_[A-Za-z0-9_]{50,}\b/],
  ['a Slack token', /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/],
  ['a live Stripe key', /\b[sr]k_live_[A-Za-z0-9]{16,}\b/],
  ['a Google API key', /\bAIza[0-9A-Za-z_-]{35}\b/],
  ['a SendGrid key', /\bSG\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\b/],
  [
    'a JSON web token',
    /\beyJ[A-Za-z0-9_-]{15,}\.eyJ[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{10,}\b/,
  ],
  [
    'a database password for a real server',
    // Only the exact local hosts (and a ${variable}) are allowed; "db.example.com" is not
    /postgres(?:ql)?:\/\/[^:\s/]+:[^@\s]+@(?!(?:localhost|127\.0\.0\.1|db|host)(?:[:/\s'"`]|$)|\$)/i,
  ],
  ['an SMTP password', /^\s*SMTP_PASSWORD\s*=\s*\S+/m],
  [
    'a long hex secret',
    /(?:secret|token|api[_-]?key|private[_-]?key)\s*[:=]\s*['"][0-9a-f]{40,}['"]/i,
  ],
];

// Files where a secret-looking value is a harmless, labelled example or a test
const MAY_CONTAIN_EXAMPLES = [
  /^tests\//,
  /\.spec\.ts$/,
  /^docs\//,
  /^README\.md$/,
  /^\.env\.example$/,
];

describe.skipIf(!tracked)('the repository holds no secrets', () => {
  it('reads the tracked files, so the checks below are not empty', () => {
    expect(textFiles.length).toBeGreaterThan(150);
    expect(textFiles).toContain('src/main.ts');
  });

  it.each(['.env', '.env.local', '.env.production', 'uploads'])(
    'does not track %s',
    (name) => {
      const hit = (tracked ?? []).filter(
        (f) => f === name || f.startsWith(`${name}/`),
      );
      expect(hit).toEqual([]);
    },
  );

  it('does not track any .env file except the example', () => {
    const envFiles = (tracked ?? []).filter((f) => /(^|\/)\.env(\.|$)/.test(f));
    expect(envFiles).toEqual(['.env.example']);
  });

  it('tells Git to ignore the files that hold secrets and uploads', () => {
    const ignore = readFileSync('.gitignore', 'utf8');
    expect(ignore).toMatch(/^\.env$/m);
    expect(ignore).toMatch(/^\.env\.\*$/m);
    expect(ignore).toMatch(/^!\.env\.example$/m);
    expect(ignore).toMatch(/^uploads\/$/m);
  });

  it.each(SECRET_SHAPES)('has nothing that looks like %s', (name, pattern) => {
    const hits: string[] = [];
    for (const file of textFiles) {
      if (
        MAY_CONTAIN_EXAMPLES.some((p) => p.test(file)) &&
        !/private key|AWS|GitHub|Slack|live Stripe|Google|SendGrid/.test(name)
      ) {
        continue;
      }
      if (pattern.test(readFileSync(file, 'utf8'))) hits.push(file);
    }
    expect(hits, `files that look like they hold ${name}`).toEqual([]);
  });

  it('keeps the example settings free of real values', () => {
    const example = readFileSync('.env.example', 'utf8');
    for (const secret of [
      'SMTP_PASSWORD',
      'SMTP_USER',
      'MAIL_FROM',
      'SMTP_HOST',
      'PUBLIC_URL',
    ]) {
      expect(example, secret).toMatch(new RegExp(`^${secret}=\\s*$`, 'm'));
    }
    // The only password is a plain warning to choose your own
    expect(example).toMatch(/^ADMIN_PASSWORD=change-me-to-a-long-password$/m);
    // The database address is the local one from docker-compose
    expect(example).toMatch(
      /^DATABASE_URL=postgres:\/\/booking:booking@localhost:5432\/booking$/m,
    );
  });

  it('seeds the banking details as placeholders, never real ones', () => {
    const seed = readFileSync(
      'src/database/migrations/1791902376363_seed_settings.ts',
      'utf8',
    );
    expect(seed).toContain("const PLACEHOLDER = 'Not set yet'");
    expect(seed).not.toMatch(/\b\d{9,}\b/); // no account number
  });

  it('keeps the test passwords in tests only', () => {
    const outsideTests = textFiles.filter(
      (f) => !MAY_CONTAIN_EXAMPLES.some((p) => p.test(f)),
    );
    for (const file of outsideTests) {
      expect(readFileSync(file, 'utf8'), file).not.toContain(
        'test-admin-password',
      );
    }
  });
});

describe('the secret scanner itself', () => {
  // Made-up samples with the shape of each credential. If one stops being
  // caught, the scan above has quietly stopped protecting anything.
  const SAMPLES: Record<string, string> = {
    'a private key': '-----BEGIN RSA PRIVATE KEY-----\nMIIE',
    'an AWS access key': 'aws_key = "AKIAIOSFODNN7EXAMPLE"',
    'a GitHub token': `token: ghp_${'a'.repeat(36)}`,
    'a GitHub fine-grained token': `github_pat_${'A1b2'.repeat(15)}`,
    'a Slack token': 'xoxb-1234567890-abcdefghij',
    'a live Stripe key': `sk_live_${'a1B2'.repeat(6)}`,
    'a Google API key': `AIza${'a1B2c3D4e5'.repeat(3)}abcde`,
    'a SendGrid key': `SG.${'a'.repeat(22)}.${'b'.repeat(22)}`,
    'a JSON web token': `eyJ${'a'.repeat(20)}.eyJ${'b'.repeat(20)}.${'c'.repeat(20)}`,
    'a database password for a real server':
      'postgres://admin:hunter2@db.example-hosting.com:5432/app',
    'an SMTP password': 'SMTP_PASSWORD=correct-horse-battery',
    'a long hex secret': `api_key = "${'ab12'.repeat(12)}"`,
  };

  it.each(SECRET_SHAPES)('catches %s', (name, pattern) => {
    expect(SAMPLES[name], `a sample for ${name}`).toBeDefined();
    expect(pattern.test(SAMPLES[name])).toBe(true);
  });

  it.each([
    'postgres://booking:booking@localhost:5432/booking',
    'postgres://user:pass@127.0.0.1/test',
    'SMTP_PASSWORD=',
    'const token = hashBookingToken(raw);',
    'ghp_short',
  ])('leaves %j alone', (text) => {
    for (const [, pattern] of SECRET_SHAPES)
      expect(pattern.test(text)).toBe(false);
  });
});
