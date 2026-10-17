import { CheckIcon } from "@/components/ui";
import type { CheckResult } from "@/core/schemas";

/**
 * Icono de una comprobación del motor:
 * pass → ✓ verde · fail que frena → ✗ rojo · fail que escala → ✗ ámbar · not_evaluable → ! ámbar.
 *
 * CheckIcon (ui) dibuja ✗ solo en rojo; aquí se tiñe de ámbar el ✗ que escala.
 * Propuesta para ui: un prop `tone` en CheckIcon para no tener que sobrescribir clases.
 */
const ESCALATE_FAIL = "bg-escalate-wash! ring-escalate-mark/25! [&_svg]:text-escalate-mark!";

const LABEL = {
  pass: "Cumple",
  failHold: "No cumple: frena el pago",
  failEscalate: "No cumple: pide a una persona",
  notEvaluable: "Sin datos para evaluar: pide a una persona",
} as const;

interface CheckMarkProps {
  check: Pick<CheckResult, "status" | "outcomeIfFail">;
  animate?: boolean;
  delay?: number;
  className?: string;
}

export function CheckMark({ check, animate = true, delay = 0, className }: CheckMarkProps) {
  if (check.status === "pass") {
    return <CheckIcon status="pass" animate={animate} delay={delay} label={LABEL.pass} className={className} />;
  }
  if (check.status === "not_evaluable") {
    return <CheckIcon status="warn" animate={animate} delay={delay} label={LABEL.notEvaluable} className={className} />;
  }
  const escalates = check.outcomeIfFail === "ESCALAR";
  return (
    <CheckIcon
      status="fail"
      animate={animate}
      delay={delay}
      label={escalates ? LABEL.failEscalate : LABEL.failHold}
      className={[escalates ? ESCALATE_FAIL : "", className ?? ""].join(" ").trim()}
    />
  );
}
