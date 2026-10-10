import { beforeAll } from 'vitest';
beforeAll(() => { globalThis.fetch = async () => { throw new Error('Offline unit tests prohibit network; inject a provider fake.'); }; });
