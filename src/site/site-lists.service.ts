import { Inject, Injectable } from '@nestjs/common';
import type { Kysely } from 'kysely';
import { isoUtc } from '../availability/time-zone.js';
import { ApiException } from '../common/api-error.js';
import { DATABASE } from '../database/database.module.js';
import type { DB } from '../database/database.types.js';
import { assertSameIds } from './ordering.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface Testimonial {
  id: string;
  clientName: string;
  quote: string;
  service: { id: string; name: string } | null;
  isVisible: boolean;
  position: number;
  createdAt: string;
  updatedAt: string;
}

export interface Faq {
  id: string;
  question: string;
  answer: string;
  isVisible: boolean;
  position: number;
  createdAt: string;
  updatedAt: string;
}

const notFound = (what: string) =>
  new ApiException(404, 'NOT_FOUND', `${what} not found.`);

// Testimonials the owner enters herself (A-10, docs/api.md 7.18). They are
// quotes she has permission to show, not reviews written on the site.
@Injectable()
export class TestimonialsService {
  constructor(@Inject(DATABASE) private readonly db: Kysely<DB>) {}

  async list() {
    return { items: await this.items() };
  }

  async create(input: {
    clientName: string;
    quote: string;
    serviceId: string | null;
    isVisible: boolean;
  }) {
    if (input.serviceId) await this.assertService(input.serviceId);
    const last = await this.db
      .selectFrom('testimonials')
      .select((eb) => eb.fn.max('position').as('last'))
      .executeTakeFirst();
    const row = await this.db
      .insertInto('testimonials')
      .values({
        client_name: input.clientName,
        quote: input.quote,
        service_id: input.serviceId,
        is_visible: input.isVisible,
        position: (last?.last ?? -1) + 1,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    return { item: await this.one(row.id) };
  }

  async update(
    id: string,
    patch: {
      clientName?: string;
      quote?: string;
      serviceId?: string | null;
      isVisible?: boolean;
    },
  ) {
    await this.assertExists(id);
    if (patch.serviceId) await this.assertService(patch.serviceId);
    const changes: Record<string, unknown> = {};
    if (patch.clientName !== undefined) changes.client_name = patch.clientName;
    if (patch.quote !== undefined) changes.quote = patch.quote;
    if (patch.serviceId !== undefined) changes.service_id = patch.serviceId;
    if (patch.isVisible !== undefined) changes.is_visible = patch.isVisible;
    await this.db
      .updateTable('testimonials')
      .set({ ...changes, updated_at: new Date() })
      .where('id', '=', id)
      .execute();
    return { item: await this.one(id) };
  }

  async remove(id: string): Promise<void> {
    await this.assertExists(id);
    await this.db.deleteFrom('testimonials').where('id', '=', id).execute();
  }

  async reorder(ids: string[]) {
    const existing = await this.db
      .selectFrom('testimonials')
      .select('id')
      .execute();
    assertSameIds(
      ids,
      existing.map((row) => row.id),
    );
    await this.db.transaction().execute(async (trx) => {
      for (const [position, id] of ids.entries()) {
        await trx
          .updateTable('testimonials')
          .set({ position, updated_at: new Date() })
          .where('id', '=', id)
          .execute();
      }
    });
    return { items: await this.items() };
  }

  private async assertExists(id: string) {
    const row = UUID.test(id)
      ? await this.db
          .selectFrom('testimonials')
          .select('id')
          .where('id', '=', id)
          .executeTakeFirst()
      : undefined;
    if (!row) throw notFound('Testimonial');
  }

  private async assertService(serviceId: string) {
    const service = await this.db
      .selectFrom('services')
      .select('id')
      .where('id', '=', serviceId)
      .executeTakeFirst();
    if (!service) {
      throw new ApiException(
        400,
        'VALIDATION_FAILED',
        'Some details are missing or invalid.',
        [{ field: 'serviceId', message: 'Choose a service from the list.' }],
      );
    }
  }

  private async one(id: string): Promise<Testimonial> {
    const [item] = await this.items(id);
    return item;
  }

  private async items(onlyId?: string): Promise<Testimonial[]> {
    const rows = await this.db
      .selectFrom('testimonials')
      .leftJoin('services', 'services.id', 'testimonials.service_id')
      .select([
        'testimonials.id',
        'testimonials.client_name',
        'testimonials.quote',
        'testimonials.is_visible',
        'testimonials.position',
        'testimonials.created_at',
        'testimonials.updated_at',
        'services.id as service_id',
        'services.name as service_name',
      ])
      .$if(Boolean(onlyId), (qb) =>
        qb.where('testimonials.id', '=', onlyId as string),
      )
      .orderBy('testimonials.position')
      .orderBy('testimonials.created_at')
      .orderBy('testimonials.id')
      .execute();
    return rows.map((row) => ({
      id: row.id,
      clientName: row.client_name,
      quote: row.quote,
      service: row.service_id
        ? { id: row.service_id, name: row.service_name as string }
        : null,
      isVisible: row.is_visible,
      position: row.position,
      createdAt: isoUtc(new Date(row.created_at)),
      updatedAt: isoUtc(new Date(row.updated_at)),
    }));
  }
}

// Frequently asked questions (A-10, docs/api.md 7.18)
@Injectable()
export class FaqsService {
  constructor(@Inject(DATABASE) private readonly db: Kysely<DB>) {}

  async list() {
    return { items: await this.items() };
  }

  async create(input: {
    question: string;
    answer: string;
    isVisible: boolean;
  }) {
    const last = await this.db
      .selectFrom('faqs')
      .select((eb) => eb.fn.max('position').as('last'))
      .executeTakeFirst();
    const row = await this.db
      .insertInto('faqs')
      .values({
        question: input.question,
        answer: input.answer,
        is_visible: input.isVisible,
        position: (last?.last ?? -1) + 1,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    return { item: await this.one(row.id) };
  }

  async update(
    id: string,
    patch: { question?: string; answer?: string; isVisible?: boolean },
  ) {
    await this.assertExists(id);
    const changes: Record<string, unknown> = {};
    if (patch.question !== undefined) changes.question = patch.question;
    if (patch.answer !== undefined) changes.answer = patch.answer;
    if (patch.isVisible !== undefined) changes.is_visible = patch.isVisible;
    await this.db
      .updateTable('faqs')
      .set({ ...changes, updated_at: new Date() })
      .where('id', '=', id)
      .execute();
    return { item: await this.one(id) };
  }

  async remove(id: string): Promise<void> {
    await this.assertExists(id);
    await this.db.deleteFrom('faqs').where('id', '=', id).execute();
  }

  async reorder(ids: string[]) {
    const existing = await this.db.selectFrom('faqs').select('id').execute();
    assertSameIds(
      ids,
      existing.map((row) => row.id),
    );
    await this.db.transaction().execute(async (trx) => {
      for (const [position, id] of ids.entries()) {
        await trx
          .updateTable('faqs')
          .set({ position, updated_at: new Date() })
          .where('id', '=', id)
          .execute();
      }
    });
    return { items: await this.items() };
  }

  private async assertExists(id: string) {
    const row = UUID.test(id)
      ? await this.db
          .selectFrom('faqs')
          .select('id')
          .where('id', '=', id)
          .executeTakeFirst()
      : undefined;
    if (!row) throw notFound('Question');
  }

  private async one(id: string): Promise<Faq> {
    const [item] = await this.items(id);
    return item;
  }

  private async items(onlyId?: string): Promise<Faq[]> {
    const rows = await this.db
      .selectFrom('faqs')
      .selectAll()
      .$if(Boolean(onlyId), (qb) => qb.where('id', '=', onlyId as string))
      .orderBy('position')
      .orderBy('created_at')
      .orderBy('id')
      .execute();
    return rows.map((row) => ({
      id: row.id,
      question: row.question,
      answer: row.answer,
      isVisible: row.is_visible,
      position: row.position,
      createdAt: isoUtc(new Date(row.created_at)),
      updatedAt: isoUtc(new Date(row.updated_at)),
    }));
  }
}
