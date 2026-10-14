// The deposit refund rule (BR-12): deposits are refundable when the settings
// say so and the booking is cancelled at least `refundCutoffHours` before the
// appointment starts.

export interface RefundSettings {
  depositRefundable: boolean;
  refundCutoffHours: number;
}

// The last moment a cancellation still earns a refund: the appointment start
// minus the cut-off.
export function refundDeadline(startAt: Date, cutoffHours: number): Date {
  return new Date(startAt.getTime() - cutoffHours * 3_600_000);
}

export function isRefundable(
  settings: RefundSettings,
  startAt: Date,
  now: Date,
): boolean {
  return (
    settings.depositRefundable &&
    now.getTime() <=
      refundDeadline(startAt, settings.refundCutoffHours).getTime()
  );
}
