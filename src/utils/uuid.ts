const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function isUuidV4(value: unknown): value is string {
  return typeof value === 'string' && UUID_PATTERN.test(value)
}

export function createUuidV4(): string | null {
  const cryptoApi = globalThis.crypto
  if (!cryptoApi) return null

  try {
    if (typeof cryptoApi.randomUUID === 'function') {
      const value = cryptoApi.randomUUID()
      if (isUuidV4(value)) return value
    }
  } catch {
    // LAN内HTTPなどでrandomUUIDが利用できない場合だけfallbackへ進む。
  }

  if (typeof cryptoApi.getRandomValues !== 'function') return null

  try {
    const bytes = new Uint8Array(16)
    cryptoApi.getRandomValues(bytes)
    bytes[6] = (bytes[6] & 0x0f) | 0x40
    bytes[8] = (bytes[8] & 0x3f) | 0x80
    const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
    const value = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
    return isUuidV4(value) ? value : null
  } catch {
    return null
  }
}
