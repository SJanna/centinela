"use client";

import { Eye, EyeOff } from "lucide-react";
import { useId, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { requestJson } from "./api";
import { FieldError, controlClasses } from "./fields";
import { safeNextPath } from "./safe-next";

/** Formulario del código de acceso. Al entrar va a `next` (ya validado en el servidor). */
export function AccessForm({ next }: { next: string }) {
  const uid = useId();
  const [code, setCode] = useState("");
  const [visible, setVisible] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy || done) return;
    const value = code.trim();
    if (!value) {
      setError("Escribe el código.");
      return;
    }
    setBusy(true);
    setError(null);
    const r = await requestJson<{ ok: true }>("/api/access", { method: "POST", body: { code: value } });
    if (!r.ok) {
      setBusy(false);
      setError(r.status === 401 ? "Código incorrecto." : r.status === 400 ? "Escribe el código." : r.error);
      return;
    }
    setDone(true);
    // Navegación completa: la cookie nueva viaja en la petición y el armazón carga desde cero.
    window.location.replace(safeNextPath(next));
  }

  const inputId = `${uid}-code`;
  const errorId = `${uid}-error`;
  return (
    <form onSubmit={submit} noValidate className="space-y-4">
      <div className="space-y-1.5">
        <label htmlFor={inputId} className="text-small font-medium text-navy">
          Código de acceso
        </label>
        <div className="relative">
          <input
            id={inputId}
            type={visible ? "text" : "password"}
            value={code}
            onChange={(e) => {
              setCode(e.target.value);
              if (error) setError(null);
            }}
            autoFocus
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            maxLength={200}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? errorId : undefined}
            className={controlClasses(Boolean(error), "h-11 pr-11 font-mono text-[14px] tracking-[0.04em]")}
          />
          <button
            type="button"
            onClick={() => setVisible((v) => !v)}
            aria-label={visible ? "Ocultar el código" : "Mostrar el código"}
            aria-pressed={visible}
            className="absolute top-1/2 right-1.5 grid size-8 -translate-y-1/2 place-items-center rounded-full text-ink-3 transition-colors duration-150 hover:bg-surface-2 hover:text-ink-2"
          >
            {visible ? <EyeOff aria-hidden size={16} strokeWidth={1.5} /> : <Eye aria-hidden size={16} strokeWidth={1.5} />}
          </button>
        </div>
        <div aria-live="polite" className="min-h-[18px]">
          {error ? <FieldError id={errorId}>{error}</FieldError> : null}
        </div>
      </div>
      <Button type="submit" arrow="next" className="w-full" disabled={busy || done}>
        {done ? "Entrando…" : busy ? "Revisando…" : "Entrar"}
      </Button>
    </form>
  );
}
