import { Module } from '@nestjs/common';
import { BookingsRepository } from './bookings.repository.js';

// Bookings (M4). The repository stores them; creating one (#45), its link
// (#47), the limits (#48), expiry (#50) and lookup (#52) build on it.
@Module({
  providers: [BookingsRepository],
  exports: [BookingsRepository],
})
export class BookingsModule {}
