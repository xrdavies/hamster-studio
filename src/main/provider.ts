export function providerUrl(baseUrl: string, path: string): string {
  const base = baseUrl.trim().replace(/\/+$/, '')
  return base.endsWith('/v1') ? base + path : base + '/v1' + path
}
