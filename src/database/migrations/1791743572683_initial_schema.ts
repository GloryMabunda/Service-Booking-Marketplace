import { type Kysely, sql } from 'kysely';

// The v1 schema: the reference SQL from docs/database.md section 9, copied
// exactly. String.raw keeps backslashes (the WhatsApp number pattern) intact.
// Later schema changes go in new migrations; never edit this one once it has
// run anywhere.
const schema = String.raw`
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- Types

CREATE TYPE user_role AS ENUM ('admin');
CREATE TYPE booking_status AS ENUM ('pending', 'confirmed', 'completed', 'no_show', 'cancelled', 'expired');
CREATE TYPE cancelled_by AS ENUM ('client', 'admin');
CREATE TYPE proof_status AS ENUM ('received', 'accepted', 'rejected');
CREATE TYPE notification_channel AS ENUM ('email', 'sms');
CREATE TYPE notification_status AS ENUM ('pending', 'sent', 'failed');
CREATE TYPE notification_type AS ENUM (
  'payment_instructions', 'booking_confirmed', 'proof_rejected', 'booking_cancelled', 'booking_expired',
  'admin_new_booking', 'admin_proof_uploaded', 'admin_client_cancelled'
);

-- Users

CREATE TABLE users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email         text NOT NULL,
  password_hash text NOT NULL,
  role          user_role NOT NULL DEFAULT 'admin',
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX users_email_key ON users (lower(email));

-- Services

CREATE TABLE services (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name             text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 100),
  description      text NOT NULL DEFAULT '',
  price            numeric(10,2) NOT NULL CHECK (price >= 0),
  duration_minutes integer NOT NULL CHECK (duration_minutes > 0 AND duration_minutes <= 720),
  is_active        boolean NOT NULL DEFAULT true,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

-- Availability

CREATE TABLE availability (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  day_of_week    smallint NOT NULL UNIQUE CHECK (day_of_week BETWEEN 1 AND 7),
  start_time     time,
  end_time       time,
  is_working_day boolean NOT NULL,
  updated_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT availability_hours CHECK (
    (is_working_day AND start_time IS NOT NULL AND end_time IS NOT NULL AND end_time > start_time)
    OR (NOT is_working_day AND start_time IS NULL AND end_time IS NULL)
  )
);

-- Blocked times

CREATE TABLE blocked_times (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  start_at   timestamptz NOT NULL,
  end_at     timestamptz NOT NULL,
  reason     text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT blocked_times_order CHECK (end_at > start_at)
);
CREATE INDEX blocked_times_range_idx ON blocked_times USING gist (tstzrange(start_at, end_at, '[)'));

-- Bookings

CREATE SEQUENCE booking_reference_seq;

CREATE TABLE bookings (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reference                text NOT NULL UNIQUE
                             DEFAULT 'BK-' || lpad(nextval('booking_reference_seq')::text, 6, '0'),
  service_id               uuid NOT NULL REFERENCES services (id) ON DELETE RESTRICT,
  client_name              text NOT NULL CHECK (char_length(client_name) BETWEEN 1 AND 100),
  client_email             text NOT NULL,
  client_phone             text NOT NULL,
  start_at                 timestamptz NOT NULL,
  end_at                   timestamptz NOT NULL,
  occupied_until           timestamptz NOT NULL,
  price_at_booking         numeric(10,2) NOT NULL,
  deposit_amount           numeric(10,2) NOT NULL,
  deposit_due_at           timestamptz,
  booking_token_hash       bytea,
  booking_token_created_at timestamptz,
  amount_received          numeric(10,2),
  payment_verified_at      timestamptz,
  payment_verified_by      uuid REFERENCES users (id) ON DELETE RESTRICT,
  refund_due               boolean NOT NULL DEFAULT false,
  refunded_at              timestamptz,
  cancelled_at             timestamptz,
  cancelled_by             cancelled_by,
  status                   booking_status NOT NULL,
  notes                    text CHECK (char_length(notes) <= 1000),
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT bookings_times_order CHECK (start_at < end_at AND end_at <= occupied_until),
  CONSTRAINT bookings_deposit_range CHECK (deposit_amount >= 0 AND deposit_amount <= price_at_booking),
  CONSTRAINT bookings_pending_deadline CHECK (status <> 'pending' OR deposit_due_at IS NOT NULL),
  CONSTRAINT bookings_cancellation CHECK (
    status <> 'cancelled' OR (cancelled_at IS NOT NULL AND cancelled_by IS NOT NULL)
  ),
  CONSTRAINT bookings_payment_together CHECK (
    (amount_received IS NULL AND payment_verified_at IS NULL AND payment_verified_by IS NULL)
    OR (amount_received IS NOT NULL AND payment_verified_at IS NOT NULL AND payment_verified_by IS NOT NULL)
  ),
  CONSTRAINT bookings_refund_when_due CHECK (refunded_at IS NULL OR refund_due),
  CONSTRAINT bookings_token_together CHECK ((booking_token_hash IS NULL) = (booking_token_created_at IS NULL)),
  CONSTRAINT bookings_token_length CHECK (booking_token_hash IS NULL OR octet_length(booking_token_hash) = 32),

  CONSTRAINT bookings_no_overlap
    EXCLUDE USING gist (tstzrange(start_at, occupied_until, '[)') WITH &&)
    WHERE (status IN ('pending', 'confirmed'))
);

ALTER SEQUENCE booking_reference_seq OWNED BY bookings.reference;

CREATE UNIQUE INDEX bookings_token_hash_key ON bookings (booking_token_hash) WHERE booking_token_hash IS NOT NULL;
CREATE INDEX bookings_service_id_idx ON bookings (service_id);
CREATE INDEX bookings_start_at_idx ON bookings (start_at);
CREATE INDEX bookings_pending_deadline_idx ON bookings (deposit_due_at) WHERE status = 'pending';
CREATE INDEX bookings_pending_email_idx ON bookings (lower(client_email)) WHERE status = 'pending';
CREATE INDEX bookings_pending_phone_idx ON bookings (client_phone) WHERE status = 'pending';
CREATE INDEX bookings_refunds_due_idx ON bookings (created_at) WHERE refund_due AND refunded_at IS NULL;

-- Payment proofs

CREATE TABLE payment_proofs (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id        uuid NOT NULL REFERENCES bookings (id) ON DELETE RESTRICT,
  storage_key       text NOT NULL UNIQUE,
  original_filename text NOT NULL CHECK (char_length(original_filename) BETWEEN 1 AND 255),
  content_type      text NOT NULL CHECK (content_type IN ('application/pdf', 'image/jpeg', 'image/png')),
  size_bytes        integer NOT NULL CHECK (size_bytes > 0 AND size_bytes <= 5242880),
  sha256            bytea NOT NULL CHECK (octet_length(sha256) = 32),
  status            proof_status NOT NULL DEFAULT 'received',
  rejection_reason  text,
  uploaded_at       timestamptz NOT NULL DEFAULT now(),
  uploaded_from_ip  inet NOT NULL,
  reviewed_at       timestamptz,
  reviewed_by       uuid REFERENCES users (id) ON DELETE RESTRICT,
  file_deleted_at   timestamptz,

  CONSTRAINT payment_proofs_rejection_reason CHECK (status <> 'rejected' OR rejection_reason IS NOT NULL),
  CONSTRAINT payment_proofs_review CHECK (
    (status = 'received' AND reviewed_at IS NULL AND reviewed_by IS NULL)
    OR (status <> 'received' AND reviewed_at IS NOT NULL AND reviewed_by IS NOT NULL)
  )
);
CREATE INDEX payment_proofs_booking_id_idx ON payment_proofs (booking_id);
CREATE INDEX payment_proofs_sha256_idx ON payment_proofs (sha256);
CREATE INDEX payment_proofs_awaiting_review_idx ON payment_proofs (uploaded_at) WHERE status = 'received';
CREATE INDEX payment_proofs_file_retained_idx ON payment_proofs (uploaded_at) WHERE file_deleted_at IS NULL;

-- Notifications

CREATE TABLE notifications (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id uuid NOT NULL REFERENCES bookings (id) ON DELETE RESTRICT,
  channel    notification_channel NOT NULL DEFAULT 'email',
  recipient  text NOT NULL,
  type       notification_type NOT NULL,
  status     notification_status NOT NULL DEFAULT 'pending',
  sent_at    timestamptz,
  error      text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX notifications_booking_id_idx ON notifications (booking_id);

-- Settings

CREATE TABLE settings (
  id                    smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  min_notice_hours      integer NOT NULL DEFAULT 24 CHECK (min_notice_hours >= 0),
  max_advance_days      integer NOT NULL DEFAULT 90 CHECK (max_advance_days > 0),
  slot_interval_minutes integer NOT NULL DEFAULT 60 CHECK (slot_interval_minutes > 0),
  buffer_minutes        integer NOT NULL DEFAULT 60 CHECK (buffer_minutes >= 0),
  deposit_percent       numeric(5,2) NOT NULL DEFAULT 50 CHECK (deposit_percent BETWEEN 0 AND 100),
  deposit_refundable    boolean NOT NULL DEFAULT true,
  refund_cutoff_hours   integer NOT NULL DEFAULT 24 CHECK (refund_cutoff_hours >= 0),
  deposit_hold_hours    integer NOT NULL DEFAULT 24 CHECK (deposit_hold_hours > 0),
  min_payment_window_hours integer NOT NULL DEFAULT 2 CHECK (min_payment_window_hours > 0),
  time_zone             text NOT NULL DEFAULT 'Africa/Johannesburg',
  banking_details       jsonb NOT NULL CHECK (jsonb_typeof(banking_details) = 'object'),
  business_name         text NOT NULL CHECK (char_length(business_name) BETWEEN 1 AND 100),
  business_email        text NOT NULL,
  business_phone        text,
  updated_at            timestamptz NOT NULL DEFAULT now(),
  updated_by            uuid REFERENCES users (id) ON DELETE RESTRICT,

  CONSTRAINT settings_payment_window CHECK (min_payment_window_hours <= deposit_hold_hours)
);

-- Home page: website photos

CREATE TYPE location_type AS ENUM ('travel', 'studio');

CREATE TABLE images (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  large_key   text NOT NULL UNIQUE,
  thumb_key   text NOT NULL UNIQUE,
  width       integer NOT NULL CHECK (width > 0),
  height      integer NOT NULL CHECK (height > 0),
  large_bytes integer NOT NULL CHECK (large_bytes > 0),
  thumb_bytes integer NOT NULL CHECK (thumb_bytes > 0),
  sha256      bytea NOT NULL CHECK (octet_length(sha256) = 32),
  alt_text    text CHECK (char_length(alt_text) <= 250),
  uploaded_at timestamptz NOT NULL DEFAULT now(),
  uploaded_by uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT
);
CREATE INDEX images_sha256_idx ON images (sha256);

-- Home page: text and links

CREATE TABLE site_content (
  id              smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  tagline         text CHECK (char_length(tagline) <= 120),
  about_text      text NOT NULL DEFAULT '' CHECK (char_length(about_text) <= 5000),
  hero_image_id   uuid REFERENCES images (id) ON DELETE SET NULL,
  about_image_id  uuid REFERENCES images (id) ON DELETE SET NULL,
  location_type   location_type,
  location_text   text CHECK (char_length(location_text) BETWEEN 1 AND 200),
  whatsapp_number text CHECK (whatsapp_number ~ '^\+[1-9][0-9]{7,14}$'),
  instagram_url   text CHECK (instagram_url ~ '^https://'),
  facebook_url    text CHECK (facebook_url ~ '^https://'),
  tiktok_url      text CHECK (tiktok_url ~ '^https://'),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  updated_by      uuid REFERENCES users (id) ON DELETE RESTRICT,

  CONSTRAINT site_content_location_together CHECK ((location_type IS NULL) = (location_text IS NULL)),
  CONSTRAINT site_content_distinct_images CHECK (hero_image_id IS NULL OR about_image_id IS NULL OR hero_image_id <> about_image_id)
);

-- Home page: gallery, testimonials, FAQ

CREATE TABLE gallery_items (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  image_id             uuid NOT NULL UNIQUE REFERENCES images (id) ON DELETE CASCADE,
  caption              text CHECK (char_length(caption) <= 200),
  service_id           uuid REFERENCES services (id) ON DELETE SET NULL,
  is_visible           boolean NOT NULL DEFAULT true,
  position             integer NOT NULL DEFAULT 0,
  consent_confirmed_at timestamptz NOT NULL,
  consent_confirmed_by uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX gallery_items_visible_order_idx ON gallery_items (position, created_at) WHERE is_visible;
CREATE INDEX gallery_items_service_id_idx ON gallery_items (service_id);

CREATE TABLE testimonials (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_name text NOT NULL CHECK (char_length(client_name) BETWEEN 1 AND 60),
  quote       text NOT NULL CHECK (char_length(quote) BETWEEN 1 AND 500),
  service_id  uuid REFERENCES services (id) ON DELETE SET NULL,
  is_visible  boolean NOT NULL DEFAULT true,
  position    integer NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX testimonials_visible_order_idx ON testimonials (position, created_at) WHERE is_visible;

CREATE TABLE faqs (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  question   text NOT NULL CHECK (char_length(question) BETWEEN 1 AND 200),
  answer     text NOT NULL CHECK (char_length(answer) BETWEEN 1 AND 2000),
  is_visible boolean NOT NULL DEFAULT true,
  position   integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX faqs_visible_order_idx ON faqs (position, created_at) WHERE is_visible;
`;

// Migrations are frozen in time, so they use Kysely<any> rather than the
// generated Database types, which change as the schema evolves.
export async function up(db: Kysely<any>): Promise<void> {
  await sql.raw(schema).execute(db);
}

// Drops everything up() created, in reverse dependency order. btree_gist is
// left in place: the Docker setup script creates it too.
export async function down(db: Kysely<any>): Promise<void> {
  await sql
    .raw(
      String.raw`
DROP TABLE faqs, testimonials, gallery_items, site_content, images, settings,
  notifications, payment_proofs, bookings, blocked_times, availability, services, users;
DROP TYPE location_type, notification_type, notification_status, notification_channel,
  proof_status, cancelled_by, booking_status, user_role;
`,
    )
    .execute(db);
}
