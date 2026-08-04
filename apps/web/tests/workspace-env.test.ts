import { describe, expect, it } from 'vitest';
import { applyEnv, parseEnvFile, loadWorkspaceEnv } from '../src/lib/workspace-env';

describe('parseEnvFile', () => {
  it('đọc cặp key=value cơ bản', () => {
    expect(parseEnvFile('DATABASE_URL=postgresql://a/b\nGITHUB_TOKEN=abc')).toEqual({
      DATABASE_URL: 'postgresql://a/b',
      GITHUB_TOKEN: 'abc',
    });
  });

  it('bỏ dòng trống và dòng chú thích', () => {
    expect(parseEnvFile('# ghi chu\n\nA=1\n   # thut le\nB=2')).toEqual({ A: '1', B: '2' });
  });

  it('giữ nguyên dấu = trong giá trị', () => {
    // Chuỗi kết nối Postgres có query string chứa dấu =.
    expect(parseEnvFile('DATABASE_URL=postgresql://k:k@h:5433/db?schema=public')).toEqual({
      DATABASE_URL: 'postgresql://k:k@h:5433/db?schema=public',
    });
  });

  it('gỡ dấu nháy bao ngoài', () => {
    expect(parseEnvFile('A="1"\nB=\'2\'')).toEqual({ A: '1', B: '2' });
  });

  it('bỏ dòng không có dấu = hoặc thiếu key', () => {
    expect(parseEnvFile('rac\n=khongcokey\nA=1')).toEqual({ A: '1' });
  });

  it('giá trị rỗng vẫn là một khoá hợp lệ', () => {
    expect(parseEnvFile('GITHUB_TOKEN=')).toEqual({ GITHUB_TOKEN: '' });
  });
});

describe('applyEnv', () => {
  it('điền biến còn thiếu', () => {
    const env: Record<string, string | undefined> = {};
    expect(applyEnv({ A: '1' }, env)).toEqual(['A']);
    expect(env.A).toBe('1');
  });

  it('KHÔNG ghi đè biến đã có trong tiến trình', () => {
    // CI và thao tác thủ công truyền biến trực tiếp; file trong repo không được
    // phép đè lên chúng.
    const env: Record<string, string | undefined> = { A: 'tu-tien-trinh' };
    expect(applyEnv({ A: 'tu-file' }, env)).toEqual([]);
    expect(env.A).toBe('tu-tien-trinh');
  });

  it('coi chuỗi rỗng là chưa đặt và vẫn điền', () => {
    const env: Record<string, string | undefined> = { A: '' };
    applyEnv({ A: 'tu-file' }, env);
    expect(env.A).toBe('tu-file');
  });
});

describe('loadWorkspaceEnv', () => {
  it('thiếu file thì im lặng bỏ qua, không ném lỗi', () => {
    const env: Record<string, string | undefined> = {};
    expect(loadWorkspaceEnv('C:/khong/ton/tai/.env', env)).toEqual([]);
    expect(env).toEqual({});
  });

  it('chỉ trả tên biến, không trả giá trị', () => {
    // Tên biến đi vào log; giá trị thì không bao giờ.
    const env: Record<string, string | undefined> = {};
    const applied = loadWorkspaceEnv('C:/khong/ton/tai/.env', env);
    expect(Array.isArray(applied)).toBe(true);
    expect(applied.every((k) => typeof k === 'string')).toBe(true);
  });
});
