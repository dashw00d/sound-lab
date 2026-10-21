// How un-chill a song is (the sort's energy, about -2..2), as a marker on the chill-to-intense gradient.
export function Energy({ value, wide }: { value: number | null; wide?: boolean }) {
  if (value == null) return <span className={`energy ${wide ? 'wide' : ''} none`} />
  const at = Math.max(2, Math.min(98, 50 + 25 * value))
  return <span className={`energy ${wide ? 'wide' : ''}`} title={`energy ${value.toFixed(2)} (chill below 0, less chill above)`}><i style={{ left: `${at}%` }} /></span>
}
