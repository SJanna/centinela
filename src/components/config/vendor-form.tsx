"use client";

import { Plus, ShieldAlert, Trash2, TriangleAlert } from "lucide-react";
import { useId, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import type { Agreement, Company, Vendor } from "@/core/schemas";
import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { COUNTRY_NAME, CountryFlag } from "@/components/ui/country-flag";
import { Eyebrow, Mono } from "@/components/ui/typography";
import { requestJson } from "./api";
import { Field, FieldError, Notice, Select, TextInput, describedBy } from "./fields";
import { AGREEMENT_KIND_LABEL, CURRENCY_NAME } from "./format";
import { CloseButton } from "./overlay";
import {
  accountChanged,
  emptyAgreement,
  emptyDraft,
  fromDraft,
  toDraft,
  uniqueVendorId,
  type AgreementDraft,
  type DraftErrors,
  type VendorDraft,
} from "./vendor-draft";

interface VendorFormProps {
  /** null = proveedor nuevo. */
  vendor: Vendor | null;
  /** Ids de todos los proveedores actuales. */
  takenIds: string[];
  /** Monedas con tasa de cambio (de las reglas). */
  currencies: string[];
  /** YYYY-MM-DD de hoy, para los acuerdos nuevos. */
  today: string;
  titleId: string;
  onClose: () => void;
  onSaved: (company: Company, vendor: Vendor, created: boolean) => void;
}

const KINDS: Agreement["kind"][] = ["fixed_recurring", "hourly", "one_off"];

function Section({ title, description, children }: { title: string; description?: ReactNode; children: ReactNode }) {
  return (
    <section className="rounded-card border border-seam bg-surface-0 shadow-hairline">
      <header className="border-b border-seam px-5 py-3.5">
        <h3 className="text-h3">{title}</h3>
        {description ? <p className="mt-0.5 text-small text-ink-2">{description}</p> : null}
      </header>
      <div className="space-y-4 p-5">{children}</div>
    </section>
  );
}

/** Formulario completo de un proveedor (ficha, cuenta y acuerdos) dentro del panel lateral. */
export function VendorForm({ vendor, takenIds, currencies, today, titleId, onClose, onSaved }: VendorFormProps) {
  const uid = useId();
  const isNew = vendor === null;
  const taken = useMemo(() => new Set(takenIds.filter((id) => id !== vendor?.id)), [takenIds, vendor]);
  const [draft, setDraft] = useState<VendorDraft>(() => (vendor ? toDraft(vendor) : emptyDraft()));
  const [idTouched, setIdTouched] = useState(!isNew);
  const [showErrors, setShowErrors] = useState(false);
  const [confirmAccount, setConfirmAccount] = useState(false);
  const [saving, setSaving] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);

  const changedAccount = accountChanged(vendor, draft);
  const result = useMemo(() => fromDraft(draft, { takenIds: taken, isNew }), [draft, taken, isNew]);
  const errors: DraftErrors = showErrors ? result.errors : {};
  const errorCount = Object.keys(result.errors).length;

  const currencyOptions = useMemo(() => {
    const set = new Set(currencies);
    for (const a of draft.agreements) if (a.currency) set.add(a.currency.toUpperCase());
    return [...set].sort((a, b) => (a === "USD" ? -1 : b === "USD" ? 1 : a.localeCompare(b)));
  }, [currencies, draft.agreements]);

  const countryOptions = useMemo(() => {
    const list = Object.keys(COUNTRY_NAME);
    if (draft.country && !list.includes(draft.country.toUpperCase())) list.push(draft.country.toUpperCase());
    return list;
  }, [draft.country]);

  function set<K extends keyof VendorDraft>(key: K, value: VendorDraft[K]) {
    setDraft((d) => {
      const next = { ...d, [key]: value };
      // El identificador sigue al nombre hasta que alguien lo edita.
      if (key === "name" && isNew && !idTouched) next.id = String(value).trim() ? uniqueVendorId(String(value), taken) : "";
      // El beneficiario suele ser el mismo nombre.
      if (key === "name" && isNew && (d.beneficiaryName === "" || d.beneficiaryName === d.name)) next.beneficiaryName = String(value);
      return next;
    });
    setServerError(null);
  }

  function setAgreement(index: number, patch: Partial<AgreementDraft>) {
    setDraft((d) => ({ ...d, agreements: d.agreements.map((a, i) => (i === index ? { ...a, ...patch } : a)) }));
    setServerError(null);
  }

  function defaultCurrency(): string {
    const byCountry: Record<string, string> = { CO: "COP", MX: "MXN", BR: "BRL", PE: "PEN", AR: "USD", CL: "USD", US: "USD" };
    const c = byCountry[draft.country.toUpperCase()] ?? "USD";
    return currencies.includes(c) ? c : "USD";
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setShowErrors(true);
    if (!result.vendor || (changedAccount && !confirmAccount)) {
      // Lleva al primer campo con error (se pinta en el siguiente cuadro).
      requestAnimationFrame(() => {
        const selector = changedAccount && !confirmAccount ? '[aria-invalid="true"], [data-account-confirm]' : '[aria-invalid="true"]';
        const first = formRef.current?.querySelector<HTMLElement>(selector);
        first?.scrollIntoView({ block: "center", behavior: "smooth" });
        first?.focus({ preventScroll: true });
      });
      return;
    }
    setSaving(true);
    setServerError(null);
    const response = await requestJson<{ company: Company }>("/api/company/vendors", { method: "POST", body: result.vendor });
    setSaving(false);
    if (!response.ok) {
      setServerError(response.error);
      return;
    }
    onSaved(response.data.company, result.vendor, isNew);
  }

  const id = (name: string) => `${uid}-${name}`;
  const blockedByAccount = changedAccount && !confirmAccount;

  return (
    <form ref={formRef} onSubmit={submit} noValidate className="flex min-h-0 flex-1 flex-col">
      {/* Cabecera */}
      <header className="flex items-start justify-between gap-4 border-b border-line px-6 pt-5 pb-4">
        <div className="min-w-0 space-y-1">
          <Eyebrow>{isNew ? "Nuevo proveedor" : "Editar proveedor"}</Eyebrow>
          <h2 id={titleId} className="flex items-center gap-2.5 text-h2">
            {!isNew ? <CountryFlag country={vendor.country} size={20} /> : null}
            <span className="truncate">{isNew ? (draft.name.trim() || "Proveedor sin nombre") : vendor.name}</span>
          </h2>
          {!isNew ? <Mono className="text-caption text-ink-3">{vendor.id}</Mono> : null}
        </div>
        <CloseButton onClick={onClose} label="Cerrar sin guardar" />
      </header>

      {/* Cuerpo */}
      <div className="scrollbar-quiet relative min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain px-6 py-5">
        <Section title="Ficha" description="Cómo aparece en las facturas.">
          <Field label="Nombre legal" htmlFor={id("name")} error={errors.name}>
            <TextInput
              id={id("name")}
              data-autofocus
              value={draft.name}
              onChange={(e) => set("name", e.target.value)}
              placeholder="Estudio Nopal S. de R.L."
              invalid={Boolean(errors.name)}
              {...describedBy(id("name"), errors.name)}
            />
          </Field>
          <Field
            label="Otros nombres"
            htmlFor={id("aliases")}
            optional
            hint="Separados por coma. Así puede aparecer en una factura."
          >
            <TextInput
              id={id("aliases")}
              value={draft.aliases}
              onChange={(e) => set("aliases", e.target.value)}
              placeholder="Estudio Nopal, Nopal Diseño"
              {...describedBy(id("aliases"), null, "x")}
            />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="País" htmlFor={id("country")} error={errors.country}>
              <Select
                id={id("country")}
                value={draft.country.toUpperCase()}
                onChange={(e) => set("country", e.target.value)}
                invalid={Boolean(errors.country)}
              >
                {countryOptions.map((code) => (
                  <option key={code} value={code}>
                    {COUNTRY_NAME[code] ?? code}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="ID tributario" htmlFor={id("taxId")} optional>
              <TextInput
                id={id("taxId")}
                mono
                value={draft.taxId}
                onChange={(e) => set("taxId", e.target.value)}
                placeholder="901.456.789-1"
              />
            </Field>
          </div>
          <Field
            label="Identificador"
            htmlFor={id("id")}
            error={errors.id}
            hint={isNew ? "Se usa en el registro de decisiones. No se puede cambiar después." : "No se puede cambiar."}
          >
            <TextInput
              id={id("id")}
              mono
              value={draft.id}
              readOnly={!isNew}
              disabled={!isNew}
              onChange={(e) => {
                setIdTouched(true);
                set("id", e.target.value);
              }}
              invalid={Boolean(errors.id)}
              {...describedBy(id("id"), errors.id, "x")}
            />
          </Field>
        </Section>

        <Section title="Cuenta registrada" description="Centinela solo paga a esta cuenta.">
          <Notice tone="warning" icon={<ShieldAlert />} title="Cambiarla es sensible.">
            Las facturas que pidan pagar a otra cuenta se escalan. Confirma cualquier cambio con el proveedor por un canal
            distinto al correo de la factura.
          </Notice>
          <Field label="Beneficiario" htmlFor={id("beneficiary")} error={errors.beneficiaryName}>
            <TextInput
              id={id("beneficiary")}
              value={draft.beneficiaryName}
              onChange={(e) => set("beneficiaryName", e.target.value)}
              invalid={Boolean(errors.beneficiaryName)}
              {...describedBy(id("beneficiary"), errors.beneficiaryName)}
            />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Banco" htmlFor={id("bank")} error={errors.bankName}>
              <TextInput
                id={id("bank")}
                value={draft.bankName}
                onChange={(e) => set("bankName", e.target.value)}
                placeholder="BBVA México"
                invalid={Boolean(errors.bankName)}
                {...describedBy(id("bank"), errors.bankName)}
              />
            </Field>
            <Field label="SWIFT o código de ruta" htmlFor={id("routing")} optional>
              <TextInput
                id={id("routing")}
                mono
                value={draft.routingOrSwift}
                onChange={(e) => set("routingOrSwift", e.target.value)}
                placeholder="BCMRMXMM"
              />
            </Field>
          </div>
          <Field label="Número de cuenta" htmlFor={id("account")} error={errors.accountNumber}>
            <TextInput
              id={id("account")}
              mono
              value={draft.accountNumber}
              onChange={(e) => set("accountNumber", e.target.value)}
              placeholder="012180001234567891"
              autoComplete="off"
              invalid={Boolean(errors.accountNumber)}
              {...describedBy(id("account"), errors.accountNumber)}
            />
          </Field>
          {changedAccount ? (
            <div className="space-y-3 rounded-row border border-hold-mark/30 bg-hold-wash/60 p-4">
              <p className="flex items-start gap-2 text-small font-medium text-hold">
                <TriangleAlert aria-hidden size={16} strokeWidth={1.75} className="mt-[1px] shrink-0" />
                Cambiaste la cuenta registrada.
              </p>
              <p className="text-small text-ink-2">
                Desde que guardes, Centinela solo pagará a la cuenta nueva. Antes registrada:{" "}
                <Mono className="text-ink">{vendor?.account.accountNumber}</Mono>
                {vendor?.account.routingOrSwift ? (
                  <>
                    {" · "}
                    <Mono className="text-ink">{vendor.account.routingOrSwift}</Mono>
                  </>
                ) : null}
                .
              </p>
              <label className="flex cursor-pointer items-start gap-2.5 text-small text-navy">
                <input
                  type="checkbox"
                  data-account-confirm
                  checked={confirmAccount}
                  onChange={(e) => setConfirmAccount(e.target.checked)}
                  className="mt-[3px] size-4 shrink-0 accent-[var(--color-accent)]"
                />
                <span>Confirmé la cuenta nueva con el proveedor por otro canal.</span>
              </label>
              {showErrors && blockedByAccount ? <FieldError>Confirma el cambio de cuenta para guardar.</FieldError> : null}
            </div>
          ) : null}
        </Section>

        <section className="space-y-3">
          <div className="flex items-end justify-between gap-4 px-1">
            <div>
              <h3 className="text-h3">Acuerdos</h3>
              <p className="text-small text-ink-2">Lo pactado. Sin un acuerdo vigente, sus facturas se escalan.</p>
            </div>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              icon={<Plus />}
              onClick={() => setDraft((d) => ({ ...d, agreements: [...d.agreements, emptyAgreement(defaultCurrency(), today)] }))}
            >
              Agregar acuerdo
            </Button>
          </div>
          {draft.agreements.length === 0 ? (
            <p className="rounded-card border border-dashed border-faint bg-surface-1 px-5 py-6 text-center text-small text-ink-2">
              Sin acuerdos. Agrega uno para que Centinela pueda pagarle.
            </p>
          ) : null}
          {draft.agreements.map((a, i) => (
            <AgreementEditor
              key={a.key}
              index={i}
              agreement={a}
              currencies={currencyOptions}
              errors={errors}
              idBase={`${uid}-ag-${i}`}
              onChange={(patch) => setAgreement(i, patch)}
              onRemove={() => setDraft((d) => ({ ...d, agreements: d.agreements.filter((_, j) => j !== i) }))}
            />
          ))}
        </section>
      </div>

      {/* Pie */}
      <footer className="space-y-3 border-t border-line bg-surface-0/80 px-6 py-4">
        {serverError ? (
          <Notice tone="danger" icon={<TriangleAlert />} title="No se guardó el proveedor." role="alert">
            {serverError}
          </Notice>
        ) : showErrors && errorCount > 0 ? (
          <p role="alert" className="text-small text-hold">
            {errorCount === 1 ? "Hay 1 campo por corregir." : `Hay ${errorCount} campos por corregir.`}
          </p>
        ) : null}
        <div className="flex items-center justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" disabled={saving}>
            {saving ? "Guardando…" : isNew ? "Crear proveedor" : "Guardar cambios"}
          </Button>
        </div>
      </footer>
    </form>
  );
}

interface AgreementEditorProps {
  index: number;
  agreement: AgreementDraft;
  currencies: string[];
  errors: DraftErrors;
  idBase: string;
  onChange: (patch: Partial<AgreementDraft>) => void;
  onRemove: () => void;
}

function AgreementEditor({ index, agreement: a, currencies, errors, idBase, onChange, onRemove }: AgreementEditorProps) {
  const p = `agreements.${index}`;
  const err = (field: string) => errors[`${p}.${field}`];
  const fid = (field: string) => `${idBase}-${field}`;
  return (
    <fieldset className="rounded-card border border-seam bg-surface-0 shadow-hairline">
      <legend className="sr-only">Acuerdo {index + 1}</legend>
      <div className="flex items-center justify-between gap-3 border-b border-seam px-5 py-3">
        <p className="flex min-w-0 items-center gap-2 text-small font-medium text-navy">
          Acuerdo {index + 1}
          {a.id ? <Mono className="truncate text-caption font-normal text-ink-3">{a.id}</Mono> : null}
        </p>
        <button
          type="button"
          onClick={onRemove}
          className="inline-flex h-7 items-center gap-1.5 rounded-pill px-2.5 text-caption font-medium text-ink-2 transition-colors duration-150 hover:bg-hold-wash hover:text-hold"
        >
          <Trash2 aria-hidden size={13} strokeWidth={1.75} />
          Quitar
        </button>
      </div>
      <div className="space-y-4 p-5">
        <div role="radiogroup" aria-label="Tipo de acuerdo" className="inline-flex rounded-pill bg-surface-2 p-1">
          {KINDS.map((kind) => {
            const active = a.kind === kind;
            return (
              <button
                key={kind}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => onChange({ kind })}
                className={cn(
                  "h-7 rounded-pill px-3 text-caption font-medium transition-[background-color,color,box-shadow] duration-150",
                  active ? "bg-surface-0 text-navy shadow-[0_1px_2px_#1c253a1f] ring-1 ring-seam" : "text-ink-2 hover:text-navy",
                )}
              >
                {AGREEMENT_KIND_LABEL[kind]}
              </button>
            );
          })}
        </div>
        <Field label="Descripción" htmlFor={fid("description")} error={err("description")}>
          <TextInput
            id={fid("description")}
            value={a.description}
            onChange={(e) => onChange({ description: e.target.value })}
            placeholder={a.kind === "hourly" ? "Diseño de producto por hora" : a.kind === "one_off" ? "Cotización única" : "Desarrollo backend, fijo mensual"}
            invalid={Boolean(err("description"))}
            {...describedBy(fid("description"), err("description"))}
          />
        </Field>
        <div className={cn("grid gap-4", a.kind === "hourly" ? "sm:grid-cols-[7.5rem_1fr_1fr]" : "sm:grid-cols-[7.5rem_1fr]")}>
          <Field label="Moneda" htmlFor={fid("currency")} error={err("currency")}>
            <Select
              id={fid("currency")}
              value={a.currency}
              onChange={(e) => onChange({ currency: e.target.value })}
              invalid={Boolean(err("currency"))}
              title={CURRENCY_NAME[a.currency] ?? a.currency}
            >
              {currencies.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </Select>
          </Field>
          {a.kind === "hourly" ? (
            <>
              <Field label="Tarifa por hora" htmlFor={fid("rate")} error={err("rate")}>
                <TextInput
                  id={fid("rate")}
                  inputMode="decimal"
                  className="tnum"
                  value={a.rate}
                  onChange={(e) => onChange({ rate: e.target.value })}
                  placeholder="900"
                  invalid={Boolean(err("rate"))}
                  {...describedBy(fid("rate"), err("rate"))}
                />
              </Field>
              <Field label="Horas máximas al mes" htmlFor={fid("max")} error={err("maxQuantity")} hint="Vacío si no hay tope.">
                <TextInput
                  id={fid("max")}
                  inputMode="decimal"
                  className="tnum"
                  value={a.maxQuantity}
                  onChange={(e) => onChange({ maxQuantity: e.target.value })}
                  placeholder="120"
                  invalid={Boolean(err("maxQuantity"))}
                  {...describedBy(fid("max"), err("maxQuantity"), "x")}
                />
              </Field>
            </>
          ) : (
            <Field
              label={a.kind === "one_off" ? "Monto cotizado" : "Monto mensual"}
              htmlFor={fid("amount")}
              error={err("amount")}
            >
              <TextInput
                id={fid("amount")}
                inputMode="decimal"
                className="tnum"
                value={a.amount}
                onChange={(e) => onChange({ amount: e.target.value })}
                placeholder="12.000.000"
                invalid={Boolean(err("amount"))}
                {...describedBy(fid("amount"), err("amount"))}
              />
            </Field>
          )}
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Vigente desde" htmlFor={fid("from")} error={err("validFrom")}>
            <TextInput
              id={fid("from")}
              type="date"
              className="tnum"
              value={a.validFrom}
              onChange={(e) => onChange({ validFrom: e.target.value })}
              invalid={Boolean(err("validFrom"))}
              {...describedBy(fid("from"), err("validFrom"))}
            />
          </Field>
          <Field label="Hasta" htmlFor={fid("to")} error={err("validTo")} optional hint="Vacío si no vence.">
            <TextInput
              id={fid("to")}
              type="date"
              className="tnum"
              value={a.validTo}
              onChange={(e) => onChange({ validTo: e.target.value })}
              invalid={Boolean(err("validTo"))}
              {...describedBy(fid("to"), err("validTo"), "x")}
            />
          </Field>
        </div>
      </div>
    </fieldset>
  );
}
