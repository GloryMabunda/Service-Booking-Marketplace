import { escapeHtml } from './email-format.js';
import type { RenderedEmail } from './payment-instructions.template.js';

// A small set of building blocks the emails are written in. Each block is
// turned into plain text and into HTML, so the two versions always say the
// same thing (docs/emails.md section 1).
export type Block =
  | { p: string }
  | { rows: [label: string, value: string][] }
  | { callout: string }
  | { button: { label: string; url: string } };

export interface Business {
  name: string;
  email: string;
  phone: string | null;
}

const INK = '#2A1A26';
const MAGENTA = '#A02080';
const ORANGE = '#FFA040';

function textOf(block: Block): string {
  if ('p' in block) return block.p;
  if ('callout' in block) return block.callout;
  if ('button' in block) return `${block.button.label}: ${block.button.url}`;
  const width = Math.max(...block.rows.map(([label]) => label.length)) + 2;
  return block.rows
    .map(([label, value]) => `${`${label}:`.padEnd(width)}${value}`)
    .join('\n');
}

function htmlOf(block: Block): string {
  if ('p' in block) {
    return `<p>${escapeHtml(block.p).replace(/\n/g, '<br>')}</p>`;
  }
  if ('callout' in block) {
    return `<p style="border-left:4px solid ${MAGENTA};padding:8px 12px;background:#faf2f8"><strong>${escapeHtml(block.callout)}</strong></p>`;
  }
  if ('button' in block) {
    return `<p><a href="${escapeHtml(block.button.url)}" style="display:inline-block;background:${ORANGE};color:${INK};text-decoration:none;font-weight:bold;padding:12px 20px;border-radius:6px">${escapeHtml(block.button.label)}</a></p>`;
  }
  const rows = block.rows
    .map(
      ([label, value]) =>
        `<tr><td style="padding:2px 12px 2px 0;color:#6b5a66">${escapeHtml(label)}</td><td style="padding:2px 0"><strong>${escapeHtml(value)}</strong></td></tr>`,
    )
    .join('');
  return `<table role="presentation" style="border-collapse:collapse;margin:0 0 16px">${rows}</table>`;
}

// The footer for emails to a client
export function clientFooter(business: Business): string[] {
  return [
    business.name,
    [business.email, business.phone].filter(Boolean).join(' · '),
    '',
    'Questions? Just reply to this email.',
    `You're receiving this because you made a booking with ${business.name}.`,
  ];
}

// The footer for emails to the owner
export function ownerFooter(portalUrl: string): string[] {
  return [
    `Sent by your booking system. Manage this booking in the portal: ${portalUrl}`,
  ];
}

export function renderEmail(
  subject: string,
  blocks: Block[],
  footer: string[],
): RenderedEmail {
  const text = [
    ...blocks.flatMap((block) => [textOf(block), '']),
    '--',
    ...footer,
  ].join('\n');
  const html = `<!doctype html>
<html lang="en"><body style="margin:0;background:#ffffff;font-family:Arial,Helvetica,sans-serif;color:${INK};line-height:1.5">
<div style="max-width:600px;margin:0 auto;padding:24px 16px">
${blocks.map(htmlOf).join('\n')}
<hr style="border:0;border-top:1px solid #e6d9e2;margin:24px 0">
<p style="font-size:13px;color:#6b5a66">${footer.map(escapeHtml).join('<br>')}</p>
</div></body></html>`;
  return { subject, text, html };
}
