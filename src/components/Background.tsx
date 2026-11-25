import {
  Bug,
  BracketsCurly,
  Code,
  Cpu,
  GitBranch,
  GitCommit,
  GitMerge,
  GitPullRequest,
  Hash,
  Key,
  LockKey,
  TerminalWindow,
  type Icon,
} from "@phosphor-icons/react";

const GLYPHS: Icon[] = [
  TerminalWindow,
  GitBranch,
  BracketsCurly,
  Key,
  Bug,
  GitCommit,
  Hash,
  Code,
  LockKey,
  GitMerge,
  Cpu,
  GitPullRequest,
];

/** Faint, so the doodles read as texture behind the UI and never as content. */
const COLORS = [
  "text-cyan-300/[0.09]",
  "text-rose-300/[0.08]",
  "text-amber-300/[0.08]",
  "text-emerald-300/[0.08]",
];

const GAP_X = 72;
const GAP_Y = 60;
// Enough to cover a maximised window on a large screen; extra cells are clipped.
const COLS = 30;
const ROWS = 22;

/** A staggered doodle wallpaper: every other row shifts half a step, and each
 *  icon gets a fixed tilt and colour from its position (deterministic, so it
 *  never reshuffles between renders). */
const CELLS = Array.from({ length: ROWS * COLS }, (_, i) => {
  const row = Math.floor(i / COLS);
  const col = i % COLS;
  return {
    Glyph: GLYPHS[(row * 5 + col * 7) % GLYPHS.length],
    color: COLORS[(row + col * 3) % COLORS.length],
    left: col * GAP_X + (row % 2) * (GAP_X / 2) + 12,
    top: row * GAP_Y + 12,
    rotate: (((row * 13 + col * 7) % 7) - 3) * 7,
  };
});

/**
 * The app-wide ambient background. Lives at the shell level so the entire
 * window, navbar included, shares one surface.
 *
 * Static radial-gradient glows instead of animated blur() blobs: paints once,
 * never repaints, and costs nothing to composite on macOS/Windows webviews
 * where filter blur is expensive. ponytail: traded pointer drift for perf.
 * The doodles are static too.
 */
export default function Background() {
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0 overflow-hidden"
      style={{
        backgroundImage: [
          "radial-gradient(420px 320px at 50% -8%, rgba(6,182,212,0.14), transparent 70%)",
          "radial-gradient(360px 300px at 108% 108%, rgba(34,211,238,0.10), transparent 70%)",
          "radial-gradient(320px 280px at -8% 108%, rgba(6,182,212,0.10), transparent 70%)",
        ].join(","),
      }}
    >
      {CELLS.map(({ Glyph, color, left, top, rotate }, i) => (
        <Glyph
          key={i}
          size={20}
          weight="regular"
          className={`absolute ${color}`}
          style={{ left, top, transform: `rotate(${rotate}deg)` }}
        />
      ))}
    </div>
  );
}
