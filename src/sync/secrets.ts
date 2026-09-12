import { db } from '../db';

let encryptionKey: CryptoKey | null = null;

async function getOrCreateKey(): Promise<CryptoKey> {
  if (encryptionKey) return encryptionKey;

  const meta = await db.meta.get('encryptionKey');
  if (meta) {
    encryptionKey = await crypto.subtle.importKey(
      'jwk',
      meta.value as JsonWebKey,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt'],
    );
    return encryptionKey;
  }

  encryptionKey = await crypto.subtle.generateKey(
    { name: 'AES-GCM', length: 256 },
    true,
    ['encrypt', 'decrypt'],
  );

  const exported = await crypto.subtle.exportKey('jwk', encryptionKey);
  await db.meta.put({ key: 'encryptionKey', value: exported });

  return encryptionKey;
}

export async function storeSecret(id: string, value: string): Promise<void> {
  const key = await getOrCreateKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(value);
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    encoded,
  );
  await db.secrets.put({ id, encrypted, iv });
}

export async function getSecret(id: string): Promise<string | null> {
  const entry = await db.secrets.get(id);
  if (!entry) return null;

  const key = await getOrCreateKey();
  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: new Uint8Array(entry.iv) },
    key,
    entry.encrypted,
  );
  return new TextDecoder().decode(decrypted);
}

export async function deleteSecret(id: string): Promise<void> {
  await db.secrets.delete(id);
}

export async function hasSecret(id: string): Promise<boolean> {
  const count = await db.secrets.where('id').equals(id).count();
  return count > 0;
}
