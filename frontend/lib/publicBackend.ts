/**
 * URLs embedded in QR must be reachable from the invigilator phone (LAN IP, ngrok, etc.).
 * Use NEXT_PUBLIC_BACKEND_PUBLIC_URL for that; fall back to NEXT_PUBLIC_BACKEND_URL.
 */
export function getPublicBackendBase(): string {
  const raw =
    process.env.NEXT_PUBLIC_BACKEND_PUBLIC_URL ||
    process.env.NEXT_PUBLIC_BACKEND_URL ||
    'http://localhost:8000'
  return raw.replace(/\/$/, '')
}

export function httpToWebSocketUrl(httpUrl: string): string {
  if (httpUrl.startsWith('https://')) return `wss://${httpUrl.slice(8)}`
  if (httpUrl.startsWith('http://')) return `ws://${httpUrl.slice(7)}`
  return httpUrl
}
