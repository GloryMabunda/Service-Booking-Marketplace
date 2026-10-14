import { Module } from '@nestjs/common';
import { ManualEftProvider, PAYMENT_PROVIDER } from './payment-provider.js';

// Payments (M6). Manual EFT is the only provider in v1 (BR-8).
@Module({
  providers: [{ provide: PAYMENT_PROVIDER, useClass: ManualEftProvider }],
  exports: [PAYMENT_PROVIDER],
})
export class PaymentsModule {}
