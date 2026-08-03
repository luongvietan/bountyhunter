import { describe, expect, it, vi } from 'vitest';
import { withSafeIntegrationDatabase } from './integration-database.js';

describe('withSafeIntegrationDatabase', () => {
  it('does not run cleanup when the connected database is not the explicit safe database', async () => {
    const cleanup = vi.fn();

    await expect(
      withSafeIntegrationDatabase('kritt_radar', 'kritt_radar_integration', cleanup),
    ).rejects.toThrow('refusing integration cleanup');

    expect(cleanup).not.toHaveBeenCalled();
  });

  it('rejects an unsafe expected database name even when it matches the connection', async () => {
    const cleanup = vi.fn();

    await expect(withSafeIntegrationDatabase('kritt_radar', 'kritt_radar', cleanup)).rejects.toThrow(
      'refusing integration cleanup',
    );

    expect(cleanup).not.toHaveBeenCalled();
  });

  it('runs cleanup only when the actual and expected dedicated names match', async () => {
    const cleanup = vi.fn().mockResolvedValue(undefined);

    await withSafeIntegrationDatabase(
      'kritt_radar_integration',
      'kritt_radar_integration',
      cleanup,
    );

    expect(cleanup).toHaveBeenCalledOnce();
  });
});
