// Bridge stub for compiled dist to reach source JS implementation (typed)
import CryptoJS from 'crypto-js';

const getSecretKey = (): string => process.env.ENCRYPTION_KEY || 'default-secret-key';

export function encrypt(text: string): string {
  if (!text) return '';
  return CryptoJS.AES.encrypt(text, getSecretKey()).toString();
}

export function decrypt(cipher: string): string {
  if (!cipher) return '';
  try {
    const bytes = CryptoJS.AES.decrypt(cipher, getSecretKey());
    return bytes.toString(CryptoJS.enc.Utf8);
  } catch {
    return '';
  }
}

type ConnectionLike = {
  password?: string;
  passphrase?: string;
  privateKey?: string;
  [key: string]: any;
};

export function processConnectionSensitiveData<T extends ConnectionLike>(connection: T, toEncrypt = true): T {
  const c: T = { ...connection };
  if (toEncrypt) {
    if (c.password) c.password = encrypt(c.password);
    if (c.passphrase) c.passphrase = encrypt(c.passphrase);
    if (c.privateKey) c.privateKey = encrypt(c.privateKey);
  } else {
    if (c.password) c.password = decrypt(c.password);
    if (c.passphrase) c.passphrase = decrypt(c.passphrase);
    if (c.privateKey) c.privateKey = decrypt(c.privateKey);
  }
  return c;
}

const api = {
  encrypt,
  decrypt,
  processConnectionSensitiveData,
  decryptPassword: decrypt,
  decryptPrivateKey: decrypt
};

module.exports = api;
export default api;
