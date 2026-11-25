import { useEffect, useState, type FormEvent } from "react";
import { Check, Robot, TerminalWindow, X } from "@phosphor-icons/react";
import { api, type CommitGuard as GuardState } from "../services/tauri";
import { Toggle } from "./ui/Toggle";
import { cn } from "../utils/cn";

/** Agents that commit on your machine and add a co-author line (cloud agents never hit a local hook). */
const PRESETS = [
  { name: "Claude Code", line: "Claude <noreply@anthropic.com>", match: "noreply@anthropic.com" },
  { name: "Codex", line: "Codex <noreply@openai.com>", match: "noreply@openai.com" },
  { name: "Cursor", line: "Cursor <cursoragent@cursor.com>", match: "cursoragent@cursor.com" },
  { name: "GitHub Copilot", line: "Copilot <…+Copilot@users.noreply.github.com>", match: "Copilot@users.noreply.github.com" },
];

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
const chip = "inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs transition-colors";
const chipOn = "border-primary-400/40 bg-primary-400/10 text-primary-200";

export default function CommitGuard() {
  const [state, setState] = useState<GuardState | null>(null);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.getCommitGuard().then(setState).catch((e) => setError(String(e)));
  }, []);

  if (!state) return error ? <p className="px-4 py-3 text-xs text-rose-400">{error}</p> : null;
  const { enabled, blocked } = state;
  const has = (entry: string) => blocked.some((e) => same(e, entry));

  const save = async (on: boolean, list: string[]) => {
    setState({ ...state, enabled: on, blocked: list }); // optimistic
    setError(null);
    try {
      setState(await api.setCommitGuard(on, list));
    } catch (e) {
      setState(state);
      setError(String(e));
    }
  };
  const toggle = (entry: string) =>
    save(enabled, has(entry) ? blocked.filter((e) => !same(e, entry)) : [...blocked, entry]);
  const add = (e: FormEvent) => {
    e.preventDefault();
    const entry = draft.trim();
    setDraft("");
    if (entry && !has(entry)) save(enabled, [...blocked, entry]);
  };

  const custom = blocked.filter((e) => !PRESETS.some((p) => same(p.match, e)));
  const removed = [
    ...PRESETS.filter((p) => has(p.match)).map((p) => p.line),
    ...custom.map((c) => `… ${c} …`),
  ];

  return (
    <div className="rounded-xl border border-white/6 bg-white/2 px-4 py-1">
      <Toggle
        label="Remove AI co-authors"
        description="Quietly deletes matching Co-authored-by lines before a commit is saved, so it stays yours. Works in every repo; your repos' own hooks still run."
        checked={enabled}
        onChange={(on) => save(on, blocked)}
      />
      <div className="h-px w-full bg-white/6" />

      <div className={cn("flex flex-col gap-3 py-3", !enabled && "opacity-60")}>
        <div className="flex flex-wrap gap-1.5">
          {PRESETS.map((p) => (
            <button
              key={p.name}
              type="button"
              title={`Co-authored-by: ${p.line}`}
              aria-pressed={has(p.match)}
              onClick={() => toggle(p.match)}
              className={cn(chip, has(p.match) ? chipOn : "border-white/10 text-neutral-400 hover:border-white/20 hover:text-neutral-200")}
            >
              {has(p.match) ? <Check size={11} weight="bold" /> : <Robot size={11} weight="bold" />}
              {p.name}
            </button>
          ))}
          {custom.map((entry) => (
            <button key={entry} type="button" onClick={() => toggle(entry)} aria-label={`Remove ${entry}`} className={cn(chip, chipOn, "hover:border-rose-400/40")}>
              {entry}
              <X size={10} weight="bold" />
            </button>
          ))}
        </div>

        <form onSubmit={add} className="flex gap-2">
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Add a name or email, e.g. bot@example.com"
            className="min-w-0 flex-1 rounded-lg border border-white/10 bg-black/20 px-3 py-1.5 text-xs text-white outline-none placeholder:text-neutral-600 focus:border-primary-400/50"
          />
          <button type="submit" disabled={!draft.trim()} className="rounded-lg border border-white/10 px-3 text-xs text-neutral-300 hover:bg-white/5 disabled:opacity-40">
            Add
          </button>
        </form>

        {removed.length > 0 && (
          <div className="overflow-hidden rounded-lg border border-white/6 bg-black/40 font-mono text-[11px] leading-relaxed">
            <div className="flex items-center gap-1.5 border-b border-white/6 px-3 py-1.5 font-sans text-[10px] uppercase tracking-wider text-neutral-500">
              <TerminalWindow size={12} weight="bold" className="text-primary-400/70" />
              {enabled ? "removed from your commits" : "would be removed"}
            </div>
            <div className="max-h-32 overflow-auto px-3 py-2 select-text">
              {removed.map((line) => (
                <div key={line} className="text-neutral-500">
                  <span className="text-rose-400/80">- </span>
                  <span className="line-through decoration-rose-400/40">Co-authored-by: {line}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        <p className="text-[11px] leading-relaxed text-neutral-500">
          Only Co-authored-by lines are touched; a commit whose <em>author</em> matches is stopped instead.{" "}
          <code className="text-neutral-400">--no-verify</code> and repos with their own hooks path (Husky) skip it.
          {state.otherHooksPath && <> Your hooks in <code className="text-neutral-400">{state.otherHooksPath}</code> still run after.</>}
        </p>
        {error && <p className="text-xs text-rose-400">{error}</p>}
      </div>
    </div>
  );
}
