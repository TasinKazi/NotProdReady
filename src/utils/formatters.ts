/**
 * Formats an ISO 8601 timestamp into a human-readable string.
 * Example: "2026-08-29T10:04:21Z" → "Aug 29, 2026 · 10:04:21 AM"
 */
export function formatTimestamp(iso: string): string {
  if (!iso) return ''
  const date = new Date(iso)
  if (isNaN(date.getTime())) return iso

  const datePart = date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
  const timePart = date.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
  })
  return `${datePart} · ${timePart}`
}
