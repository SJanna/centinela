"use client";

import { motion, useReducedMotion } from "motion/react";
import { useEffect, useMemo, useState } from "react";
import { cn, Mono, Sheet } from "@/components/ui";
import { CHECK_CATALOG, type CheckDefinition } from "@/core/checks";
import type { CheckCode, CheckResult, Decision } from "@/core/schemas";
import { CheckMark } from "./check-mark";
import { CHECK_ANCHOR_PREFIX, effectOf, noteNumbering } from "./decision-utils";
import { useDetail } from "./detail-context";
import { CHECK_FIELDS } from "./fields";
import { linkInvoiceIds, type InvoiceRefs } from "./invoice-links";

const GROUPS: CheckDefinition["group"][] = [...new Set(CHECK_CATALOG.map((c) => c.group))];

/** Escalonado de la primera aparición (120 ms por fila, como en el brief). */
const STAGGER = 0.12;
const EASE = [0.32, 0.72, 0, 1] as const;

function effectLabel(check: CheckResult): { text: string; className: string } | null {
  const effect = effectOf(check);
  if (!effect) return null;
  if (check.status === "not_evaluable") return { text: "Sin datos", className: "text-escalate" };
  return effect === "FRENAR" ? { text: "Frena", className: "text-hold" } : { text: "Escala", className: "text-escalate" };
}

interface ChecksPanelProps {
  decision: Pick<Decision, "summary" | "checks" | "outcome">;
  refs?: InvoiceRefs;
}

export function ChecksPanel({ decision, refs = {} }: ChecksPanelProps) {
  const checks = decision.checks;
  const { activeCheck, setActiveCheck, activeField } = useDetail();
  const reduce = useReducedMotion();
  const [onlyFailed, setOnlyFailed] = useState(false);
  // La primera vez las filas aparecen escalonadas y el trazo se dibuja; después, sin espera.
  const [intro, setIntro] = useState(true);
  useEffect(() => {
    const t = setTimeout(() => setIntro(false), CHECK_CATALOG.length * STAGGER * 1000 + 600);
    return () => clearTimeout(t);
  }, []);

  const byCode = useMemo(() => new Map(checks.map((c) => [c.code, c])), [checks]);
  const numbering = useMemo(() => noteNumbering(decision), [decision]);
  const passCount = checks.filter((c) => c.status === "pass").length;
  const failCount = checks.length - passCount;
  const relatedToField = useMemo(
    () => new Set<CheckCode>(activeField ? (Object.keys(CHECK_FIELDS) as CheckCode[]).filter((c) => CHECK_FIELDS[c].includes(activeField)) : []),
    [activeField],
  );

  return (
    <Sheet padding="none" aria-labelledby="comprobaciones-titulo" className="overflow-hidden">
      <header className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3 px-6 pt-6 pb-4">
        <div className="min-w-0 space-y-1">
          <h2 id="comprobaciones-titulo" className="text-h2">
            Comprobaciones
          </h2>
          <p className="text-small text-ink-2">
            <span className="tnum font-medium text-navy">{passCount}</span> de{" "}
            <span className="tnum">{CHECK_CATALOG.length}</span> se cumplen. Las reglas son siempre las mismas.
          </p>
        </div>
        <div role="group" aria-label="Filtrar comprobaciones" className="inline-flex rounded-pill bg-control p-0.5 text-caption font-medium">
          {(
            [
              [false, "Todas", checks.length],
              [true, "No se cumplen", failCount],
            ] as const
          ).map(([value, label, count]) => (
            <button
              key={label}
              type="button"
              aria-pressed={onlyFailed === value}
              disabled={value && failCount === 0}
              onClick={() => setOnlyFailed(value)}
              className={cn(
                "inline-flex h-7 items-center gap-1.5 rounded-pill px-3 transition-[background-color,color,box-shadow] duration-150 ease-out disabled:opacity-45",
                onlyFailed === value ? "bg-surface-0 text-navy shadow-hairline ring-1 ring-seam" : "text-ink-2 hover:text-navy",
              )}
            >
              {label}
              <span className="tnum text-ink-3">{count}</span>
            </button>
          ))}
        </div>
      </header>

      <p className="mx-6 mb-2 rounded-row bg-surface-1 px-3 py-2 text-caption text-muted">
        Si alguna frena, se frena. Si no, si alguna pide a una persona, se escala. Si todas se cumplen, se paga.
      </p>

      {onlyFailed && failCount === 0 ? (
        <p className="px-6 py-8 text-center text-small text-ink-2">Las {CHECK_CATALOG.length} comprobaciones se cumplen.</p>
      ) : (
        <div className="px-3 pb-4">
          {GROUPS.map((group) => {
            const defs = CHECK_CATALOG.filter((c) => c.group === group);
            const rows = defs
              .map((def) => ({ def, check: byCode.get(def.code) }))
              .filter((r): r is { def: CheckDefinition; check: CheckResult } => r.check != null)
              .filter((r) => !onlyFailed || r.check.status !== "pass");
            if (rows.length === 0) return null;
            const groupPass = defs.filter((d) => byCode.get(d.code)?.status === "pass").length;
            return (
              <section key={group} aria-label={group} className="mt-3 first:mt-1">
                <div className="flex items-center justify-between px-3 pb-1">
                  <h3 className="eyebrow">{group}</h3>
                  <span className="tnum text-caption text-ink-3">
                    {groupPass} de {defs.length}
                  </span>
                </div>
                <ol className="space-y-px">
                  {rows.map(({ def, check }) => {
                    const index = CHECK_CATALOG.findIndex((c) => c.code === def.code);
                    const n = numbering.get(def.code);
                    const effect = effectLabel(check);
                    const active = activeCheck === def.code;
                    const related = !active && relatedToField.has(def.code);
                    const delay = intro && !reduce ? index * STAGGER : 0;
                    return (
                      <motion.li
                        key={def.code}
                        id={n ? `${CHECK_ANCHOR_PREFIX}-${n}` : undefined}
                        data-code={def.code}
                        tabIndex={0}
                        initial={intro && !reduce ? { opacity: 0, y: 4 } : false}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.18, delay, ease: EASE }}
                        onMouseEnter={() => setActiveCheck(def.code)}
                        onMouseLeave={() => setActiveCheck(null)}
                        onFocus={() => setActiveCheck(def.code)}
                        onBlur={() => setActiveCheck(null)}
                        className={cn(
                          "relative flex scroll-mt-24 items-start gap-3 rounded-row px-3 py-3 outline-none ring-inset transition-[background-color,box-shadow] duration-150 ease-out",
                          "focus-visible:ring-2 focus-visible:ring-accent target:bg-accent-wash target:ring-1 target:ring-lavender",
                          active && "bg-row-active ring-1 ring-row-active-border",
                          related && "bg-accent-wash/70",
                        )}
                      >
                        <CheckMark check={check} animate={intro} delay={delay} className="mt-px" />
                        <div className="min-w-0 flex-1">
                          <p className="text-body font-medium text-navy">
                            {def.title}
                            {n ? (
                              <sup className="tnum ml-1 text-[0.68em] font-medium text-accent" aria-label={`Nota ${n}`}>
                                {n}
                              </sup>
                            ) : null}
                          </p>
                          <p className="mt-0.5 text-small text-pretty text-ink-2">{linkInvoiceIds(check.explanation, refs)}</p>
                        </div>
                        <div className="flex shrink-0 flex-col items-end gap-0.5 pt-0.5">
                          <Mono className="text-caption text-ink-3">{def.code}</Mono>
                          {effect ? <span className={cn("text-caption font-medium", effect.className)}>{effect.text}</span> : null}
                        </div>
                      </motion.li>
                    );
                  })}
                </ol>
              </section>
            );
          })}
        </div>
      )}
    </Sheet>
  );
}
