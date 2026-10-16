import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { INestApplicationContext } from '@nestjs/common';
import type { Kysely } from 'kysely';
import sharp from 'sharp';
import { seedAdmin } from '../auth/seed-admin.js';
import { AvailabilityService } from '../availability/availability.service.js';
import { DATABASE } from '../database/database.module.js';
import type { DB } from '../database/database.types.js';
import { ServicesService } from '../services/services.service.js';
import { SettingsService } from '../settings/settings.service.js';
import { SiteContentService } from '../site/site-content.service.js';
import {
  FaqsService,
  TestimonialsService,
} from '../site/site-lists.service.js';

// Fills an empty database with made-up data for the demo (docs/demo.md): a demo
// administrator, a fake bank account, five services of an imaginary home
// cleaning and laundry business, Fresh Start, with photos and a logo, working hours, the travel
// rules, and the home page text, testimonials and questions. Nothing here is
// real. It only runs on an empty database (no services yet), so restarting
// never overwrites what someone changed.

export const DEMO_ADMIN_EMAIL = 'demo@example.com';
export const DEFAULT_DEMO_ADMIN_PASSWORD = 'demo-admin-1234';

type Place = 'client' | 'both';

// The demo's pictures (free stock photos, credited in demo-photos/CREDITS.md)
// and its sample logo live in demo-photos/ at the top of the project. If a file
// is missing, a drawn picture is used instead, so the demo never fails over it.
export const DEMO_PHOTO_DIR = join(
  import.meta.dirname,
  '..',
  '..',
  'demo-photos',
);
export const DEMO_LOGO = 'logo-fresh-start.png';
export const DEMO_HERO = 'hero-cleaning.jpg';

// Two blues per service, drawn here as a soft gradient with bubbles, so the
// demo needs no photo files
export const DEMO_SERVICES: {
  name: string;
  description: string;
  price: string;
  durationMinutes: number;
  place: Place;
  photo: string; // a file in demo-photos/
  colours: [string, string]; // the drawn picture, if the photo is missing
  alt: string;
}[] = [
  {
    name: 'Standard House Clean',
    description:
      'Kitchen, bathrooms, bedrooms and living areas cleaned and tidied. We bring the equipment and the products.',
    price: '480.00',
    durationMinutes: 180,
    place: 'client',
    photo: 'standard-house-clean.jpg',
    colours: ['#D6EBFF', '#1E6FD9'],
    alt: 'A mop cleaning a polished wooden floor',
  },
  {
    name: 'Deep Clean',
    description:
      'A thorough top-to-bottom clean: inside the oven and cupboards, windows, skirting boards and behind the furniture.',
    price: '950.00',
    durationMinutes: 300,
    place: 'client',
    photo: 'deep-clean.jpg',
    colours: ['#C7D8F7', '#17356E'],
    alt: 'A bright, freshly cleaned bedroom with white linen',
  },
  {
    name: 'Laundry Wash',
    description:
      'Washed, dried and folded, per load of about 7 kg. Drop it off, or we collect and bring it back.',
    price: '140.00',
    durationMinutes: 60,
    place: 'both',
    photo: 'laundry-wash.jpg',
    colours: ['#D4F1F7', '#1B8FA6'],
    alt: 'The control panel of a washing machine',
  },
  {
    name: 'Ironing',
    description:
      'Shirts, uniforms and linen pressed and hung or folded, per basket.',
    price: '160.00',
    durationMinutes: 90,
    place: 'both',
    photo: 'ironing.jpg',
    colours: ['#E0E6FB', '#4A5FC1'],
    alt: 'A freshly ironed shirt on an ironing board',
  },
  {
    name: 'Wash & Iron',
    description:
      'The full laundry service, per load: washed, dried, ironed and returned ready to wear.',
    price: '260.00',
    durationMinutes: 120,
    place: 'both',
    photo: 'wash-and-iron.jpg',
    colours: ['#CFEFF1', '#1E7F8C'],
    alt: 'Clean shirts drying on a washing line',
  },
];

// The service's photo, or a drawn picture if the file isn't there
async function pictureFor(
  service: (typeof DEMO_SERVICES)[number],
): Promise<Buffer> {
  const file = join(DEMO_PHOTO_DIR, service.photo);
  return existsSync(file) ? readFile(file) : picture(service.colours);
}

function picture([from, to]: string[]): Promise<Buffer> {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800">
    <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${from}"/><stop offset="1" stop-color="${to}"/>
    </linearGradient></defs>
    <rect width="1200" height="800" fill="url(#g)"/>
    <circle cx="900" cy="250" r="190" fill="#ffffff" fill-opacity="0.22"/>
    <circle cx="900" cy="250" r="190" fill="none" stroke="#ffffff" stroke-opacity="0.55" stroke-width="6"/>
    <circle cx="260" cy="610" r="240" fill="#ffffff" fill-opacity="0.16"/>
    <circle cx="260" cy="610" r="240" fill="none" stroke="#ffffff" stroke-opacity="0.45" stroke-width="6"/>
    <circle cx="620" cy="430" r="90" fill="#ffffff" fill-opacity="0.3"/>
    <circle cx="1060" cy="640" r="60" fill="#ffffff" fill-opacity="0.3"/>
    <circle cx="420" cy="170" r="42" fill="#ffffff" fill-opacity="0.35"/>
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

  // The business, its fake bank account and the rules for coming to a home:
  // a call-out fee plus a rate per kilometre, with the first kilometres free.
  // The demo makes up the distances (docs/demo.md), so travel works anywhere.
  await app.get(SettingsService, { strict: false }).update(
    {
      businessName: 'Fresh Start',
      businessEmail: 'demo@example.com',
      bankingDetails: {
        accountName: 'Demo Account',
        bank: 'Demo Bank',
        accountNumber: '0000000000',
        branchCode: '000000',
        accountType: 'Cheque',
      },
      bufferMinutes: 30,
      homeAddress: 'Demo depot, 1 Example Street, Johannesburg',
      travelCallOutFee: '30.00',
      travelRatePerKm: '4.50',
      travelFreeKm: 5,
      travelMaxKm: 30,
      travelChargeReturn: true,
      travelExtraMinutes: 30,
    },
    admin.id,
  );

  // Monday to Saturday, 08:00 to 17:00
  await app.get(AvailabilityService, { strict: false }).setWeek(
    [1, 2, 3, 4, 5, 6, 7].map((dayOfWeek) => ({
      dayOfWeek,
      isWorkingDay: dayOfWeek <= 6,
      startTime: dayOfWeek <= 6 ? '08:00' : null,
      endTime: dayOfWeek <= 6 ? '17:00' : null,
    })),
  );

  const created: { id: string; name: string }[] = [];
  for (const service of DEMO_SERVICES) {
    const { id } = await services.create({
      name: service.name,
      description: service.description,
      price: service.price,
      durationMinutes: service.durationMinutes,
      isActive: true,
      availableAtOurPlace: service.place === 'both',
      availableForTravel: true,
    });
    await services.setImage(
      id,
      await pictureFor(service),
      admin.id,
      service.alt,
    );
    created.push({ id, name: service.name });
  }

  await app.get(SiteContentService, { strict: false }).update(
    {
      tagline: 'A fresher home, without lifting a finger',
      aboutText:
        'This is a demo of a booking system for a home cleaning and laundry business. Everything you see here is made up: the services, the prices and the testimonials.\n\nTry booking a service as a client, then sign in to the portal to see the booking, confirm the payment and manage the site.',
      locationType: 'travel',
      locationText: 'We come to you, across the city (demo)',
    },
    admin.id,
  );

  // The sample logo: bubbles and an iron
  const logoFile = join(DEMO_PHOTO_DIR, DEMO_LOGO);
  if (existsSync(logoFile)) {
    await app
      .get(SiteContentService, { strict: false })
      .setImage('logo', await readFile(logoFile), admin.id, 'Fresh Start');
  }

  // The home page's hero photo
  const heroFile = join(DEMO_PHOTO_DIR, DEMO_HERO);
  if (existsSync(heroFile)) {
    await app
      .get(SiteContentService, { strict: false })
      .setImage(
        'hero',
        await readFile(heroFile),
        admin.id,
        'A gloved hand wiping a kitchen counter with a sponge',
      );
  }

  const testimonials = app.get(TestimonialsService, { strict: false });
  for (const [clientName, quote, service] of [
    ['Naledi', 'The house felt brand new. Booking took two minutes.', 0],
    ['Thandi', 'The deep clean got to places I forgot we had.', 1],
    ['Aisha', 'My shirts come back crisp, and they collect and deliver.', 4],
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
      'Do I need to supply cleaning products?',
      'No. We bring our own equipment and products. If you prefer us to use yours, say so in the notes when you book.',
    ],
    [
      'How does laundry work?',
      'Drop your laundry off at our place, or choose "at your place" and we collect it and bring it back. A travel fee applies for collection.',
    ],
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
  ]) {
    await faqs.create({ question, answer, isVisible: true });
  }

  return 'seeded';
}
