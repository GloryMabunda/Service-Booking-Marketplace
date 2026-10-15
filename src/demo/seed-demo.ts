import type { INestApplicationContext } from '@nestjs/common';
import sharp from 'sharp';
import { DATABASE } from '../database/database.module.js';
import { seedAdmin } from '../auth/seed-admin.js';
import type { Kysely } from 'kysely';
import type { DB } from '../database/database.types.js';
import { ServicesService } from '../services/services.service.js';
import { SettingsService } from '../settings/settings.service.js';
import { SiteContentService } from '../site/site-content.service.js';
import {
  FaqsService,
  TestimonialsService,
} from '../site/site-lists.service.js';

// Fills an empty database with made-up data for the demo (docs/demo.md): a demo
// administrator, a fake bank account, four services with pictures, and the
// home page text, testimonials and questions. Nothing here is real. It only
// runs on an empty database (no services yet), so restarting never overwrites
// what someone changed.

export const DEMO_ADMIN_EMAIL = 'demo@example.com';
export const DEFAULT_DEMO_ADMIN_PASSWORD = 'demo-admin-1234';

// Two colours per service: a soft gradient with a few shapes, drawn here so
// the demo needs no photo files (and shows no one's face)
const SERVICES = [
  {
    name: 'Soft Glam',
    description: 'Natural, glowing makeup for any occasion.',
    price: '650.00',
    durationMinutes: 90,
    colours: ['#F7B6CE', '#C0284F'],
    alt: 'A soft pink and rose abstract picture for Soft Glam',
  },
  {
    name: 'Full Glam',
    description: 'A polished, long-wearing look for events and photos.',
    price: '850.00',
    durationMinutes: 120,
    colours: ['#E3C3F0', '#7A1F8C'],
    alt: 'A lilac and plum abstract picture for Full Glam',
  },
  {
    name: 'Bridal Makeup',
    description: 'Your trial and your wedding-day look, planned together.',
    price: '1200.00',
    durationMinutes: 150,
    colours: ['#FFE8C2', '#E08A2B'],
    alt: 'A cream and gold abstract picture for Bridal Makeup',
  },
  {
    name: 'Lash Application',
    description: 'Classic lashes, applied with care.',
    price: '300.00',
    durationMinutes: 45,
    colours: ['#CDEBD3', '#2F7D4F'],
    alt: 'A mint and green abstract picture for Lash Application',
  },
];

function picture([from, to]: string[]): Promise<Buffer> {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800">
    <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${from}"/><stop offset="1" stop-color="${to}"/>
    </linearGradient></defs>
    <rect width="1200" height="800" fill="url(#g)"/>
    <circle cx="900" cy="250" r="190" fill="#ffffff" fill-opacity="0.25"/>
    <circle cx="260" cy="620" r="240" fill="#ffffff" fill-opacity="0.18"/>
    <circle cx="640" cy="430" r="90" fill="#ffffff" fill-opacity="0.35"/>
  </svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

export async function seedDemo(
  app: INestApplicationContext,
  adminPassword = DEFAULT_DEMO_ADMIN_PASSWORD,
): Promise<'seeded' | 'skipped'> {
  const db = app.get<Kysely<DB>>(DATABASE, { strict: false });
  const services = app.get(ServicesService, { strict: false });

  if ((await services.list(true)).length > 0) return 'skipped';

  const admin = await db
    .transaction()
    .execute((trx) =>
      seedAdmin(trx, { email: DEMO_ADMIN_EMAIL, password: adminPassword }),
    );

  await app.get(SettingsService, { strict: false }).update(
    {
      businessName: 'Make Up by Glory (demo)',
      businessEmail: 'demo@example.com',
      bankingDetails: {
        accountName: 'Demo Account',
        bank: 'Demo Bank',
        accountNumber: '0000000000',
        branchCode: '000000',
        accountType: 'Cheque',
      },
    },
    admin.id,
  );

  const created: { id: string; name: string }[] = [];
  for (const service of SERVICES) {
    const { id } = await services.create({
      name: service.name,
      description: service.description,
      price: service.price,
      durationMinutes: service.durationMinutes,
      isActive: true,
      availableForTravel: false,
    });
    await services.setImage(
      id,
      await picture(service.colours),
      admin.id,
      service.alt,
    );
    created.push({ id, name: service.name });
  }

  await app.get(SiteContentService, { strict: false }).update(
    {
      tagline: 'Makeup that feels like you',
      aboutText:
        'This is a demo of a booking system for a makeup artist. Everything you see here is made up: the services, the prices and the testimonials.\n\nTry booking a service as a client, then sign in to the portal to see the booking, confirm the payment and manage the site.',
      locationType: 'studio',
      locationText: 'Demo studio, anywhere',
    },
    admin.id,
  );

  const testimonials = app.get(TestimonialsService, { strict: false });
  for (const [clientName, quote, service] of [
    [
      'Naledi',
      'I felt like myself, only more glowing. Booking was so easy.',
      0,
    ],
    ['Thandi', 'My bridal trial was relaxed and the look lasted all day.', 2],
    ['Aisha', 'Neat lashes and a calm, friendly appointment.', 3],
  ] as const) {
    await testimonials.create({
      clientName,
      quote,
      serviceId: created[service].id,
      isVisible: true,
    });
  }

  const faqs = app.get(FaqsService, { strict: false });
  for (const [question, answer] of [
    [
      'How do I book?',
      'Choose a service, pick a date and time, and enter your details. You then pay a deposit and upload your proof of payment.',
    ],
    [
      'Is this a real business?',
      'No. This is a demo, so nothing is real and no one will arrive. Emails appear on the demo mailbox page.',
    ],
    [
      'Can I cancel?',
      'Yes, from the private link in your booking email, before the appointment starts.',
    ],
    [
      'What does the deposit cover?',
      'It secures your time and counts toward the price. The balance is paid on the day.',
    ],
  ]) {
    await faqs.create({ question, answer, isVisible: true });
  }

  return 'seeded';
}
