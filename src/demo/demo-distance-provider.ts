import { createHash } from 'node:crypto';
import type { DistanceProvider } from '../travel/distance-provider.js';

// In demo mode (DEMO_MODE=true) there is no maps service and no key, so travel
// fees would never work. This makes up a believable distance from the address
// instead: always the same for the same address, between 3 and 25 km. Nothing
// is sent anywhere.
export class DemoDistanceProvider implements DistanceProvider {
  roadDistanceMeters(_from: string, to: string): Promise<number> {
    const normal = to.trim().toLowerCase().replace(/\s+/g, ' ');
    const hash = createHash('sha256').update(normal).digest();
    const tenths = 30 + (hash.readUInt16BE(0) % 221); // 3.0 to 25.0 km
    return Promise.resolve(tenths * 100);
  }
}
