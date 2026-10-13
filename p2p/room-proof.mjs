import sodium from 'sodium-universal'

export const hex = bytes => Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')
const bytes = value => Uint8Array.from(value.match(/../g), byte => parseInt(byte, 16))
export const isHex32 = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)

export function nonce() {
  const value = new Uint8Array(32)
  sodium.randombytes_buf(value)
  return hex(value)
}

function payload(role, challenge, hostKey, guestKey) {
  return Uint8Array.from(`peerarcade-room-v1:${role}:${challenge}:${hostKey}:${guestKey}`, char => char.charCodeAt(0))
}

export function proof(secret, role, challenge, hostKey, guestKey) {
  const mac = new Uint8Array(sodium.crypto_auth_BYTES)
  sodium.crypto_auth(mac, payload(role, challenge, hostKey, guestKey), bytes(secret))
  return hex(mac)
}

export function verifyProof(value, secret, role, challenge, hostKey, guestKey) {
  return isHex32(value) && sodium.crypto_auth_verify(bytes(value), payload(role, challenge, hostKey, guestKey), bytes(secret))
}
