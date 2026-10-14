import type { ConfigService } from '@nestjs/config';
import type { Kysely } from 'kysely';
import type { Env } from '../config/env.js';
import type { DB } from '../database/database.types.js';
import type { FileStorage } from '../storage/file-storage.js';
import { ProofRetentionService } from './proof-retention.service.js';

// The schedule of the retention job (#77): a minute after start, then once a
// day, never in tests, and stopped on shutdown. What one run does is tested in
// tests/integration/proof-retention.spec.ts.
describe('ProofRetentionService schedule', () => {
  const config = (nodeEnv: string) =>
    ({ get: () => nodeEnv }) as unknown as ConfigService<Env, true>;
  const make = (nodeEnv: string) =>
    new ProofRetentionService(
      null as unknown as Kysely<DB>,
      null as unknown as FileStorage,
      config(nodeEnv),
    );
  const DAY = 24 * 3_600_000;

  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  function start(nodeEnv: string) {
    const service = make(nodeEnv);
    const run = vi
      .spyOn(service, 'run')
      .mockResolvedValue({ deleted: 0, strays: 0 });
    service.onApplicationBootstrap();
    return { service, run };
  }

  it('runs a minute after the app starts, then every day', async () => {
    const { service, run } = start('production');
    await vi.advanceTimersByTimeAsync(59_999);
    expect(run).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(run).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(DAY);
    expect(run).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(2 * DAY);
    expect(run).toHaveBeenCalledTimes(4);
    service.onApplicationShutdown();
  });

  it('stops when the app shuts down', async () => {
    const { service, run } = start('production');
    service.onApplicationShutdown();
    await vi.advanceTimersByTimeAsync(10 * DAY);
    expect(run).not.toHaveBeenCalled();
  });

  it('does not start a timer under test', async () => {
    const { run } = start('test');
    await vi.advanceTimersByTimeAsync(10 * DAY);
    expect(run).not.toHaveBeenCalled();
  });

  it('keeps going after a failed run', async () => {
    const service = make('production');
    const run = vi
      .spyOn(service, 'run')
      .mockRejectedValueOnce(new Error('the database is restarting'))
      .mockResolvedValue({ deleted: 0, strays: 0 });
    service.onApplicationBootstrap();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(run).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(DAY);
    expect(run).toHaveBeenCalledTimes(2);
    service.onApplicationShutdown();
  });
});
