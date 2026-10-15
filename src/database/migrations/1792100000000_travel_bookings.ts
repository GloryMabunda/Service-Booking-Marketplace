import { type Kysely, sql } from 'kysely';

// Appointment location and travel fee (#115). The client chooses, per booking,
// whether the appointment is at the owner's place or at theirs. A booking at
// the client's place keeps a snapshot of the address, the distance and the fee
// rules, and blocks extra travel time before and after (occupied_from /
// occupied_until), so the owner is never booked back to back across town.
export async function up(db: Kysely<any>): Promise<void> {
  await sql`
    CREATE TYPE booking_location AS ENUM ('studio', 'client');

    ALTER TABLE settings
      ADD COLUMN home_address text,
      ADD COLUMN travel_call_out_fee numeric(10,2) NOT NULL DEFAULT 0 CHECK (travel_call_out_fee >= 0),
      ADD COLUMN travel_rate_per_km numeric(10,2) NOT NULL DEFAULT 0 CHECK (travel_rate_per_km >= 0),
      ADD COLUMN travel_free_km integer NOT NULL DEFAULT 0 CHECK (travel_free_km >= 0),
      ADD COLUMN travel_max_km integer NOT NULL DEFAULT 30 CHECK (travel_max_km BETWEEN 1 AND 500),
      ADD COLUMN travel_charge_return boolean NOT NULL DEFAULT true,
      ADD COLUMN travel_extra_minutes integer NOT NULL DEFAULT 30 CHECK (travel_extra_minutes BETWEEN 0 AND 240);

    ALTER TABLE services
      ADD COLUMN available_for_travel boolean NOT NULL DEFAULT false;

    ALTER TABLE bookings
      ADD COLUMN location booking_location NOT NULL DEFAULT 'studio',
      ADD COLUMN appointment_address text,
      ADD COLUMN travel_distance_km numeric(6,1),
      ADD COLUMN travel_call_out_fee numeric(10,2),
      ADD COLUMN travel_rate_per_km numeric(10,2),
      ADD COLUMN travel_fee numeric(10,2) NOT NULL DEFAULT 0 CHECK (travel_fee >= 0),
      ADD COLUMN occupied_from timestamptz;

    ALTER TABLE bookings
      ADD CONSTRAINT bookings_occupied_from_before_start CHECK (occupied_from IS NULL OR occupied_from <= start_at),
      ADD CONSTRAINT bookings_location_address CHECK (
        (location = 'client') = (appointment_address IS NOT NULL)
      ),
      ADD CONSTRAINT bookings_travel_snapshot CHECK (
        (location = 'client') = (travel_distance_km IS NOT NULL)
      );

    -- The deposit now includes the travel fee, which can make it more than the
    -- price of a cheap service
    ALTER TABLE bookings DROP CONSTRAINT bookings_deposit_range;
    ALTER TABLE bookings ADD CONSTRAINT bookings_deposit_range
      CHECK (deposit_amount >= 0 AND deposit_amount <= price_at_booking + travel_fee);

    ALTER TABLE bookings DROP CONSTRAINT bookings_no_overlap;
    ALTER TABLE bookings ADD CONSTRAINT bookings_no_overlap
      EXCLUDE USING gist (tstzrange(COALESCE(occupied_from, start_at), occupied_until, '[)') WITH &&)
      WHERE (status IN ('pending', 'confirmed'));
  `.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`
    ALTER TABLE bookings DROP CONSTRAINT bookings_deposit_range;
    ALTER TABLE bookings ADD CONSTRAINT bookings_deposit_range
      CHECK (deposit_amount >= 0 AND deposit_amount <= price_at_booking);
    ALTER TABLE bookings DROP CONSTRAINT bookings_no_overlap;
    ALTER TABLE bookings ADD CONSTRAINT bookings_no_overlap
      EXCLUDE USING gist (tstzrange(start_at, occupied_until, '[)') WITH &&)
      WHERE (status IN ('pending', 'confirmed'));
    ALTER TABLE bookings
      DROP CONSTRAINT bookings_travel_snapshot,
      DROP CONSTRAINT bookings_location_address,
      DROP CONSTRAINT bookings_occupied_from_before_start,
      DROP COLUMN occupied_from, DROP COLUMN travel_fee, DROP COLUMN travel_rate_per_km,
      DROP COLUMN travel_call_out_fee, DROP COLUMN travel_distance_km,
      DROP COLUMN appointment_address, DROP COLUMN location;
    ALTER TABLE services DROP COLUMN available_for_travel;
    ALTER TABLE settings
      DROP COLUMN travel_extra_minutes, DROP COLUMN travel_charge_return,
      DROP COLUMN travel_max_km, DROP COLUMN travel_free_km, DROP COLUMN travel_rate_per_km,
      DROP COLUMN travel_call_out_fee, DROP COLUMN home_address;
    DROP TYPE booking_location;
  `.execute(db);
}
