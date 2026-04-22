interface LightCurrent {
  key: string
  d: string
  stroke: string
  glowStroke: string
  strokeWidth: number
  pathLength: number
  pathOffset: number
  opacity: number
}

const lightCurrents: LightCurrent[] = [
  {
    key: 'current-1',
    d: 'M-180 900C96 790 248 652 420 516C578 391 746 285 956 170C1112 86 1268 24 1508 -58',
    stroke: 'rgba(110, 231, 255, 0.08)',
    glowStroke: 'url(#currentGlowA)',
    strokeWidth: 1.1,
    pathLength: 0.2,
    pathOffset: 0.18,
    opacity: 0.5
  },
  {
    key: 'current-2',
    d: 'M-220 778C12 730 222 618 430 470C640 320 818 211 1014 98C1176 6 1328 -52 1546 -126',
    stroke: 'rgba(199, 242, 255, 0.07)',
    glowStroke: 'url(#currentGlowB)',
    strokeWidth: 0.95,
    pathLength: 0.18,
    pathOffset: 0.08,
    opacity: 0.38
  },
  {
    key: 'current-3',
    d: 'M-120 1002C108 872 278 726 488 566C694 410 868 290 1086 162C1242 70 1386 12 1584 -70',
    stroke: 'rgba(56, 189, 248, 0.08)',
    glowStroke: 'url(#currentGlowC)',
    strokeWidth: 1.2,
    pathLength: 0.24,
    pathOffset: 0.24,
    opacity: 0.56
  },
  {
    key: 'current-4',
    d: 'M-260 620C-22 620 200 552 410 428C628 300 826 186 1036 70C1208 -24 1350 -72 1542 -136',
    stroke: 'rgba(147, 197, 253, 0.06)',
    glowStroke: 'url(#currentGlowA)',
    strokeWidth: 0.85,
    pathLength: 0.14,
    pathOffset: 0.14,
    opacity: 0.28
  },
  {
    key: 'current-5',
    d: 'M-140 1092C124 952 332 792 564 610C752 462 926 332 1142 198C1316 90 1448 14 1628 -72',
    stroke: 'rgba(255, 255, 255, 0.05)',
    glowStroke: 'url(#currentGlowB)',
    strokeWidth: 0.95,
    pathLength: 0.16,
    pathOffset: 0.26,
    opacity: 0.3
  }
]

export function AuroraBackground(): React.JSX.Element {
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
      <div className="absolute inset-0 bg-[#040915]" />

      <div
        className="absolute inset-[-12%]"
        style={{
          background: `
            radial-gradient(circle at 18% 76%, rgba(34, 211, 238, 0.24), transparent 22%),
            radial-gradient(circle at 42% 42%, rgba(56, 189, 248, 0.12), transparent 26%),
            radial-gradient(circle at 74% 26%, rgba(103, 232, 249, 0.1), transparent 24%),
            radial-gradient(circle at 88% 12%, rgba(96, 165, 250, 0.12), transparent 20%),
            linear-gradient(145deg, #020611 4%, #071325 44%, #0a1830 70%, #030712 100%)
          `
        }}
      />

      <div
        className="absolute inset-0 opacity-60"
        style={{
          background: `
            linear-gradient(128deg, transparent 12%, rgba(110,231,255,0.06) 38%, transparent 54%),
            linear-gradient(128deg, transparent 26%, rgba(56,189,248,0.04) 50%, transparent 68%),
            radial-gradient(circle at 72% 20%, rgba(255,255,255,0.03), transparent 14%)
          `
        }}
      />

      <div
        className="absolute left-[68%] top-[22%] h-120 w-120 -translate-x-1/2 -translate-y-1/2 rounded-full blur-2xl"
        style={{
          background:
            'radial-gradient(circle, rgba(125,211,252,0.14), rgba(56,189,248,0.05) 42%, transparent 72%)'
        }}
      />

      <div
        className="absolute left-[24%] top-[74%] h-112 w-md -translate-x-1/2 -translate-y-1/2 rounded-full blur-2xl"
        style={{
          background:
            'radial-gradient(circle, rgba(34,211,238,0.1), rgba(14,165,233,0.04) 46%, transparent 72%)'
        }}
      />

      <svg
        viewBox="0 0 1440 960"
        className="absolute inset-0 h-full w-full opacity-80"
        preserveAspectRatio="xMidYMid slice"
      >
        <defs>
          <linearGradient id="currentGlowA" x1="0%" y1="100%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="rgba(255,255,255,0)" />
            <stop offset="35%" stopColor="rgba(186,230,253,0.5)" />
            <stop offset="70%" stopColor="rgba(34,211,238,0.58)" />
            <stop offset="100%" stopColor="rgba(56,189,248,0)" />
          </linearGradient>
          <linearGradient id="currentGlowB" x1="0%" y1="100%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="rgba(255,255,255,0)" />
            <stop offset="42%" stopColor="rgba(255,255,255,0.42)" />
            <stop offset="76%" stopColor="rgba(125,211,252,0.5)" />
            <stop offset="100%" stopColor="rgba(56,189,248,0)" />
          </linearGradient>
          <linearGradient id="currentGlowC" x1="0%" y1="100%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="rgba(255,255,255,0)" />
            <stop offset="28%" stopColor="rgba(103,232,249,0.46)" />
            <stop offset="62%" stopColor="rgba(56,189,248,0.6)" />
            <stop offset="100%" stopColor="rgba(59,130,246,0)" />
          </linearGradient>
        </defs>

        {lightCurrents.map((current) => (
          <g key={current.key}>
            <path
              d={current.d}
              fill="none"
              stroke={current.stroke}
              strokeWidth={current.strokeWidth}
              strokeLinecap="round"
            />
            <path
              d={current.d}
              fill="none"
              stroke={current.glowStroke}
              strokeWidth={current.strokeWidth + 0.7}
              strokeLinecap="round"
              opacity={current.opacity}
              pathLength={1}
              strokeDasharray={`${current.pathLength} 1`}
              strokeDashoffset={-current.pathOffset}
            />
          </g>
        ))}
      </svg>

      <div className="absolute inset-0 bg-[linear-gradient(130deg,rgba(255,255,255,0.02),transparent_30%,transparent_70%,rgba(2,6,23,0.24)),radial-gradient(circle_at_78%_16%,rgba(255,255,255,0.06),transparent_14%),linear-gradient(180deg,transparent_0%,rgba(4,8,18,0.12)_76%,rgba(4,8,18,0.3)_100%)]" />
    </div>
  )
}
