import type { NextConfig } from 'next';
import { resolve } from 'node:path';
import { loadWorkspaceEnv } from './src/lib/workspace-env';

const workspaceRoot = resolve(import.meta.dirname, '../..');

// Next nạp .env theo thư mục chạy (apps/web), còn cấu hình của workspace nằm ở
// gốc repo. Phải nạp trước khi app khởi động, nếu không DATABASE_URL không tới
// được server component và dashboard luôn hiện "chưa kết nối database" kể cả
// khi Postgres đang chạy bình thường.
loadWorkspaceEnv(resolve(workspaceRoot, '.env'));

const nextConfig: NextConfig = {
  transpilePackages: ['@kritt-radar/core', '@kritt-radar/db', '@kritt-radar/pipeline'],
  turbopack: {
    root: workspaceRoot,
  },
  // Mặc định Next chỉ trace trong apps/web, mà bốn package của workspace nằm
  // ngoài đó — thiếu dòng này thì function trên Vercel chết vì module not found.
  outputFileTracingRoot: workspaceRoot,
  // Các trang targets/outcomes đọc hai file YAML này lúc chạy, nên chúng phải
  // nằm trong bundle chứ không chỉ trong repo.
  outputFileTracingIncludes: {
    '/**': ['../../config/*.yml'],
  },
};

export default nextConfig;
