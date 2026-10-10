-- Runs once, when the database volume is first created (docker-compose.yml).
-- "booking" (development) is created by the image from POSTGRES_DB.

-- Automated tests get their own database so they can wipe it freely (#17).
CREATE DATABASE booking_test OWNER booking;

-- btree_gist backs the bookings_no_overlap exclusion constraint (BR-2,
-- docs/database.md). The first migration also runs CREATE EXTENSION IF NOT
-- EXISTS, so production databases get it too.
\connect booking
CREATE EXTENSION IF NOT EXISTS btree_gist;

\connect booking_test
CREATE EXTENSION IF NOT EXISTS btree_gist;
