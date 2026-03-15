export type DataType = 'text' | 'image' | 'audio';

export interface EncryptedPayload {
  version: 1;
  salt: string; // base64
  iv: string; // base64
  ciphertext: string; // base64
  dataType: DataType;
  fileName?: string;
  fileType?: string;
}

const ITERATIONS = 100000;
const KEY_LENGTH = 256;

// Helper to convert base64 to Uint8Array
export function base64ToBytes(base64: string): Uint8Array {
  const base64abc = [
    'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M',
    'N', 'O', 'P', 'Q', 'R', 'S', 'T', 'U', 'V', 'W', 'X', 'Y', 'Z',
    'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l', 'm',
    'n', 'o', 'p', 'q', 'r', 's', 't', 'u', 'v', 'w', 'x', 'y', 'z',
    '0', '1', '2', '3', '4', '5', '6', '7', '8', '9', '+', '/'
  ];
  const base64codes = new Uint8Array(256);
  for (let i = 0; i < base64abc.length; i++) {
    base64codes[base64abc[i].charCodeAt(0)] = i;
  }
  base64codes['-'.charCodeAt(0)] = 62;
  base64codes['_'.charCodeAt(0)] = 63;

  let l = base64.length;
  if (base64[l - 2] === '=') l -= 2;
  else if (base64[l - 1] === '=') l -= 1;

  const bytes = new Uint8Array((l * 3) / 4);
  let i, j;
  for (i = 0, j = 0; i < l; i += 4, j += 3) {
    const c0 = base64codes[base64.charCodeAt(i)];
    const c1 = base64codes[base64.charCodeAt(i + 1)];
    const c2 = base64codes[base64.charCodeAt(i + 2)];
    const c3 = base64codes[base64.charCodeAt(i + 3)];
    bytes[j] = (c0 << 2) | (c1 >> 4);
    if (j + 1 < bytes.length) bytes[j + 1] = ((c1 & 15) << 4) | (c2 >> 2);
    if (j + 2 < bytes.length) bytes[j + 2] = ((c2 & 3) << 6) | c3;
  }
  return bytes;
}

// Helper to convert Uint8Array to base64
export function bytesToBase64(bytes: Uint8Array): string {
  const base64abc = [
    'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M',
    'N', 'O', 'P', 'Q', 'R', 'S', 'T', 'U', 'V', 'W', 'X', 'Y', 'Z',
    'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l', 'm',
    'n', 'o', 'p', 'q', 'r', 's', 't', 'u', 'v', 'w', 'x', 'y', 'z',
    '0', '1', '2', '3', '4', '5', '6', '7', '8', '9', '+', '/'
  ];
  let result = '';
  let i;
  const l = bytes.length;
  for (i = 2; i < l; i += 3) {
    result += base64abc[bytes[i - 2] >> 2];
    result += base64abc[((bytes[i - 2] & 0x03) << 4) | (bytes[i - 1] >> 4)];
    result += base64abc[((bytes[i - 1] & 0x0f) << 2) | (bytes[i] >> 6)];
    result += base64abc[bytes[i] & 0x3f];
  }
  if (i === l + 1) {
    result += base64abc[bytes[i - 2] >> 2];
    result += base64abc[(bytes[i - 2] & 0x03) << 4];
    result += '==';
  }
  if (i === l) {
    result += base64abc[bytes[i - 2] >> 2];
    result += base64abc[((bytes[i - 2] & 0x03) << 4) | (bytes[i - 1] >> 4)];
    result += base64abc[(bytes[i - 1] & 0x0f) << 2];
    result += '=';
  }
  return result;
}

// Derive AES key from password using PBKDF2
async function deriveKey(password: string, salt: Uint8Array): Promise<CryptoKey> {
  const encoder = new TextEncoder();
  const passwordKey = await crypto.subtle.importKey(
    'raw',
    encoder.encode(password),
    { name: 'PBKDF2' },
    false,
    ['deriveKey']
  );

  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: salt,
      iterations: ITERATIONS,
      hash: 'SHA-256',
    },
    passwordKey,
    { name: 'AES-GCM', length: KEY_LENGTH },
    false,
    ['encrypt', 'decrypt']
  );
}

export async function encryptData(
  data: Uint8Array,
  password: string,
  dataType: DataType,
  fileName?: string,
  fileType?: string
): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  
  const key = await deriveKey(password, salt);
  
  const encryptedBuffer = await crypto.subtle.encrypt(
    {
      name: 'AES-GCM',
      iv: iv,
    },
    key,
    data
  );

  const payload: EncryptedPayload = {
    version: 1,
    salt: bytesToBase64(salt),
    iv: bytesToBase64(iv),
    ciphertext: bytesToBase64(new Uint8Array(encryptedBuffer)),
    dataType,
    fileName,
    fileType,
  };

  const jsonStr = JSON.stringify(payload);
  const jsonBytes = new TextEncoder().encode(jsonStr);
  return bytesToBase64(jsonBytes);
}

export async function decryptData(
  encryptedString: string,
  password: string
): Promise<{ data: Uint8Array; dataType: DataType; fileName?: string; fileType?: string }> {
  let payload: EncryptedPayload;
  try {
    const jsonBytes = base64ToBytes(encryptedString);
    const jsonStr = new TextDecoder().decode(jsonBytes);
    payload = JSON.parse(jsonStr);
    if (payload.version !== 1) throw new Error('Unsupported version');
  } catch (e) {
    throw new Error('Corrupted encrypted data');
  }

  const salt = base64ToBytes(payload.salt);
  const iv = base64ToBytes(payload.iv);
  const ciphertext = base64ToBytes(payload.ciphertext);

  const key = await deriveKey(password, salt);

  try {
    const decryptedBuffer = await crypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv: iv,
      },
      key,
      ciphertext
    );

    return {
      data: new Uint8Array(decryptedBuffer),
      dataType: payload.dataType,
      fileName: payload.fileName,
      fileType: payload.fileType,
    };
  } catch (e) {
    throw new Error('Wrong key or corrupted data');
  }
}

export function generateSecureKey(): string {
  const array = new Uint8Array(16);
  crypto.getRandomValues(array);
  return Array.from(array, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function calculateKeyStrength(key: string): number {
  let score = 0;
  if (!key) return 0;
  if (key.length > 8) score += 25;
  if (key.length > 12) score += 25;
  if (/[A-Z]/.test(key)) score += 15;
  if (/[a-z]/.test(key)) score += 15;
  if (/[0-9]/.test(key)) score += 10;
  if (/[^A-Za-z0-9]/.test(key)) score += 10;
  return Math.min(100, score);
}
