import { motion, useReducedMotion } from 'framer-motion'

interface LightCurrent {
  key: string
  d: string
  stroke: string
  glowStroke: string
  strokeWidth: number
  duration: number
  delay: number
  driftX: number[]
  driftY: number[]
  pathLength: number[]
  pathOffset: number[]
  opacity: number[]
}

const lightCurrents: LightCurrent[] = [
  {
    key: 'current-1',
    d: 'M-180 900C96 790 248 652 420 516C578 391 746 285 956 170C1112 86 1268 24 1508 -58',
    stroke: 'rgba(110, 231, 255, 0.08)',
    glowStroke: 'url(#currentGlowA)',
    strokeWidth: 1.1,
    duration: 16,
    delay: 0,
    driftX: [0, 36, 0],
    driftY: [0, -26, 0],
    pathLength: [0.12, 0.2, 0.12],
    pathOffset: [1, 0.18, -0.38],
    opacity: [0, 0.5, 0]
  },
  {
    key: 'current-2',
    d: 'M-220 778C12 730 222 618 430 470C640 320 818 211 1014 98C1176 6 1328 -52 1546 -126',
    stroke: 'rgba(199, 242, 255, 0.07)',
    glowStroke: 'url(#currentGlowB)',
    strokeWidth: 0.95,
    duration: 18,
    delay: 1.2,
    driftX: [0, 32, 0],
    driftY: [0, -22, 0],
    pathLength: [0.1, 0.18, 0.1],
    pathOffset: [0.92, 0.08, -0.46],
    opacity: [0, 0.38, 0]
  },
  {
    key: 'current-3',
    d: 'M-120 1002C108 872 278 726 488 566C694 410 868 290 1086 162C1242 70 1386 12 1584 -70',
    stroke: 'rgba(56, 189, 248, 0.08)',
    glowStroke: 'url(#currentGlowC)',
    strokeWidth: 1.2,
    duration: 15,
    delay: 0.6,
    driftX: [0, 40, 0],
    driftY: [0, -28, 0],
    pathLength: [0.14, 0.24, 0.14],
    pathOffset: [1.04, 0.24, -0.34],
    opacity: [0, 0.56, 0]
  },
  {
    key: 'current-4',
    d: 'M-260 620C-22 620 200 552 410 428C628 300 826 186 1036 70C1208 -24 1350 -72 1542 -136',
    stroke: 'rgba(147, 197, 253, 0.06)',
    glowStroke: 'url(#currentGlowA)',
    strokeWidth: 0.85,
    duration: 20,
    delay: 2.4,
    driftX: [0, 26, 0],
    driftY: [0, -18, 0],
    pathLength: [0.08, 0.14, 0.08],
    pathOffset: [0.96, 0.14, -0.52],
    opacity: [0, 0.28, 0]
  },
  {
    key: 'current-5',
    d: 'M-140 1092C124 952 332 792 564 610C752 462 926 332 1142 198C1316 90 1448 14 1628 -72',
    stroke: 'rgba(255, 255, 255, 0.05)',
    glowStroke: 'url(#currentGlowB)',
    strokeWidth: 0.95,
    duration: 22,
    delay: 1.8,
    driftX: [0, 30, 0],
    driftY: [0, -20, 0],
    pathLength: [0.08, 0.16, 0.08],
    pathOffset: [1.08, 0.26, -0.48],
    opacity: [0, 0.3, 0]
  }
]

export function AuroraBackground(): React.JSX.Element {
  const reduceMotion = useReducedMotion()

  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
      <div className="absolute inset-0 bg-[#040915]" />

      <motion.div
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
        animate={reduceMotion ? undefined : { scale: [1, 1.02, 1], x: [0, -10, 0], y: [0, 8, 0] }}
        transition={
          reduceMotion ? undefined : { duration: 24, repeat: Infinity, ease: 'easeInOut' }
        }
      />

      <motion.div
        className="absolute inset-0 opacity-90 mix-blend-screen"
        style={{
          background: `
            linear-gradient(128deg, transparent 12%, rgba(110,231,255,0.08) 38%, transparent 54%),
            linear-gradient(128deg, transparent 26%, rgba(56,189,248,0.05) 50%, transparent 68%),
            radial-gradient(circle at 72% 20%, rgba(255,255,255,0.04), transparent 14%)
          `
        }}
        animate={
          reduceMotion ? undefined : { opacity: [0.24, 0.42, 0.24], x: [0, 6, 0], y: [0, -4, 0] }
        }
        transition={
          reduceMotion ? undefined : { duration: 14, repeat: Infinity, ease: 'easeInOut' }
        }
      />

      <motion.div
        className="absolute left-[68%] top-[22%] h-[30rem] w-[30rem] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[radial-gradient(circle,rgba(125,211,252,0.14),rgba(56,189,248,0.05)_42%,transparent_72%)] blur-3xl"
        animate={reduceMotion ? undefined : { scale: [1, 1.05, 1], opacity: [0.08, 0.16, 0.08] }}
        transition={
          reduceMotion ? undefined : { duration: 18, repeat: Infinity, ease: 'easeInOut' }
        }
      />

      <motion.div
        className="absolute left-[24%] top-[74%] h-[28rem] w-[28rem] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[radial-gradient(circle,rgba(34,211,238,0.1),rgba(14,165,233,0.04)_46%,transparent_72%)] blur-3xl"
        animate={reduceMotion ? undefined : { scale: [1, 1.06, 1], opacity: [0.06, 0.14, 0.06] }}
        transition={
          reduceMotion ? undefined : { duration: 20, repeat: Infinity, ease: 'easeInOut' }
        }
      />

      <motion.svg
        viewBox="0 0 1440 960"
        className="absolute inset-0 h-full w-full mix-blend-screen"
        preserveAspectRatio="xMidYMid slice"
        animate={reduceMotion ? undefined : { x: [0, 10, 0], y: [0, -8, 0] }}
        transition={
          reduceMotion ? undefined : { duration: 28, repeat: Infinity, ease: 'easeInOut' }
        }
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
          <motion.g
            key={current.key}
            style={{ originX: 0.5, originY: 0.5 }}
            animate={reduceMotion ? undefined : { x: current.driftX, y: current.driftY }}
            transition={
              reduceMotion
                ? undefined
                : {
                    duration: current.duration + 8,
                    delay: current.delay,
                    repeat: Infinity,
                    ease: 'easeInOut'
                  }
            }
          >
            <path
              d={current.d}
              fill="none"
              stroke={current.stroke}
              strokeWidth={current.strokeWidth}
              strokeLinecap="round"
            />
            <motion.path
              d={current.d}
              fill="none"
              stroke={current.glowStroke}
              strokeWidth={current.strokeWidth + 0.7}
              strokeLinecap="round"
              animate={
                reduceMotion
                  ? undefined
                  : {
                      pathLength: current.pathLength,
                      pathOffset: current.pathOffset,
                      opacity: current.opacity
                    }
              }
              transition={
                reduceMotion
                  ? undefined
                  : {
                      duration: current.duration,
                      delay: current.delay,
                      repeat: Infinity,
                      ease: 'easeInOut'
                    }
              }
            />
          </motion.g>
        ))}

        <motion.path
          d="M-80 848C164 740 412 562 624 392C850 210 1056 66 1360 -92"
          fill="none"
          stroke="rgba(255,255,255,0.07)"
          strokeWidth="0.9"
          strokeDasharray="4 16"
          strokeLinecap="round"
          animate={
            reduceMotion ? undefined : { strokeDashoffset: [0, -40], opacity: [0.04, 0.1, 0.04] }
          }
          transition={reduceMotion ? undefined : { duration: 12, repeat: Infinity, ease: 'linear' }}
        />
        <motion.path
          d="M40 1020C296 840 560 636 772 458C984 280 1190 124 1496 -18"
          fill="none"
          stroke="rgba(125,211,252,0.09)"
          strokeWidth="1"
          strokeDasharray="3 14"
          strokeLinecap="round"
          animate={
            reduceMotion ? undefined : { strokeDashoffset: [0, -46], opacity: [0.03, 0.09, 0.03] }
          }
          transition={
            reduceMotion
              ? undefined
              : { duration: 13, repeat: Infinity, ease: 'linear', delay: 1.1 }
          }
        />
      </motion.svg>

      <motion.svg
        viewBox="0 0 1440 960"
        className="absolute inset-0 h-full w-full opacity-90"
        preserveAspectRatio="xMidYMid slice"
        animate={
          reduceMotion ? undefined : { x: [0, 6, 0], y: [0, -6, 0], rotate: [-0.2, 0.2, -0.2] }
        }
        transition={
          reduceMotion ? undefined : { duration: 30, repeat: Infinity, ease: 'easeInOut' }
        }
      >
        <motion.path
          d="M-120 944C132 808 364 664 576 500C786 338 992 190 1268 50"
          fill="none"
          stroke="rgba(34,211,238,0.04)"
          strokeWidth="16"
          strokeLinecap="round"
          animate={reduceMotion ? undefined : { opacity: [0.01, 0.04, 0.01] }}
          transition={
            reduceMotion ? undefined : { duration: 18, repeat: Infinity, ease: 'easeInOut' }
          }
        />
        <motion.path
          d="M-48 1066C196 904 430 734 642 560C886 360 1108 194 1432 20"
          fill="none"
          stroke="rgba(147,197,253,0.035)"
          strokeWidth="12"
          strokeLinecap="round"
          animate={reduceMotion ? undefined : { opacity: [0.008, 0.028, 0.008] }}
          transition={
            reduceMotion
              ? undefined
              : { duration: 22, repeat: Infinity, ease: 'easeInOut', delay: 0.8 }
          }
        />
      </motion.svg>

      <div className="absolute inset-0 bg-[linear-gradient(130deg,rgba(255,255,255,0.02),transparent_30%,transparent_70%,rgba(2,6,23,0.24)),radial-gradient(circle_at_78%_16%,rgba(255,255,255,0.06),transparent_14%),linear-gradient(180deg,transparent_0%,rgba(4,8,18,0.12)_76%,rgba(4,8,18,0.3)_100%)]" />
    </div>
  )
}
