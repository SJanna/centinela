import { ShieldCheck } from "lucide-react";
import type { ReactNode } from "react";
import { CHECK_CATALOG, type CheckDefinition } from "@/core/checks";
import type { CheckCode, Outcome } from "@/core/schemas";
import { Card } from "@/components/ui/sheet";
import { DecisionChip } from "@/components/ui/status";
import { Eyebrow, Mono } from "@/components/ui/typography";

const HOLD_CODES = CHECK_CATALOG.filter((c) => c.outcomeIfFail === "FRENAR").map((c) => c.code);

/**
 * Cómo se combinan las 15 comprobaciones en una decisión: pagar, frenar o escalar.
 * Sin estado: sirve en el editor de reglas (cliente) y en el servidor.
 */
export function DecisionRuleCard({ className }: { className?: string }) {
  const rows: { outcome: Outcome; label: string; text: ReactNode }[] = [
    {
      outcome: "PAGAR",
      label: "Paga",
      text: "Solo si se cumplen las 15 comprobaciones. Antes, una guardia independiente revisa el pago; si no está de acuerdo, se escala.",
    },
    {
      outcome: "FRENAR",
      label: "Frena",
      text: (
        <>
          Si es un duplicado o no hay fondo:{" "}
          <Mono className="text-ink-3">{HOLD_CODES.join(" · ")}</Mono>. Frenar gana sobre escalar.
        </>
      ),
    },
    {
      outcome: "ESCALAR",
      label: "Escala",
      text: "Si falla cualquier otra comprobación, o si falta un dato para revisarla. Decide una persona.",
    },
  ];
  return (
    <Card as="section" padding="none" aria-labelledby="regla-de-decision" className={className}>
      <header className="flex items-baseline justify-between gap-4 px-5 pt-4 pb-3 sm:px-6">
        <Eyebrow id="regla-de-decision" as="h2">
          Regla de decisión
        </Eyebrow>
        <a
          href="#revisa-siempre"
          className="text-caption font-medium text-accent underline decoration-accent/30 underline-offset-[3px] hover:decoration-accent"
        >
          Ver las 15 comprobaciones
        </a>
      </header>
      <ul className="border-t border-seam">
        {rows.map((r) => (
          <li
            key={r.outcome}
            className="grid grid-cols-[4.75rem_minmax(0,1fr)] items-baseline gap-x-3 border-b border-seam px-5 py-3 last:border-b-0 sm:px-6"
          >
            <DecisionChip status={r.outcome} label={r.label} className="justify-self-start" />
            <p className="text-small text-ink-2">{r.text}</p>
          </li>
        ))}
      </ul>
    </Card>
  );
}

/** Qué regla editable usa cada comprobación (número de la frase de arriba). */
const RULE_LINK: Partial<Record<CheckCode, { n: string; label: string }>> = {
  "LIM-1": { n: "01", label: "umbral de aprobación" },
  "LIM-2": { n: "02", label: "límite del mes" },
  "FON-1": { n: "03", label: "fondo del agente" },
  "ACU-3": { n: "04", label: "tolerancia contra lo acordado" },
};

const GROUPS = Array.from(new Set(CHECK_CATALOG.map((c) => c.group)));

function CheckRow({ check }: { check: CheckDefinition }) {
  const rule = RULE_LINK[check.code];
  const holds = check.outcomeIfFail === "FRENAR";
  return (
    <li className="grid grid-cols-[3.25rem_minmax(0,1fr)_auto] items-start gap-x-4 border-b border-seam py-3.5 pr-1 last:border-b-0">
      <Mono className="pt-[2px] text-caption text-ink-3">{check.code}</Mono>
      <div className="min-w-0">
        <p className="text-body font-medium text-navy">{check.title}</p>
        <p className="mt-0.5 text-small text-ink-2">{check.description}</p>
      </div>
      <div className="flex items-center gap-2 pt-px">
        {rule ? (
          <a
            href={`#regla-${rule.n}`}
            title={`Usa la regla ${rule.n}: ${rule.label}.`}
            className="hidden rounded-chip bg-accent-wash px-1.5 py-0.5 text-[11px] font-medium text-accent transition-colors duration-150 hover:bg-lavender/50 sm:inline"
          >
            Regla {rule.n}
          </a>
        ) : null}
        <DecisionChip
          status={check.outcomeIfFail}
          label={holds ? "Frena" : "Escala"}
          className="w-[4.5rem] justify-center"
        />
      </div>
    </li>
  );
}

/** Las 15 comprobaciones fijas, en el orden del catálogo, agrupadas. Solo lectura. */
export function CheckCatalog({ headingId }: { headingId: string }) {
  return (
    <section aria-labelledby={headingId} className="mt-14 border-t border-line pt-10">
      <div className="grid gap-6 lg:grid-cols-[220px_minmax(0,1fr)] lg:gap-8">
        <div className="space-y-2 lg:sticky lg:top-24 lg:self-start">
          <Eyebrow>Solo lectura</Eyebrow>
          <h2 id={headingId} className="text-h2">
            Lo que Centinela revisa siempre.
          </h2>
          <p className="text-small text-ink-2">
            Quince comprobaciones fijas, en este orden, para cada factura. No se pueden apagar. A la derecha, qué pasa
            si una falla.
          </p>
          <p className="text-small text-ink-2">
            Las marcadas con{" "}
            <span className="rounded-chip bg-accent-wash px-1 py-0.5 text-[11px] font-medium text-accent">Regla</span> usan
            las cifras de arriba.
          </p>
          <p className="flex gap-2 pt-1 text-small text-ink-2">
            <ShieldCheck aria-hidden size={15} strokeWidth={1.5} className="mt-[2px] shrink-0 text-ink-3" />
            <span>Cada pago pasa además por una guardia independiente, escrita por separado.</span>
          </p>
        </div>

        <div className="min-w-0">
          <div className="border-y border-line">
            {GROUPS.map((group) => (
              <div key={group} className="grid border-b border-line last:border-b-0 md:grid-cols-[132px_minmax(0,1fr)]">
                <Eyebrow as="h3" className="pt-4 pb-1 md:pb-4">
                  {group}
                </Eyebrow>
                <ol>
                  {CHECK_CATALOG.filter((c) => c.group === group).map((check) => (
                    <CheckRow key={check.code} check={check} />
                  ))}
                </ol>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
