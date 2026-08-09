import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

/**
 * Phần thuần, không chạm filesystem, nên test được: `hasConfigDir` là chỗ tiêm
 * kết quả kiểm tra thư mục vào.
 */
export function pickWorkspaceRoot(cwd: string, hasConfigDir: (dir: string) => boolean): string {
  const grandparent = resolve(cwd, '../..');
  return hasConfigDir(grandparent) ? grandparent : resolve(cwd);
}

/**
 * `next dev` chạy với cwd là apps/web nên gốc workspace là hai cấp trên. Trong
 * serverless function của Vercel cwd là gốc output đã trace, và config/ nằm
 * ngay tại đó. Đoán sai chỗ này làm các trang đọc weights.yml hỏng ở production
 * mà local vẫn xanh.
 */
export function workspaceRoot(): string {
  return pickWorkspaceRoot(process.cwd(), (dir) => existsSync(join(dir, 'config')));
}
