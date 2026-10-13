import type { ConfigService } from '@nestjs/config';
import type { Kysely } from 'kysely';
import type { Env } from '../config/env.js';
import type { DB } from '../database/database.types.js';
import { BookingExpiryService } from './booking-expiry.service.js';

// The schedule of the expiry job (#50): shortly after start, then every 5
// minutes, never in tests, and stopped on shutdown. What one run does to the
// database is tested in tests/integration/booking-expiry.spec.ts.
describe('BookingExpiryService schedule', () => {
  const config = (nodeEnv: string) =>
    ({ get: () => nodeEnv }) as unknown as ConfigService<Env, true>;
  const noDatabase = null as unknown as Kysely<DB>;

  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  function start(nodeEnv: string) {
    const service = new BookingExpiryService(noDatabase, config(nodeEnv));
    const run = vi.spyOn(service, 'run').mockResolvedValue([]);
    service.onApplicationBootstrap();
    return { service, run };
  }

  it('runs 15 seconds after the app starts, then every 5 minutes', async () => {
    const { service, run } = start('production');
    expect(run).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(14_999);
    expect(run).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(run).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(run).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(run).toHaveBeenCalledTimes(4);

    service.onApplicationShutdown();
  });

  it('stops when the app shuts down', async () => {
    const { service, run } = start('production');
    service.onApplicationShutdown();
    await vi.advanceTimersByTimeAsync(60 * 60_000);
    expect(run).not.toHaveBeenCalled();
  });

  it('does not start a background timer under test', async () => {
    const { run } = start('test');
    await vi.advanceTimersByTimeAsync(60 * 60_000);
    expect(run).not.toHaveBeenCalled();
  });

  it('keeps going after a run fails: the next one is tried in 5 minutes', async () => {
    const service = new BookingExpiryService(noDatabase, config('production'));
    const run = vi
      .spyOn(service, 'run')
      .mockRejectedValueOnce(new Error('the database is restarting'))
      .mockResolvedValue([]);
    service.onApplicationBootstrap();

    await vi.advanceTimersByTimeAsync(15_000);
    expect(run).toHaveBeenCalledTimes(1); // failed, but nothing crashed
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(run).toHaveBeenCalledTimes(2); // tried again
    service.onApplicationShutdown();
  });
});
