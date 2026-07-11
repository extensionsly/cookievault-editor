import { describe, expect, it } from 'vitest';
import {
  parseVaultConflict,
  parseVaultGet,
  serializeVaultPut,
  VaultGetResponseSchema,
  VaultPutBodySchema,
} from '../wire.js';

const KDF = { algo: 'PBKDF2-SHA256' as const, iterations: 600_000, salt: 'AAAA' };
const VALID_PUT = { ciphertext: 'aGVsbG8', kdfMeta: KDF, sha256Hint: 'sha256-hint' };

describe('VaultPutBodySchema', () => {
  it('accepts a well-formed body', () => {
    expect(VaultPutBodySchema.safeParse(VALID_PUT).success).toBe(true);
  });

  it('rejects extra fields', () => {
    expect(VaultPutBodySchema.safeParse({ ...VALID_PUT, extra: 1 }).success).toBe(false);
  });

  it('rejects empty ciphertext', () => {
    expect(VaultPutBodySchema.safeParse({ ...VALID_PUT, ciphertext: '' }).success).toBe(false);
  });

  it('rejects wrong KDF algo', () => {
    const bad = { ...VALID_PUT, kdfMeta: { ...KDF, algo: 'scrypt' } };
    expect(VaultPutBodySchema.safeParse(bad).success).toBe(false);
  });

  it('rejects zero or negative iterations', () => {
    expect(
      VaultPutBodySchema.safeParse({
        ...VALID_PUT,
        kdfMeta: { ...KDF, iterations: 0 },
      }).success,
    ).toBe(false);
  });
});

describe('serializeVaultPut', () => {
  it('produces stable JSON', () => {
    const a = serializeVaultPut(VALID_PUT);
    const b = serializeVaultPut(VALID_PUT);
    expect(a).toBe(b);
  });

  it('throws on invalid input', () => {
    expect(() => serializeVaultPut({ ...VALID_PUT, ciphertext: '' } as never)).toThrow();
  });
});

describe('parseVaultGet', () => {
  it('accepts the canonical worker response', () => {
    const out = parseVaultGet({
      ciphertext: 'aGVsbG8',
      sha256Hint: 'sha256-hint',
      kdfMeta: KDF,
      updatedAt: 1_700_000_000,
    });
    expect(out.sha256Hint).toBe('sha256-hint');
    expect(out.kdfMeta).toEqual(KDF);
  });

  it('throws on missing field', () => {
    expect(() =>
      parseVaultGet({
        ciphertext: 'x',
        sha256Hint: 'y',
        kdfMeta: KDF,
        // missing updatedAt
      }),
    ).toThrow();
  });
});

describe('parseVaultConflict', () => {
  it('parses a 412 conflict body', () => {
    expect(parseVaultConflict({ error: 'precondition_failed', currentSha256Hint: 'h' })).toEqual({
      error: 'precondition_failed',
      currentSha256Hint: 'h',
    });
  });

  it('returns null for a different error shape', () => {
    expect(parseVaultConflict({ error: 'other' })).toBeNull();
    expect(parseVaultConflict(null)).toBeNull();
    expect(parseVaultConflict({})).toBeNull();
  });
});

describe('schema is symmetric with worker', () => {
  it('GET response uses the same KDF schema as PUT body', () => {
    const sample = VALID_PUT;
    const getResp = {
      ciphertext: sample.ciphertext,
      sha256Hint: sample.sha256Hint,
      kdfMeta: sample.kdfMeta,
      updatedAt: 1,
    };
    expect(VaultGetResponseSchema.safeParse(getResp).success).toBe(true);
  });
});
