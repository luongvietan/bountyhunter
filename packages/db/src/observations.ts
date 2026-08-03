import { prisma } from './client.js';

export interface ObservationInput {
  collectorId: string;
  sourceUrl: string;
  payload: unknown;
  contentHash: string;
}

/**
 * Ghi Observation, bỏ qua bản trùng.
 * Dựa vào UNIQUE(collectorId, sourceUrl, contentHash): chạy lại collector khi
 * nguồn chưa đổi thì không sinh dòng mới, nên số dòng của một sourceUrl chính
 * là số lần nội dung của nó thay đổi.
 */
export async function saveObservations(items: readonly ObservationInput[]): Promise<number> {
  if (items.length === 0) return 0;
  const res = await prisma.observation.createMany({
    data: items.map((i) => ({
      collectorId: i.collectorId,
      sourceUrl: i.sourceUrl,
      payload: i.payload as never,
      contentHash: i.contentHash,
    })),
    skipDuplicates: true,
  });
  return res.count;
}
