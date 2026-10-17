import { shouldResetDemo } from './reset-demo-database.js';

describe('shouldResetDemo', () => {
  it('needs demo mode and the reset setting, both', () => {
    expect(shouldResetDemo({})).toBe(false);
    expect(shouldResetDemo({ DEMO_RESET_ON_START: 'true' })).toBe(false);
    expect(shouldResetDemo({ DEMO_MODE: 'true' })).toBe(false);
    expect(
      shouldResetDemo({ DEMO_MODE: 'true', DEMO_RESET_ON_START: 'false' }),
    ).toBe(false);
    expect(
      shouldResetDemo({ DEMO_MODE: 'true', DEMO_RESET_ON_START: 'true' }),
    ).toBe(true);
    expect(shouldResetDemo({ DEMO_MODE: '1', DEMO_RESET_ON_START: '1' })).toBe(
      true,
    );
  });

  it('never wipes a database outside demo mode', () => {
    expect(
      shouldResetDemo({ DEMO_MODE: 'false', DEMO_RESET_ON_START: 'true' }),
    ).toBe(false);
  });
});
