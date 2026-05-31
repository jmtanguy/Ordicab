/**
 * Subtle cream backdrop — a near-flat neutral surface with two very faint
 * teal washes (matching the Ordicab brand mark). Restrained on purpose.
 */
export function AuroraBackground(): React.JSX.Element {
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
      <div className="absolute inset-0" style={{ background: '#eeece3' }} />

      <div
        className="absolute inset-[-12%]"
        style={{
          background: `
            radial-gradient(circle at 12% 8%, rgba(15, 122, 138, 0.05), transparent 36%),
            radial-gradient(circle at 88% 92%, rgba(15, 122, 138, 0.04), transparent 40%),
            radial-gradient(circle at 50% 50%, rgba(255, 255, 255, 0.6), transparent 60%)
          `
        }}
      />
    </div>
  )
}
