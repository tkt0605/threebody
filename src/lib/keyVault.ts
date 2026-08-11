const DB_NAME = 'threebody-vault'
const STORE_NAME = 'keys'
const KEY_ID = 'settings-key'

export interface EncryptedPayload {
  iv: string
  data: string
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE_NAME)
    }
    req.onsuccess = () => resolve(req.result)
    // req.error は DOMException | null。null のまま reject すると、受け側の
    // err instanceof Error が偽になり、画面には「null」だけが残る
    req.onerror = () => reject(req.error ?? new Error('IndexedDB を開けませんでした'))
  })
}

let cachedKey: Promise<CryptoKey> | null = null

// 非exportableなCryptoKeyをIndexedDBに保持する。生の鍵バイト列はDevToolsからも取り出せない。
function getOrCreateKey(): Promise<CryptoKey> {
  if (cachedKey) return cachedKey
  cachedKey = (async () => {
    const db = await openDb()
    const existing = await new Promise<CryptoKey | undefined>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly')
      const req = tx.objectStore(STORE_NAME).get(KEY_ID)
      req.onsuccess = () => resolve(req.result as CryptoKey | undefined)
      req.onerror = () => reject(req.error ?? new Error('暗号鍵の読み出しに失敗しました'))
    })
    if (existing) return existing

    const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite')
      tx.objectStore(STORE_NAME).put(key, KEY_ID)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error ?? new Error('暗号鍵の保存に失敗しました'))
    })
    return key
  })()
  return cachedKey
}

function toBase64(buf: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(buf)))
}

function fromBase64(str: string): Uint8Array {
  return Uint8Array.from(atob(str), c => c.charCodeAt(0))
}

export async function encryptText(plaintext: string): Promise<EncryptedPayload> {
  const key = await getOrCreateKey()
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const encoded = new TextEncoder().encode(plaintext)
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoded)
  return { iv: toBase64(iv.buffer), data: toBase64(ciphertext) }
}

export async function decryptText(payload: EncryptedPayload): Promise<string> {
  const key = await getOrCreateKey()
  const iv = fromBase64(payload.iv)
  const ciphertext = fromBase64(payload.data)
  const plainBuf = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: iv as BufferSource }, key, ciphertext as BufferSource)
  return new TextDecoder().decode(plainBuf)
}
