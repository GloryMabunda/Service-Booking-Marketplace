import { DemoDistanceProvider } from './demo-distance-provider.js';

describe('DemoDistanceProvider', () => {
  const provider = new DemoDistanceProvider();
  const km = async (address: string) =>
    (await provider.roadDistanceMeters('home', address)) / 1000;

  it('gives the same distance for the same address', async () => {
    expect(await km('12 Protea Road, Sunnyside')).toBe(
      await km('12 Protea Road, Sunnyside'),
    );
  });

  it('ignores capitals and extra spaces, as a person would', async () => {
    expect(await km('  12 PROTEA  road,   Sunnyside ')).toBe(
      await km('12 protea road, sunnyside'),
    );
  });

  it('always stays between 3 and 25 km, so the demo never refuses an address as too far', async () => {
    for (let i = 0; i < 200; i++) {
      const distance = await km(`${i} Demo Street, Town ${i % 7}`);
      expect(distance).toBeGreaterThanOrEqual(3);
      expect(distance).toBeLessThanOrEqual(25);
    }
  });

  it('gives different addresses different distances', async () => {
    const distances = new Set<number>();
    for (let i = 0; i < 30; i++) distances.add(await km(`${i} Demo Street`));
    expect(distances.size).toBeGreaterThan(10);
  });

  it('works in whole tenths of a kilometre', async () => {
    const meters = await provider.roadDistanceMeters('home', 'anywhere');
    expect(meters % 100).toBe(0);
  });
});
