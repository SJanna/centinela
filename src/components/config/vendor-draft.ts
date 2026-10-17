/**
 * Borrador de proveedor para el formulario: todo en texto, con validación en español.
 * Puro (sin React): convierte Vendor ⇄ borrador y valida antes de llamar a la API.
 */
import { normalizeAccount } from "@/core/normalize";
import type { Agreement, Vendor } from "@/core/schemas";
import { formatNumber, parseDecimal } from "./format";

export interface AgreementDraft {
  /** Clave estable para React. */
  key: string;
  id: string;
  description: string;
  kind: Agreement["kind"];
  currency: string;
  amount: string;
  rate: string;
  maxQuantity: string;
  validFrom: string;
  validTo: string;
}

export interface VendorDraft {
  id: string;
  name: string;
  /** Alias separados por coma. */
  aliases: string;
  taxId: string;
  country: string;
  beneficiaryName: string;
  bankName: string;
  accountNumber: string;
  routingOrSwift: string;
  agreements: AgreementDraft[];
}

/** Errores por campo: "name", "accountNumber", "agreements.0.amount"… */
export type DraftErrors = Record<string, string>;

let keySeq = 0;
export function newKey(prefix = "k"): string {
  keySeq += 1;
  return `${prefix}-${keySeq}-${Math.random().toString(36).slice(2, 7)}`;
}

/** "Estudio Nopal S. de R.L." → "estudio-nopal". */
export function slugOf(name: string): string {
  const words = name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\./g, "")
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 0 && !["sas", "sa", "de", "rl", "srl", "spa", "sac", "ltda", "llc", "inc", "cv", "s", "y", "del", "la", "el"].includes(w));
  return words.slice(0, 2).join("-") || "proveedor";
}

/** Id de proveedor que no choca con los existentes: "v-estudio-nopal", "v-estudio-nopal-2"… */
export function uniqueVendorId(name: string, taken: Set<string>): string {
  const base = `v-${slugOf(name)}`;
  if (!taken.has(base)) return base;
  for (let i = 2; ; i++) if (!taken.has(`${base}-${i}`)) return `${base}-${i}`;
}

function numberText(n: number | null): string {
  return n == null ? "" : formatNumber(n, 6);
}

export function emptyAgreement(currency: string, today: string): AgreementDraft {
  return {
    key: newKey("a"),
    id: "",
    description: "",
    kind: "fixed_recurring",
    currency,
    amount: "",
    rate: "",
    maxQuantity: "",
    validFrom: today,
    validTo: "",
  };
}

export function emptyDraft(): VendorDraft {
  return {
    id: "",
    name: "",
    aliases: "",
    taxId: "",
    country: "CO",
    beneficiaryName: "",
    bankName: "",
    accountNumber: "",
    routingOrSwift: "",
    agreements: [],
  };
}

export function toDraft(v: Vendor): VendorDraft {
  return {
    id: v.id,
    name: v.name,
    aliases: v.aliases.join(", "),
    taxId: v.taxId ?? "",
    country: v.country,
    beneficiaryName: v.account.beneficiaryName,
    bankName: v.account.bankName,
    accountNumber: v.account.accountNumber,
    routingOrSwift: v.account.routingOrSwift ?? "",
    agreements: v.agreements.map((a) => ({
      key: newKey("a"),
      id: a.id,
      description: a.description,
      kind: a.kind,
      currency: a.currency,
      amount: numberText(a.amount),
      rate: numberText(a.rate),
      maxQuantity: numberText(a.maxQuantity),
      validFrom: a.validFrom,
      validTo: a.validTo ?? "",
    })),
  };
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function validDate(s: string): boolean {
  if (!ISO_DATE.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

function positive(raw: string, label: string, errors: DraftErrors, path: string): number | null {
  const n = parseDecimal(raw, { grouping: true });
  if (raw.trim() === "") {
    errors[path] = `Escribe ${label}.`;
    return null;
  }
  if (n == null) {
    errors[path] = "Escribe un número, por ejemplo 12.000.000 o 900,50.";
    return null;
  }
  if (n <= 0) {
    errors[path] = "Debe ser mayor que 0.";
    return null;
  }
  return n;
}

/** ¿Cambió la cuenta destino? (compara normalizado: guiones y espacios no cuentan). */
export function accountChanged(before: Vendor | null, draft: VendorDraft): boolean {
  if (!before) return false;
  return (
    normalizeAccount(before.account.accountNumber) !== normalizeAccount(draft.accountNumber) ||
    (normalizeAccount(before.account.routingOrSwift) ?? "") !== (normalizeAccount(draft.routingOrSwift) ?? "")
  );
}

/**
 * Valida el borrador y lo convierte en Vendor. `takenIds`: ids de otros proveedores (para no
 * sobrescribir uno al crear). Los ids de acuerdos nuevos se generan aquí.
 */
export function fromDraft(
  draft: VendorDraft,
  { takenIds, isNew }: { takenIds: Set<string>; isNew: boolean },
): { vendor: Vendor | null; errors: DraftErrors } {
  const errors: DraftErrors = {};
  const name = draft.name.trim();
  const id = draft.id.trim();
  if (!name) errors.name = "Escribe el nombre del proveedor.";
  if (!id) errors.id = "Escribe un identificador.";
  else if (/\s/.test(id)) errors.id = "Sin espacios: usa guiones, como v-estudio-nopal.";
  else if (isNew && takenIds.has(id)) errors.id = "Ya hay un proveedor con ese identificador.";
  const country = draft.country.trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(country)) errors.country = "Usa el código de 2 letras del país, como CO.";
  if (!draft.beneficiaryName.trim()) errors.beneficiaryName = "Escribe a nombre de quién está la cuenta.";
  if (!draft.bankName.trim()) errors.bankName = "Escribe el banco.";
  if (!normalizeAccount(draft.accountNumber)) errors.accountNumber = "Escribe el número de cuenta.";

  const usedAgreementIds = new Set(draft.agreements.map((a) => a.id).filter(Boolean));
  const agreements: Agreement[] = [];
  draft.agreements.forEach((a, i) => {
    const p = `agreements.${i}`;
    const description = a.description.trim();
    if (!description) errors[`${p}.description`] = "Describe el acuerdo en una frase.";
    const currency = a.currency.trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(currency)) errors[`${p}.currency`] = "Elige la moneda.";
    let amount: number | null = null;
    let rate: number | null = null;
    let maxQuantity: number | null = null;
    if (a.kind === "hourly") {
      rate = positive(a.rate, "la tarifa por hora", errors, `${p}.rate`);
      if (a.maxQuantity.trim() !== "") {
        const q = parseDecimal(a.maxQuantity, { grouping: true });
        if (q == null || q <= 0) errors[`${p}.maxQuantity`] = "Debe ser un número mayor que 0, o déjalo vacío.";
        else maxQuantity = q;
      }
    } else {
      amount = positive(a.amount, "el monto pactado", errors, `${p}.amount`);
    }
    if (!validDate(a.validFrom)) errors[`${p}.validFrom`] = "Elige la fecha de inicio.";
    const validTo = a.validTo.trim();
    if (validTo && !validDate(validTo)) errors[`${p}.validTo`] = "La fecha no es válida.";
    else if (validTo && validDate(a.validFrom) && validTo < a.validFrom) errors[`${p}.validTo`] = "Termina antes de empezar.";

    let agreementId = a.id.trim();
    if (!agreementId) {
      const base = `a-${slugOf(name || id)}`;
      agreementId = base;
      for (let n = 2; usedAgreementIds.has(agreementId); n++) agreementId = `${base}-${n}`;
      usedAgreementIds.add(agreementId);
    }
    agreements.push({
      id: agreementId,
      description,
      kind: a.kind,
      currency,
      amount,
      rate,
      maxQuantity,
      frequency: a.kind === "one_off" ? "once" : "monthly",
      validFrom: a.validFrom,
      validTo: validTo || null,
    });
  });

  if (Object.keys(errors).length > 0) return { vendor: null, errors };
  const aliases = Array.from(
    new Set(
      draft.aliases
        .split(/[,;\n]/)
        .map((s) => s.trim())
        .filter((s) => s.length > 0 && s !== name),
    ),
  );
  return {
    vendor: {
      id,
      name,
      aliases,
      taxId: draft.taxId.trim() || null,
      country,
      account: {
        beneficiaryName: draft.beneficiaryName.trim(),
        bankName: draft.bankName.trim(),
        accountNumber: draft.accountNumber.trim(),
        routingOrSwift: draft.routingOrSwift.trim() || null,
      },
      agreements,
    },
    errors,
  };
}
