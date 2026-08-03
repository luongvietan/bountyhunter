const REPO_HOSTS = ['github.com', 'gitlab.com', 'bitbucket.org'] as const;

/**
 * Quy mọi biến thể URL repo về khoá chuẩn `host/owner/name`.
 * Trả null khi không nhận dạng được — người gọi PHẢI coi null là "không có khoá
 * cứng", không được coi là chuỗi rỗng rồi gộp nhầm mọi thứ vào một entity.
 */
export function normalizeRepoUrl(raw: string): string | null {
  if (!raw) return null;
  let s = raw.trim().toLowerCase();
  if (!s) return null;

  s = s.replace(/^git\+/, '');
  s = s.replace(/^git@([^:]+):/, '$1/');
  s = s.replace(/^[a-z]+:\/\//, '');
  s = s.replace(/^www\./, '');

  const parts = s.split('/').filter(Boolean);
  const [host, owner, nameRaw] = parts;
  if (!host || !owner || !nameRaw) return null;
  if (!REPO_HOSTS.includes(host as (typeof REPO_HOSTS)[number])) return null;

  const name = nameRaw.replace(/\.git$/, '');
  if (!name) return null;

  return `${host}/${owner}/${name}`;
}

const EVM_ADDRESS = /^0x[0-9a-f]{40}$/;
const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

/**
 * Khoá chuẩn `chain:address`.
 * Chỉ hạ chữ thường cho chain dùng hex. Base58 (Solana) phân biệt hoa thường —
 * hạ chữ thường ở đó sẽ tạo ra địa chỉ khác và gộp nhầm entity.
 */
export function normalizeChainAddress(chain: string, address: string): string | null {
  const c = chain.trim().toLowerCase();
  const a = address.trim();
  if (!c || !a) return null;

  if (c === 'solana') {
    return BASE58.test(a) ? `${c}:${a}` : null;
  }

  const lowered = a.toLowerCase();
  return EVM_ADDRESS.test(lowered) ? `${c}:${lowered}` : null;
}
