import { readFileSync } from 'node:fs';

/**
 * Next nạp `.env` theo thư mục chạy, mà thư mục đó là `apps/web`, trong khi
 * cấu hình của workspace nằm ở gốc repo. Không có cầu nối này thì
 * `DATABASE_URL` không bao giờ tới được server và dashboard luôn hiện màn hình
 * "chưa kết nối database" dù Postgres đang chạy bình thường.
 */
export function parseEnvFile(contents: string): Record<string, string> {
  const out: Record<string, string> = {};

  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.length === 0 || line.startsWith('#')) continue;

    const separator = line.indexOf('=');
    if (separator <= 0) continue;

    const key = line.slice(0, separator).trim();
    if (key.length === 0) continue;

    let value = line.slice(separator + 1).trim();
    const quote = value[0];
    if ((quote === '"' || quote === "'") && value.length >= 2 && value.endsWith(quote)) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }

  return out;
}

/**
 * Biến môi trường đã có sẵn luôn thắng file: khi chạy CI hoặc khi thao tác thủ
 * công người ta truyền biến vào tiến trình, và file trong repo không được phép
 * ghi đè lên đó.
 */
export function applyEnv(
  parsed: Record<string, string>,
  env: Record<string, string | undefined>,
): string[] {
  const applied: string[] = [];
  for (const [key, value] of Object.entries(parsed)) {
    if (env[key] !== undefined && env[key] !== '') continue;
    env[key] = value;
    applied.push(key);
  }
  return applied;
}

/** Trả về tên biến đã nạp — KHÔNG trả giá trị, để không rò secret ra log. */
export function loadWorkspaceEnv(
  path: string,
  env: Record<string, string | undefined> = process.env,
): string[] {
  let contents: string;
  try {
    contents = readFileSync(path, 'utf8');
  } catch {
    // Thiếu file không phải lỗi: môi trường triển khai thật thường truyền biến
    // trực tiếp vào tiến trình.
    return [];
  }
  return applyEnv(parseEnvFile(contents), env);
}
