/**
 * The user's own photo, or '' when they have none (the bundled placeholder counts as none, so the UI shows initials).
 * Uploaded photos are served by the API under /storage; external ones are absolute URLs.
 */
export function avatarSrc(avatar: string | null | undefined): string {
  const value = String(avatar || '').trim();
  return /^https?:\/\//.test(value) || value.startsWith('/storage/') ? value : '';
}
