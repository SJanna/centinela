"use client";

import { FileJson, TriangleAlert } from "lucide-react";
import { useId, useState } from "react";
import type { Company } from "@/core/schemas";
import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { DropZone } from "@/components/ui/drop-zone";
import { Eyebrow, Mono } from "@/components/ui/typography";
import { requestJson } from "./api";
import { FieldError, Notice, controlClasses } from "./fields";
import { CloseButton } from "./overlay";

type Source = "file" | "paste";

interface Parsed {
  list: unknown[];
  /** Nombres legibles para la vista previa. */
  names: string[];
  origin: string;
}

const MAX_IMPORT_BYTES = 2 * 1024 * 1024;

/** Acepta una lista de proveedores o un objeto con `vendors` (como dataset/company.json). */
function parseImport(text: string, origin: string): { ok: true; value: Parsed } | { ok: false; error: string } {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return { ok: false, error: "El texto no es JSON válido. Revisa comas, comillas y llaves." };
  }
  const list = Array.isArray(data)
    ? data
    : data && typeof data === "object" && Array.isArray((data as { vendors?: unknown }).vendors)
      ? (data as { vendors: unknown[] }).vendors
      : null;
  if (!list) return { ok: false, error: "Se esperaba una lista de proveedores, o un objeto con la lista en «vendors»." };
  const names = list.map((v, i) =>
    v && typeof v === "object" && typeof (v as { name?: unknown }).name === "string" ? (v as { name: string }).name : `Proveedor ${i + 1}`,
  );
  return { ok: true, value: { list, names, origin } };
}

/**
 * Separa el error de validación de la API en líneas y pone el nombre del proveedor en vez del índice:
 * "La lista…: 0.aliases: Entrada inválida; 1.account: …" → ["Camila… · aliases: Entrada inválida", …].
 */
function explainServerError(message: string, names: string[]): { head: string; items: string[] } {
  const m = /^([^:]+):\s([\s\S]+?)\.?$/.exec(message);
  if (!m) return { head: message, items: [] };
  const items = m[2].split("; ").map((issue) => {
    const path = /^(\d+)\.([^:]+):\s(.*)$/.exec(issue);
    if (!path) return issue;
    const who = names[Number(path[1])] ?? `Proveedor ${Number(path[1]) + 1}`;
    return `${who} · ${path[2]}: ${path[3]}`;
  });
  return { head: `${m[1]}.`, items };
}

interface ImportVendorsProps {
  titleId: string;
  currentCount: number;
  onClose: () => void;
  onImported: (company: Company) => void;
}

/** Importar JSON: elegir archivo o pegar, ver qué entra y reemplazar la ficha (PUT /api/company/vendors). */
export function ImportVendors({ titleId, currentCount, onClose, onImported }: ImportVendorsProps) {
  const uid = useId();
  const [source, setSource] = useState<Source>("file");
  const [text, setText] = useState("");
  const [parsed, setParsed] = useState<Parsed | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  function check(raw: string, origin: string) {
    setServerError(null);
    if (!raw.trim()) {
      setParsed(null);
      setParseError(null);
      return;
    }
    const r = parseImport(raw, origin);
    if (r.ok) {
      setParsed(r.value);
      setParseError(null);
    } else {
      setParsed(null);
      setParseError(r.error);
    }
  }

  async function readFile(files: File[]) {
    const file = files[0];
    if (!file) return;
    if (file.size > MAX_IMPORT_BYTES) {
      setParsed(null);
      setParseError("El archivo pesa más de 2 MB. Una ficha de proveedores no debería ser tan grande.");
      return;
    }
    const content = await file.text();
    check(content, file.name);
  }

  async function submit() {
    if (!parsed) return;
    setSaving(true);
    setServerError(null);
    const r = await requestJson<{ company: Company }>("/api/company/vendors", { method: "PUT", body: parsed.list });
    setSaving(false);
    if (!r.ok) {
      setServerError(r.error);
      return;
    }
    onImported(r.data.company);
  }

  return (
    <div className="flex flex-col">
      <header className="flex items-start justify-between gap-4 px-6 pt-5 pb-4">
        <div className="space-y-1">
          <Eyebrow>Proveedores</Eyebrow>
          <h2 id={titleId} className="text-h2">
            Importar JSON.
          </h2>
          <p id={`${uid}-desc`} className="text-small text-ink-2">
            Reemplaza toda la ficha de proveedores. Acepta una lista o un archivo con la lista en «vendors».
          </p>
        </div>
        <CloseButton onClick={onClose} />
      </header>

      <div className="space-y-4 px-6 pb-5">
        <div role="tablist" aria-label="Origen" className="inline-flex rounded-pill bg-surface-2 p-1">
          {(
            [
              ["file", "Archivo"],
              ["paste", "Pegar texto"],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={source === key}
              onClick={() => {
                setSource(key);
                setParsed(null);
                setParseError(null);
                setServerError(null);
              }}
              className={cn(
                "h-7 rounded-pill px-3 text-caption font-medium transition-[background-color,color,box-shadow] duration-150",
                source === key ? "bg-surface-0 text-navy shadow-[0_1px_2px_#1c253a1f] ring-1 ring-seam" : "text-ink-2 hover:text-navy",
              )}
            >
              {label}
            </button>
          ))}
        </div>

        {source === "file" ? (
          <DropZone
            multiple={false}
            accept="application/json,.json"
            title="Suelta aquí el archivo JSON."
            hint="Un .json de hasta 2 MB"
            onFiles={(files) => void readFile(files)}
            className="min-h-[148px]"
          />
        ) : (
          <div className="space-y-1.5">
            <label htmlFor={`${uid}-text`} className="text-small font-medium text-navy">
              JSON de proveedores
            </label>
            <textarea
              id={`${uid}-text`}
              data-autofocus
              rows={8}
              spellCheck={false}
              value={text}
              onChange={(e) => {
                setText(e.target.value);
                check(e.target.value, "texto pegado");
              }}
              placeholder={'[\n  { "id": "v-nopal", "name": "Estudio Nopal S. de R.L.", … }\n]'}
              className={controlClasses(Boolean(parseError), "h-auto min-h-[180px] resize-y py-2.5 font-mono text-[12.5px] leading-[1.55]")}
            />
          </div>
        )}

        {parseError ? <FieldError>{parseError}</FieldError> : null}

        {parsed ? (
          <div className="rounded-row border border-seam bg-surface-1 p-4">
            <p className="flex items-center gap-2 text-small font-medium text-navy">
              <FileJson aria-hidden size={15} strokeWidth={1.5} className="text-ink-3" />
              {parsed.list.length === 1 ? "1 proveedor" : `${parsed.list.length} proveedores`} en{" "}
              <Mono className="truncate font-normal text-ink-2">{parsed.origin}</Mono>
            </p>
            <p className="mt-1.5 line-clamp-2 text-caption text-ink-2">{parsed.names.join(" · ") || "Lista vacía."}</p>
          </div>
        ) : null}

        {parsed ? (
          <Notice tone="warning" icon={<TriangleAlert />}>
            Se reemplazan los {currentCount} proveedores actuales. Las decisiones ya tomadas no cambian.
          </Notice>
        ) : null}

        {serverError ? (
          <Notice tone="danger" icon={<TriangleAlert />} title="No se importó. Nada cambió." role="alert">
            {(() => {
              const { head, items } = explainServerError(serverError, parsed?.names ?? []);
              return (
                <>
                  <span className="block break-words">{head}</span>
                  {items.length > 0 ? (
                    <ul className="mt-1.5 space-y-1 font-mono text-[11.5px] leading-[1.5] text-ink-2">
                      {items.map((item, i) => (
                        <li key={i} className="break-words">
                          {item}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </>
              );
            })()}
          </Notice>
        ) : null}
      </div>

      <footer className="flex items-center justify-end gap-2 border-t border-seam px-6 py-4">
        <Button type="button" variant="ghost" onClick={onClose}>
          Cancelar
        </Button>
        <Button type="button" onClick={submit} disabled={!parsed || saving}>
          {saving ? "Importando…" : "Reemplazar proveedores"}
        </Button>
      </footer>
    </div>
  );
}
