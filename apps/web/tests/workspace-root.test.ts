import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { pickWorkspaceRoot } from '../src/lib/workspace-root';

describe('pickWorkspaceRoot', () => {
  it('chọn thư mục ông nội khi ở đó có config/ (chạy dev từ apps/web)', () => {
    const cwd = resolve('/repo/apps/web');
    const repoRoot = resolve(cwd, '../..');
    expect(pickWorkspaceRoot(cwd, (dir) => dir === repoRoot)).toBe(repoRoot);
  });

  it('chọn chính cwd khi config/ nằm ngay tại đó (bundle serverless)', () => {
    // Trên Vercel cwd là gốc output, không phải apps/web, nên phép lùi hai cấp
    // trỏ ra ngoài bundle và không tìm thấy gì.
    const cwd = resolve('/var/task');
    expect(pickWorkspaceRoot(cwd, (dir) => dir === cwd)).toBe(cwd);
  });

  it('không tìm thấy config/ ở đâu thì trả về cwd', () => {
    // Đọc file sau đó sẽ hỏng, nhưng hỏng ở chỗ đọc file với đường dẫn nói ra
    // được vấn đề, chứ không phải trả về một đường dẫn bịa.
    const cwd = resolve('/var/task');
    expect(pickWorkspaceRoot(cwd, () => false)).toBe(cwd);
  });
});
