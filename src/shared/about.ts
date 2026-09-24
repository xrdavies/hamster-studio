export const aboutLinks = {
  repository: 'https://github.com/xrdavies/hamster-studio',
  issues: 'https://github.com/xrdavies/hamster-studio/issues',
  releases: 'https://github.com/xrdavies/hamster-studio/releases',
  author: 'https://x.com/xrdavies',
} as const

export function aboutUrl(key: string): string {
  if (!Object.prototype.hasOwnProperty.call(aboutLinks, key)) throw new Error('未知链接')
  return aboutLinks[key as keyof typeof aboutLinks]
}
