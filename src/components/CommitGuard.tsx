import { useEffect, useState, type FormEvent } from "react";
import { Check, Robot, TerminalWindow, X } from "@phosphor-icons/react";
import { api, type CommitGuard as GuardState } from "../services/tauri";
import { Toggle } from "./ui/Toggle";
import { cn } from "../utils/cn";

/**
 * Agents that commit on your machine and sign the commit with a co-author line.
 * (Cloud agents commit elsewhere, so a local hook never sees them.) A preset is
 * on when all of its patterns are in the blocked list.
 */
const PRESETS = [
  {
    name: "Claude Code",
    patterns: ["noreply@anthropic.com"],
    example: "Co-authored-by: Claude <noreply@anthropic.com>",
  },
  {
    name: "Codex",
    patterns: ["noreply@openai.com"],
    example: "Co-authored-by: Codex <noreply@openai.com>",
  },
  {
    name: "Cursor",
    patterns: ["cursoragent@cursor.com"],
    example: "Co-authored-by: Cursor <cursoragent@cursor.com>",
  },
  {
    name: "GitHub Copilot",
    patterns: ["Copilot@users.noreply.github.com"],
    example: "Co-authored-by: Copilot <…+Copilot@users.noreply.github.com>",
  },
] as const;

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
const has = (list: string[], entry: string) => list.some((e) => same(e, entry));

export default function CommitGuard() {
  const [state, setState] = useState<GuardState | null>(null);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.getCommitGuard().then(setState).catch((e) => setError(String(e)));
  }, []);

  if (!state) {
    return error ? <p className="px-4 py-3 text-xs text-rose-400">{error}</p> : null;
  }

  const save = async (enabled: boolean, blocked: string[]) => {
    const previous = state;
    setState({ ...state, enabled, blocked }); // optimistic
    setError(null);
    try {
      setState(await api.setCommitGuard(enabled, blocked));
    } catch (e) {
      setState(previous);
      setError(String(e));
    }
  };

  const presetOn = (patterns: readonly string[]) =>
    patterns.every((p) => has(state.blocked, p));

  const togglePreset = (patterns: readonly string[]) => {
    const next = presetOn(patterns)
      ? state.blocked.filter((e) => !patterns.some((p) => same(p, e)))
      : [...state.blocked, ...patterns.filter((p) => !has(state.blocked, p))];
    save(state.enabled, next);
  };

  const custom = state.blocked.filter(
    (e) => !PRESETS.some((preset) => preset.patterns.some((p) => same(p, e)))
  );

  const addCustom = (e: FormEvent) => {
    e.preventDefault();
    const entry = draft.trim();
    if (!entry) return;
    setDraft("");
    if (!has(state.blocked, entry)) save(state.enabled, [...state.blocked, entry]);
  };

  const examples = [
    ...PRESETS.filter((p) => presetOn(p.patterns)).map((p) => p.example),
    ...custom.map((c) => `Co-authored-by: … ${c} …`),
  ];

  return (
    <div className="rounded-xl border border-white/6 bg-white/2 px-4 py-1">
      <Toggle
        label="Remove AI co-authors"
        description="Quietly deletes Co-authored-by lines that match your list before a commit is saved, so the commit stays yours. Works in every repo, and your repos' own hooks still run."
        checked={state.enabled}
        onChange={(checked) => save(checked, state.blocked)}
      />

      <div className="h-px bg-white/6 w-full" />

      <div className={cn("py-3 flex flex-col gap-3", !state.enabled && "opacity-60")}>
        <div>
          <span className="text-xs font-medium text-neutral-400">Remove these</span>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {PRESETS.map((preset) => {
              const on = presetOn(preset.patterns);
              return (
                <button
                  key={preset.name}
                  type="button"
                  title={preset.example}
                  aria-pressed={on}
                  onClick={() => togglePreset(preset.patterns)}
                  className={cn(
                    "inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs transition-colors",
                    on
                      ? "border-primary-400/40 bg-primary-400/10 text-primary-200"
                      : "border-white/10 text-neutral-400 hover:border-white/20 hover:text-neutral-200"
                  )}
                >
                  {on ? <Check size={11} weight="bold" /> : <Robot size={11} weight="bold" />}
                  {preset.name}
                </button>
              );
            })}
            {custom.map((entry) => (
              <span
                key={entry}
                className="inline-flex items-center gap-1 rounded-full border border-primary-400/40 bg-primary-400/10 py-1 pl-2.5 pr-1.5 text-xs text-primary-200"
              >
                {entry}
                <button
                  type="button"
                  aria-label={`Remove ${entry}`}
                  onClick={() =>
                    save(
                      state.enabled,
                      state.blocked.filter((e) => !same(e, entry))
                    )
                  }
                  className="rounded-full p-0.5 text-primary-300/70 hover:bg-white/10 hover:text-white"
                >
                  <X size={10} weight="bold" />
                </button>
              </span>
            ))}
          </div>
        </div>

        <form onSubmit={addCustom} className="flex gap-2">
          <input
            type="text"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Add a name or email, e.g. bot@example.com"
            className="min-w-0 flex-1 rounded-lg border border-white/10 bg-black/20 px-3 py-1.5 text-xs text-white outline-none transition-colors placeholder:text-neutral-600 focus:border-primary-400/50"
          />
          <button
            type="submit"
            disabled={!draft.trim()}
            className="rounded-lg border border-white/10 px-3 text-xs text-neutral-300 transition-colors hover:bg-white/5 disabled:opacity-40"
          >
            Add
          </button>
        </form>

        {examples.length > 0 && (
          <div className="overflow-hidden rounded-lg border border-white/6 bg-black/40">
            <div className="flex items-center gap-1.5 border-b border-white/6 px-3 py-1.5 text-[10px] uppercase tracking-wider text-neutral-500">
              <TerminalWindow size={12} weight="bold" className="text-primary-400/70" />
              {state.enabled ? "removed from your commits" : "would be removed"}
            </div>
            <pre className="max-h-32 overflow-auto px-3 py-2 font-mono text-[11px] leading-relaxed select-text">
              {examples.map((line) => (
                <div key={line} className="flex gap-2">
                  <span className="text-rose-400/80">-</span>
                  <span className="text-neutral-500 line-through decoration-rose-400/40">{line}</span>
                </div>
              ))}
            </pre>
          </div>
        )}

        <p className="text-[11px] leading-relaxed text-neutral-500">
          Matching ignores case and only touches Co-authored-by lines, so a message that mentions a
          name is left alone. A commit whose author matches is stopped instead, because a hook
          can't change the author. <code className="text-neutral-400">git commit --no-verify</code>{" "}
          skips this (Aider commits that way by default), and so do repos that set their own hooks
          path (like Husky).
          {state.otherHooksPath && (
            <>
              {" "}Your hooks in <code className="text-neutral-400">{state.otherHooksPath}</code> keep
              running after the check.
            </>
          )}
        </p>

        {error && <p className="text-xs text-rose-400">{error}</p>}
      </div>
    </div>
  );
}
