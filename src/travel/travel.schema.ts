import { z } from 'zod';

// The address a client gives for an appointment at their place (#115): free
// text, because South African addresses come in every shape.
export const appointmentAddress = z
  .string({ error: 'Enter the address for the appointment.' })
  .trim()
  .min(5, 'Enter the full address, with the suburb and town.')
  .max(300, 'The address must be at most 300 characters.');

export const travelQuoteSchema = z.strictObject({
  serviceId: z.guid({ error: 'Choose a service.' }),
  address: appointmentAddress,
});
