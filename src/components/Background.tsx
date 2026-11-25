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

/** Faint dev glyphs scattered around the edges, kept clear of the middle. */
const GLYPHS: { icon: Icon; top: string; left: string; size: number; rotate: number }[] = [
  { icon: TerminalWindow, top: "9%", left: "6%", size: 30, rotate: -12 },
  { icon: GitBranch, top: "22%", left: "88%", size: 26, rotate: 10 },
  { icon: BracketsCurly, top: "71%", left: "4%", size: 28, rotate: 8 },
  { icon: Key, top: "84%", left: "79%", size: 24, rotate: -18 },
  { icon: Bug, top: "47%", left: "93%", size: 20, rotate: 14 },
  { icon: Hash, top: "38%", left: "2%", size: 18, rotate: -6 },
  { icon: GitCommit, top: "6%", left: "63%", size: 22, rotate: 0 },
  { icon: Code, top: "91%", left: "34%", size: 24, rotate: 6 },
  { icon: LockKey, top: "60%", left: "84%", size: 18, rotate: -10 },
  { icon: GitMerge, top: "55%", left: "11%", size: 20, rotate: 12 },
  { icon: Cpu, top: "4%", left: "32%", size: 18, rotate: 8 },
  { icon: GitPullRequest, top: "93%", left: "58%", size: 18, rotate: -8 },
];

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
      {GLYPHS.map(({ icon: Glyph, top, left, size, rotate }, i) => (
        <Glyph
          key={i}
          size={size}
          weight="thin"
          className="absolute text-cyan-200/[0.07]"
          style={{ top, left, transform: `rotate(${rotate}deg)` }}
        />
      ))}
    </div>
  );
}
