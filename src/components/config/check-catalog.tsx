import { ChevronDown, ShieldCheck } from "lucide-react";
import { CHECK_CATALOG, type CheckDefinition } from "@/core/checks";
import type { CheckCode } from "@/core/schemas";
import { Sheet } from "@/components/ui/sheet";
import { DecisionChip } from "@/components/ui/status";
import { Eyebrow, Mono } from "@/components/ui/typography";

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
    <li className="border-b border-seam last:border-b-0">
      <details className="group/check">
        <summary
          className="flex cursor-pointer list-none items-center gap-4 py-3.5 pr-1 transition-colors duration-150 select-none hover:text-navy [&::-webkit-details-marker]:hidden"
        >
          <Mono className="w-12 shrink-0 text-caption text-ink-3">{check.code}</Mono>
          <span className="min-w-0 flex-1 text-body font-medium text-navy">{check.title}</span>
          {rule ? (
            <a
              href={`#regla-${rule.n}`}
              title={`Ver la regla ${rule.n}: ${rule.label}.`}
              className="hidden rounded-chip bg-accent-wash px-1.5 py-0.5 text-[11px] font-medium text-accent transition-colors duration-150 outline-offset-2 hover:bg-lavender/50 sm:inline"
            >
              Regla {rule.n}
            </a>
          ) : null}
          <DecisionChip status={check.outcomeIfFail} label={holds ? "Frena" : "Escala"} />
          <ChevronDown
            aria-hidden
            size={16}
            strokeWidth={1.5}
            className="shrink-0 text-ink-3 transition-transform duration-200 ease-out group-open/check:rotate-180"
          />
        </summary>
        <div className="animate-rise pr-10 pb-4 pl-16 text-small text-ink-2">
          <p>{check.description}</p>
          <p className="mt-1.5 text-muted">
            {holds ? "Si falla, el pago se frena." : "Si falla, la factura pasa a una persona."} Si falta un dato para
            revisarla, también pasa a una persona.
            {rule ? ` Usa la regla ${rule.n}: ${rule.label}.` : ""}
          </p>
        </div>
      </details>
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
            Quince comprobaciones fijas, en este orden, para cada factura. No se pueden apagar.
          </p>
          <p className="text-small text-ink-2">
            Las marcadas con{" "}
            <span className="rounded-chip bg-accent-wash px-1 py-0.5 text-[11px] font-medium text-accent">Regla</span> usan
            las cifras de arriba.
          </p>
        </div>

        <div className="min-w-0">
          <Sheet padding="md" className="flex flex-col gap-4 sm:flex-row sm:items-start sm:gap-6">
            <Eyebrow className="shrink-0 pt-1.5 sm:w-28">Regla de decisión</Eyebrow>
            <div className="min-w-0 space-y-3">
              <p className="text-h2 text-navy">
                Se paga solo si se cumplen las 15. Si una frena, se frena. Si una escala o no se puede revisar, decide una
                persona.
              </p>
              <p className="flex gap-2 text-small text-ink-2">
                <ShieldCheck aria-hidden size={15} strokeWidth={1.5} className="mt-[2px] shrink-0 text-ink-3" />
                <span>Cada pago pasa además por una guardia independiente. Si no está de acuerdo, la factura se escala.</span>
              </p>
            </div>
          </Sheet>

          <div className="mt-6 border-y border-line">
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
