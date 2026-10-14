import { z } from 'zod';
import { normalizeSouthAfricanPhone } from '../common/phone.js';
import { isSocialUrl } from './site-text.js';

// Requests to the home page content endpoints (docs/api.md 7.16 to 7.18).
// All text is plain text: it is stored and shown as text, never as HTML.

const uuid = (message: string) => z.uuid({ error: message });

const optionalText = (label: string, max: number) =>
  z
    .string({ error: `The ${label} must be text.` })
    .trim()
    .max(max, `The ${label} must be at most ${max} characters.`);

const nullableText = (label: string, max: number) =>
  optionalText(label, max)
    // An empty box means "nothing here"
    .transform((s) => (s === '' ? null : s))
    .nullable();

const social = (network: 'instagram' | 'facebook' | 'tiktok', domain: string) =>
  z
    .string({
      error: `Enter a link starting with https:// on ${domain}, or null.`,
    })
    .trim()
    .max(300, 'The link must be at most 300 characters.')
    .refine(
      (value) => isSocialUrl(network, value),
      `Enter a link starting with https:// on ${domain}.`,
    )
    .nullable();

// PATCH /api/admin/site-content
export const siteContentPatchSchema = z
  .strictObject({
    tagline: nullableText('tagline', 120),
    aboutText: optionalText('About text', 5000),
    locationType: z
      .enum(['travel', 'studio'], { error: 'Choose travel or studio.' })
      .nullable(),
    locationText: nullableText('area or address', 200),
    whatsappNumber: z
      .string({ error: 'Enter a South African phone number, or null.' })
      .transform((s, ctx) => {
        const phone = normalizeSouthAfricanPhone(s);
        if (!phone) {
          ctx.addIssue({
            code: 'custom',
            message: 'Enter a South African phone number.',
          });
          return z.NEVER;
        }
        return phone;
      })
      .nullable(),
    instagramUrl: social('instagram', 'instagram.com'),
    facebookUrl: social('facebook', 'facebook.com'),
    tiktokUrl: social('tiktok', 'tiktok.com'),
    heroImageAlt: nullableText('alt text', 250),
    aboutImageAlt: nullableText('alt text', 250),
  })
  .partial()
  .superRefine((value, context) => {
    // The type and the text are set together, or both removed
    const hasType = value.locationType !== undefined;
    const hasText = value.locationText !== undefined;
    if (hasType !== hasText) {
      context.addIssue({
        code: 'custom',
        path: [hasType ? 'locationText' : 'locationType'],
        message: 'Set the area or address and its type together.',
      });
    } else if (
      hasType &&
      (value.locationType === null) !== (value.locationText === null)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['locationText'],
        message:
          'Set the area or address and its type together, or remove both.',
      });
    }
  });
export type SiteContentPatch = z.infer<typeof siteContentPatchSchema>;

// The photo slots of the home page
export const imageSlotSchema = z.enum(['hero', 'about']);

// PATCH /api/admin/gallery/:id
export const galleryPatchSchema = z.strictObject({
  caption: nullableText('caption', 200).optional(),
  altText: nullableText('alt text', 250).optional(),
  serviceId: uuid('Choose a service from the list, or none.')
    .nullable()
    .optional(),
  isVisible: z.boolean({ error: 'Must be true or false.' }).optional(),
});
export type GalleryPatch = z.infer<typeof galleryPatchSchema>;

// The text fields that come with a gallery upload
export const galleryUploadFieldsSchema = z.strictObject({
  consent: z.literal('true', {
    error:
      'Please confirm you have the right to show these photos, and that anyone in them has agreed.',
  }),
  serviceId: uuid('Choose a service from the list, or none.').optional(),
});

// PUT .../order: every item exactly once, first to last
export const orderSchema = z.strictObject({
  ids: z.array(uuid('Each item must be an id.'), {
    error: 'Send the list of ids in the order you want.',
  }),
});

// Testimonials (docs/api.md 7.18)
const testimonialFields = {
  clientName: z
    .string({ error: 'Enter the name.' })
    .trim()
    .min(1, 'Enter the name.')
    .max(60, 'The name must be at most 60 characters.'),
  quote: z
    .string({ error: 'Enter the quote.' })
    .trim()
    .min(1, 'Enter the quote.')
    .max(500, 'The quote must be at most 500 characters.'),
  serviceId: uuid('Choose a service from the list, or none.').nullable(),
  isVisible: z.boolean({ error: 'Must be true or false.' }),
};
export const createTestimonialSchema = z.strictObject({
  clientName: testimonialFields.clientName,
  quote: testimonialFields.quote,
  serviceId: testimonialFields.serviceId.default(null),
  isVisible: testimonialFields.isVisible.default(true),
});
export const updateTestimonialSchema = z
  .strictObject(testimonialFields)
  .partial();

// FAQ (docs/api.md 7.18)
const faqFields = {
  question: z
    .string({ error: 'Enter the question.' })
    .trim()
    .min(1, 'Enter the question.')
    .max(200, 'The question must be at most 200 characters.'),
  answer: z
    .string({ error: 'Enter the answer.' })
    .trim()
    .min(1, 'Enter the answer.')
    .max(2000, 'The answer must be at most 2,000 characters.'),
  isVisible: z.boolean({ error: 'Must be true or false.' }),
};
export const createFaqSchema = z.strictObject({
  question: faqFields.question,
  answer: faqFields.answer,
  isVisible: faqFields.isVisible.default(true),
});
export const updateFaqSchema = z.strictObject(faqFields).partial();
