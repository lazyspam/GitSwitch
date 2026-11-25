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

// A sparse, even grid: every other row shifts half a step, each icon gets a
// small fixed tilt. Same size and colour everywhere so nothing looks clumped.
const GAP_X = 150;
const GAP_Y = 120;
const COLS = 14; // enough for a large maximised window; the rest is clipped
const ROWS = 10;
const CELLS = Array.from({ length: ROWS * COLS }, (_, i) => {
  const row = Math.floor(i / COLS);
  const col = i % COLS;
  return {
    Glyph: GLYPHS[(row * 5 + col * 7) % GLYPHS.length],
    left: col * GAP_X + (row % 2) * (GAP_X / 2) + 40,
    top: row * GAP_Y + 36,
    rotate: (((row * 13 + col * 7) % 5) - 2) * 8,
  };
});

/**
 * The app-wide ambient background. Lives at the shell level so the entire
 * window, navbar included, shares one surface.
 *
 * Static radial-gradient glows instead of animated blur() blobs: paints once,
 * never repaints, and costs nothing to composite on macOS/Windows webviews
 * where filter blur is expensive. ponytail: traded pointer drift for perf.
 * The glyphs are static too.
 */
export default function Background() {
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0 overflow-hidden"
      style={{
        backgroundImage: [
          // Large ellipses with an eased falloff, so the glow fades out with no visible edge.
          "radial-gradient(720px 520px at 50% -12%, rgba(6,182,212,0.12), rgba(6,182,212,0.05) 40%, rgba(6,182,212,0.015) 70%, transparent 100%)",
          "radial-gradient(620px 480px at 108% 110%, rgba(34,211,238,0.08), rgba(34,211,238,0.03) 45%, transparent 100%)",
          "radial-gradient(580px 460px at -8% 110%, rgba(6,182,212,0.08), rgba(6,182,212,0.03) 45%, transparent 100%)",
        ].join(","),
      }}
    >
      {CELLS.map(({ Glyph, left, top, rotate }, i) => (
        <Glyph
          key={i}
          size={20}
          weight="thin"
          className="absolute text-cyan-200/[0.07]"
          style={{ left, top, transform: `rotate(${rotate}deg)` }}
        />
      ))}
    </div>
  );
}
