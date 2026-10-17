/**
 * Proveedores del set de estrés:
 * - Los 11 registrados en dataset/company.json, con su ficha (nombre, id tributario, cuenta y acuerdo
 *   tal cual) y su presentación (dirección, marca, rótulos) tomada de las specs del dataset base.
 * - Proveedores ficticios que no están registrados.
 * - Impostores: nombres parecidos a los registrados (letra cambiada, homoglifo, otra razón social) o
 *   el mismo nombre con otro id tributario.
 *
 * Todo lo inventado (ids tributarios, cuentas, bancos, códigos SWIFT/ABA, dominios) es ficticio, y
 * los ids y cuentas se construyen para NO pasar el dígito de control de su formato (checksums.ts).
 */
import type { Agreement, Company, Vendor } from "../../src/core/schemas";
import type { Brand, DocumentSpec, Locale, LogoKind, Party, TemplateKind } from "../generator/spec";
import { isDocumentSpec, loadSpecs } from "../generator/spec";
import { accountPassesCheck, isValidAba, isValidCnpj, isValidCuit, isValidRfc, isValidRuc, nitCheckDigit, rutCheckDigit } from "./checksums";
import type { Rng } from "./rng";

export type Lang = "es" | "pt" | "en";
export type Country = "CO" | "MX" | "BR" | "US" | "AR" | "CL" | "PE";

export interface BankAccount {
  beneficiaryName: string;
  bankName: string;
  /** Tal como se escribe en la ficha. */
  accountNumber: string;
  routingOrSwift: string | null;
  accountLabel: string;
  routingLabel: string | null;
}

export interface VendorProfile {
  /** id en company.json, o null si no está registrado. */
  id: string | null;
  /** Clave estable para numerar facturas y sembrar el azar. */
  key: string;
  party: Party;
  /** Alias registrados (solo proveedores registrados). */
  aliases: string[];
  brand: Brand;
  country: Country;
  locale: Locale;
  /** Idiomas en que escribe correos y chats (el primero es el habitual). */
  languages: Lang[];
  /** Plantillas visuales que usa. */
  templates: TemplateKind[];
  account: BankAccount;
  /** Acuerdo (registrados) o forma de cobro habitual (ficticios). */
  agreement: Agreement;
  contacts: string[];
  emailDomain: string;
  /** Número de factura n-ésimo según la plantilla. */
  number: (n: number, template: TemplateKind | null) => string;
  /** Primer n de la numeración. */
  numberBase: number;
  /** Concepto (una línea) y conceptos para facturas de varias líneas, por idioma. */
  concept: Record<Lang, { single: string; multi: string[] }>;
  /** Título del documento según la plantilla o el idioma (correo y chat). */
  titles: Partial<Record<TemplateKind | Lang, string>>;
  /** Datos propios de cada plantilla. */
  /** `currency` es la de la factura (otra moneda): los textos de la plantilla que la nombran deben decir esa. */
  templateData: (template: TemplateKind, ctx: { number: string; issueDate: string; period: string | null; lang: Lang; currency: string }) => Record<string, string>;
  /** Ciudad de emisión (cuentas de cobro). */
  city: string;
  signer: { name: string; role: string };
}

// ───────────────────────── País ─────────────────────────

export const COUNTRY: Record<Country, { locale: Locale; taxLabel: string; tz: string; taxRate: number; taxName: Record<Lang, string>; zeroTax: Record<Lang, string> }> = {
  CO: { locale: "es-CO", taxLabel: "NIT", tz: "-0500", taxRate: 19, taxName: { es: "IVA", pt: "IVA", en: "VAT" }, zeroTax: { es: "IVA 0 % (exportación de servicios)", pt: "IVA 0 % (exportação de serviços)", en: "VAT 0% (export of services)" } },
  MX: { locale: "es-MX", taxLabel: "RFC", tz: "-0600", taxRate: 16, taxName: { es: "IVA", pt: "IVA", en: "VAT" }, zeroTax: { es: "IVA 0 % (exportación de servicios)", pt: "IVA 0 % (exportação de serviços)", en: "VAT 0% (export of services)" } },
  BR: { locale: "pt-BR", taxLabel: "CNPJ", tz: "-0300", taxRate: 5, taxName: { es: "ISS", pt: "ISS", en: "ISS" }, zeroTax: { es: "Impuestos 0 % (exportación de servicios)", pt: "ISS 0 % (exportação de serviços)", en: "Taxes 0% (export of services)" } },
  US: { locale: "en-US", taxLabel: "EIN", tz: "-0500", taxRate: 8.875, taxName: { es: "Impuesto sobre ventas", pt: "Imposto sobre vendas", en: "Sales tax" }, zeroTax: { es: "Impuesto sobre ventas (0 %)", pt: "Imposto sobre vendas (0 %)", en: "Sales tax (0%)" } },
  AR: { locale: "es-AR", taxLabel: "CUIT", tz: "-0300", taxRate: 21, taxName: { es: "IVA", pt: "IVA", en: "VAT" }, zeroTax: { es: "IVA 0 % (exportación de servicios)", pt: "IVA 0 % (exportação de serviços)", en: "VAT 0% (export of services)" } },
  CL: { locale: "es-CL", taxLabel: "RUT", tz: "-0300", taxRate: 19, taxName: { es: "IVA", pt: "IVA", en: "VAT" }, zeroTax: { es: "IVA exento (exportación de servicios)", pt: "IVA isento (exportação de serviços)", en: "VAT exempt (export of services)" } },
  PE: { locale: "es-PE", taxLabel: "RUC", tz: "-0500", taxRate: 18, taxName: { es: "IGV", pt: "IGV", en: "IGV" }, zeroTax: { es: "IGV 0 % (exportación de servicios)", pt: "IGV 0 % (exportação de serviços)", en: "IGV 0% (export of services)" } },
};

const pad = (n: number, w: number) => String(n).padStart(w, "0");

/** Pseudo-hash hexadecimal determinista (CUFE, UUID…), para que cada documento tenga el suyo. */
export function fakeHex(seed: string, length: number): string {
  let h = 0x811c9dc5;
  let out = "";
  let i = 0;
  while (out.length < length) {
    const ch = seed.charCodeAt(i % Math.max(1, seed.length)) + i;
    h ^= ch;
    h = Math.imul(h, 0x01000193) >>> 0;
    out += (h >>> 0).toString(16).padStart(8, "0");
    i++;
  }
  return out.slice(0, length);
}

export function legalFor(country: Country, ctx: { number: string; vendor: string; taxId: string | null; prefix: string }): string[] {
  const hash = fakeHex(`${ctx.vendor}|${ctx.number}`, 96);
  switch (country) {
    case "CO":
      return [
        `Factura electrónica de venta. Numeración autorizada por la DIAN, resolución N° 1876406${hash.replace(/\D/g, "").slice(0, 7).padEnd(7, "0")} del 15/01/2026, prefijo ${ctx.prefix}, rango 1001 a 9999, vigencia 24 meses.`,
        `CUFE: ${hash}`,
      ];
    case "MX": {
      const u = fakeHex(ctx.number, 32).toUpperCase();
      return [
        "Este documento es una representación impresa de un CFDI 4.0 · Régimen fiscal 601 General de Ley Personas Morales · Uso del CFDI: S01 Sin efectos fiscales.",
        `Folio fiscal (UUID): ${u.slice(0, 8)}-${u.slice(8, 12)}-${u.slice(12, 16)}-${u.slice(16, 20)}-${u.slice(20, 32)}`,
      ];
    }
    case "PE":
      return [
        "Representación impresa de la Factura Electrónica. Consulte su validez en el portal de la SUNAT con el RUC del emisor, la serie y el número.",
        `Resumen: ${Buffer.from(hash.slice(0, 20), "hex").toString("base64")}`,
      ];
    case "CL":
      return ["Timbre Electrónico SII · Res. 80 de 2014 · Documento tributario electrónico.", `${ctx.vendor} · Giro: servicios de tecnología y consultoría.`];
    case "AR":
      return [`Comprobante autorizado · CAE N° ${hash.replace(/\D/g, "").slice(0, 14).padEnd(14, "7")} · Vto. CAE: 30 días desde la emisión.`];
    case "BR":
      return [`${ctx.vendor}${ctx.taxId ? ` · CNPJ ${ctx.taxId}` : ""} · São Paulo – SP, Brasil`];
    case "US":
      return [`${ctx.vendor}${ctx.taxId ? ` · EIN ${ctx.taxId}` : ""}`];
  }
}

// ───────────────────────── Registrados ─────────────────────────

interface RegisteredExtra {
  /** Spec del dataset base de donde sale la presentación (dirección, marca, rótulos). */
  ref: string;
  country: Country;
  languages: Lang[];
  templates: TemplateKind[];
  contacts: string[];
  emailDomain: string;
  numberBase: number;
  number: (n: number, template: TemplateKind | null) => string;
  concept: Record<Lang, { single: string; multi: string[] }>;
  titles: Partial<Record<TemplateKind | Lang, string>>;
  brand?: Brand;
  city: string;
  signer: { name: string; role: string };
  latam?: Record<string, string>;
  saas: { plan: string; heroNote: string; paymentSubtitle: string; customerId: string; url: string };
}

const REGISTERED: Record<string, RegisteredExtra> = {
  "v-camila": {
    ref: "B01",
    country: "CO",
    languages: ["es", "en"],
    templates: ["latam", "cuenta_cobro", "saas"],
    contacts: ["Camila Restrepo", "Andrés Gil"],
    emailDomain: "crdev.co",
    numberBase: 3101,
    number: (n, t) => (t === "cuenta_cobro" ? `CC-2026-${pad(n - 3000, 3)}` : `CRD-${n}`),
    concept: {
      es: { single: "Desarrollo backend – tarifa fija mensual", multi: ["Desarrollo de API y servicios", "Mantenimiento y soporte de backend", "Revisión de código y despliegues"] },
      en: { single: "Backend development – fixed monthly fee", multi: ["API and services development", "Backend maintenance and support", "Code review and deployments"] },
      pt: { single: "Desenvolvimento backend – mensalidade fixa", multi: ["Desenvolvimento de API e serviços", "Manutenção e suporte de backend", "Revisão de código e implantações"] },
    },
    titles: { latam: "FACTURA ELECTRÓNICA DE VENTA", cuenta_cobro: "CUENTA DE COBRO", saas: "Invoice", es: "Factura", en: "Invoice", pt: "Fatura" },
    city: "Medellín",
    signer: { name: "Camila Restrepo Gómez", role: "Representante legal – Camila Restrepo Dev S.A.S." },
    latam: { code: "qr" },
    saas: { plan: "Backend · monthly retainer", heroNote: "Thank you for your business.", paymentSubtitle: "International wire · COP", customerId: "AND-CRD-01", url: "portal.crdev.co/facturas" },
  },
  "v-nopal": {
    ref: "B04",
    country: "MX",
    languages: ["es", "en"],
    templates: ["latam", "saas"],
    contacts: ["Mariana Ortega", "Diego Salas"],
    emailDomain: "estudionopal.mx",
    numberBase: 401,
    number: (n) => `A-${n}`,
    concept: {
      es: { single: "Diseño de producto (UX/UI) – horas", multi: ["Investigación con usuarios", "Diseño de interfaces", "Prototipos interactivos"] },
      en: { single: "Product design (UX/UI) – hours", multi: ["User research", "Interface design", "Interactive prototypes"] },
      pt: { single: "Design de produto (UX/UI) – horas", multi: ["Pesquisa com usuários", "Design de interfaces", "Protótipos interativos"] },
    },
    titles: { latam: "FACTURA · CFDI 4.0", saas: "Invoice", es: "Factura", en: "Invoice", pt: "Fatura" },
    city: "Ciudad de México",
    signer: { name: "Mariana Ortega", role: "Administración – Estudio Nopal" },
    latam: { code: "qr" },
    saas: { plan: "Product design · hourly", heroNote: "Gracias por trabajar con Estudio Nopal.", paymentSubtitle: "SPEI or international wire", customerId: "NOPAL-ANDES", url: "facturas.estudionopal.mx" },
  },
  "v-testa": {
    ref: "H02",
    country: "BR",
    languages: ["pt", "es"],
    templates: ["nota_servico", "latam", "saas"],
    contacts: ["Mariana Souza", "Rafael Lima"],
    emailDomain: "testaqualidade.com.br",
    numberBase: 4201,
    number: (n, t) => (t === "nota_servico" ? pad(n, 8) : `TQ-2026-${pad(n, 4)}`),
    concept: {
      es: { single: "QA manual y automatizado – mensualidad", multi: ["Pruebas de regresión", "Automatización de pruebas"] },
      en: { single: "Manual and automated QA – monthly fee", multi: ["Regression testing", "Test automation"] },
      pt: { single: "QA manual e automatizado – mensalidade", multi: ["Testes de regressão", "Automação de testes"] },
    },
    titles: { nota_servico: "NOTA FISCAL DE SERVIÇOS ELETRÔNICA – NFS-e", latam: "FACTURA COMERCIAL (INVOICE)", saas: "Invoice", es: "Factura", en: "Invoice", pt: "Fatura" },
    city: "São Paulo",
    signer: { name: "Mariana Souza", role: "Financeiro – Testa Qualidade" },
    saas: { plan: "QA · monthly", heroNote: "Obrigado pela parceria.", paymentSubtitle: "International wire · BRL", customerId: "TQ-ANDES", url: "portal.testaqualidade.com.br" },
  },
  "v-cloudmetrics": {
    ref: "B02",
    country: "US",
    languages: ["en", "es"],
    templates: ["saas", "portal", "latam"],
    contacts: ["Jordan Blake", "Priya Raman"],
    emailDomain: "cloudmetrics.io",
    numberBase: 1001,
    number: (n) => `CM-INV-2026-${pad(n, 4)}`,
    concept: {
      es: { single: "Plan Team – monitoreo de infraestructura", multi: ["Plan Team – licencias", "Complemento: retención de logs"] },
      en: { single: "Team plan – Infrastructure monitoring", multi: ["Team plan – seats", "Add-on: log retention"] },
      pt: { single: "Plano Team – monitoramento de infraestrutura", multi: ["Plano Team – licenças", "Complemento: retenção de logs"] },
    },
    titles: { saas: "Invoice", portal: "Invoice", latam: "FACTURA", es: "Factura", en: "Invoice", pt: "Fatura" },
    city: "San Francisco",
    signer: { name: "Jordan Blake", role: "Billing – CloudMetrics" },
    saas: { plan: "Team · monthly", heroNote: "Thank you for using CloudMetrics.", paymentSubtitle: "ACH or domestic wire · USD only", customerId: "cus_ANDES0042", url: "billing.cloudmetrics.io/invoices" },
  },
  "v-bufete": {
    ref: "B15",
    country: "CO",
    languages: ["es", "en"],
    templates: ["latam", "cuenta_cobro", "saas"],
    contacts: ["Laura Peña", "Santiago Rueda"],
    emailDomain: "bufeteandino.co",
    numberBase: 1101,
    number: (n) => `BA-${pad(n, 4)}`,
    concept: {
      es: { single: "Constitución de subsidiaria en Colombia – honorarios", multi: ["Honorarios de constitución", "Registro mercantil y trámites"] },
      en: { single: "Incorporation of Colombian subsidiary – fees", multi: ["Incorporation fees", "Commercial registry and filings"] },
      pt: { single: "Constituição de subsidiária na Colômbia – honorários", multi: ["Honorários de constituição", "Registro mercantil e trâmites"] },
    },
    titles: { latam: "FACTURA ELECTRÓNICA DE VENTA", cuenta_cobro: "CUENTA DE COBRO", saas: "Invoice", es: "Factura", en: "Invoice", pt: "Fatura" },
    city: "Bogotá D.C.",
    signer: { name: "Laura Peña", role: "Socia – Bufete Andino Abogados" },
    latam: { code: "qr", reference: "COT-2026-114", referenceLabel: "COTIZACIÓN" },
    saas: { plan: "Quote COT-2026-114 · one-off", heroNote: "Thank you for trusting Bufete Andino.", paymentSubtitle: "International wire · USD", customerId: "BA-ANDES", url: "clientes.bufeteandino.co" },
  },
  "v-pampa": {
    ref: "B05",
    country: "AR",
    languages: ["es", "en"],
    templates: ["latam", "saas"],
    contacts: ["Martín Ferreyra", "Sofía Ibarra"],
    emailDomain: "pampaops.com.ar",
    numberBase: 901,
    number: (n) => `0003-${pad(n, 8)}`,
    concept: {
      es: { single: "DevOps gestionado – abono mensual", multi: ["Operación de infraestructura (guardias)", "Monitoreo y backups"] },
      en: { single: "Managed DevOps – monthly fee", multi: ["Infrastructure operations (on-call)", "Monitoring and backups"] },
      pt: { single: "DevOps gerenciado – mensalidade", multi: ["Operação de infraestrutura (plantão)", "Monitoramento e backups"] },
    },
    titles: { latam: "FACTURA E", saas: "Invoice", es: "Factura E", en: "Invoice", pt: "Fatura" },
    brand: { color: "#1E40AF", accent: "#93C5FD", logo: "orbit", initials: null, wordmark: "Pampa Ops", tagline: "DevOps gestionado" },
    city: "Buenos Aires",
    signer: { name: "Martín Ferreyra", role: "Administración – Pampa Ops" },
    latam: { code: "barcode", barcodeCaption: "Comprobante autorizado AFIP" },
    saas: { plan: "Managed DevOps · monthly", heroNote: "Gracias por confiar en Pampa Ops.", paymentSubtitle: "International wire · USD", customerId: "PAMPA-ANDES", url: "clientes.pampaops.com.ar" },
  },
  "v-datossur": {
    ref: "B13",
    country: "CL",
    languages: ["es", "en"],
    templates: ["latam", "saas"],
    contacts: ["Ignacio Fuentes", "Valentina Rojas"],
    emailDomain: "datosdelsur.cl",
    numberBase: 1401,
    number: (n) => `${n}`,
    concept: {
      es: { single: "Analítica de datos – horas de consultoría", multi: ["Modelos de retención", "Tableros ejecutivos", "Limpieza de datos"] },
      en: { single: "Data analytics services – consulting hours", multi: ["Retention models", "Executive dashboards", "Data cleaning"] },
      pt: { single: "Análise de dados – horas de consultoria", multi: ["Modelos de retenção", "Painéis executivos", "Limpeza de dados"] },
    },
    titles: { latam: "FACTURA DE EXPORTACIÓN ELECTRÓNICA", saas: "Invoice", es: "Factura de exportación electrónica", en: "Invoice", pt: "Fatura" },
    city: "Santiago",
    signer: { name: "Ignacio Fuentes", role: "Finanzas – Datos del Sur" },
    latam: { code: "barcode", barcodeCaption: "Timbre Electrónico SII", subtitle: "S.I.I. – SANTIAGO ORIENTE" },
    saas: { plan: "Analytics · hourly", heroNote: "Gracias por trabajar con Datos del Sur.", paymentSubtitle: "International wire · USD", customerId: "DDS-ANDES", url: "portal.datosdelsur.cl" },
  },
  "v-northwind": {
    ref: "B11",
    country: "US",
    languages: ["en"],
    templates: ["saas", "portal"],
    contacts: ["Ethan Cole", "Maya Brooks"],
    emailDomain: "northwindhosting.com",
    numberBase: 201,
    number: (n) => `NWH-2026-${pad(n, 3)}`,
    concept: {
      es: { single: "Infraestructura dedicada – nodo bare-metal (mensual)", multi: ["Nodos bare-metal", "Transferencia de datos"] },
      en: { single: "Dedicated infrastructure – bare-metal node (monthly)", multi: ["Bare-metal nodes", "Data transfer"] },
      pt: { single: "Infraestrutura dedicada – nó bare-metal (mensal)", multi: ["Nós bare-metal", "Transferência de dados"] },
    },
    titles: { saas: "Invoice", portal: "Invoice", es: "Factura", en: "Invoice", pt: "Fatura" },
    city: "Dallas",
    signer: { name: "Ethan Cole", role: "Accounts receivable – Northwind Hosting" },
    saas: { plan: "Dedicated · 4 nodes", heroNote: "Thank you for your business.", paymentSubtitle: "Domestic and international wires", customerId: "NW-ANDES-07", url: "billing.northwindhosting.com/invoices" },
  },
  "v-inca": {
    ref: "B20",
    country: "PE",
    languages: ["es"],
    templates: ["latam", "saas"],
    contacts: ["Rosa Quispe", "Carlos Huamán"],
    emailDomain: "incacontenidos.pe",
    numberBase: 301,
    number: (n) => `F001-${pad(n, 6)}`,
    concept: {
      es: { single: "Marketing de contenidos – plan mensual", multi: ["Artículos para blog", "Piezas para redes sociales", "Boletín mensual"] },
      en: { single: "Content marketing – monthly plan", multi: ["Blog articles", "Social media pieces", "Monthly newsletter"] },
      pt: { single: "Marketing de conteúdo – plano mensal", multi: ["Artigos para blog", "Peças para redes sociais", "Boletim mensal"] },
    },
    titles: { latam: "FACTURA ELECTRÓNICA", saas: "Invoice", es: "Factura electrónica", en: "Invoice", pt: "Fatura" },
    city: "Lima",
    signer: { name: "Rosa Quispe", role: "Facturación – Inca Contenidos" },
    latam: { code: "qr" },
    saas: { plan: "Content · monthly plan", heroNote: "Gracias por confiar en Inca Contenidos.", paymentSubtitle: "Transferencia internacional · PEN", customerId: "INCA-ANDES", url: "clientes.incacontenidos.pe" },
  },
  "v-caribe": {
    ref: "B21",
    country: "CO",
    languages: ["es"],
    templates: ["latam", "cuenta_cobro", "saas"],
    contacts: ["Luisa Barrios", "Jorge Pérez"],
    emailDomain: "soportecaribe.co",
    numberBase: 2301,
    number: (n, t) => (t === "cuenta_cobro" ? `CCB-${n}` : `SC-${n}`),
    concept: {
      es: { single: "Soporte al cliente – horas atendidas", multi: ["Turno diurno", "Turno nocturno", "Fines de semana"] },
      en: { single: "Customer support – hours served", multi: ["Day shift", "Night shift", "Weekends"] },
      pt: { single: "Suporte ao cliente – horas atendidas", multi: ["Turno diurno", "Turno noturno", "Fins de semana"] },
    },
    titles: { latam: "FACTURA ELECTRÓNICA DE VENTA", cuenta_cobro: "CUENTA DE COBRO", saas: "Invoice", es: "Factura", en: "Invoice", pt: "Fatura" },
    city: "Barranquilla",
    signer: { name: "Luisa Barrios", role: "Gerente – Soporte Caribe S.A.S." },
    latam: { code: "qr" },
    saas: { plan: "Support · hourly", heroNote: "Gracias por confiar en Soporte Caribe.", paymentSubtitle: "Transferencia internacional · COP", customerId: "SC-ANDES", url: "portal.soportecaribe.co" },
  },
  "v-roble": {
    ref: "B22",
    country: "CO",
    languages: ["es"],
    templates: ["latam", "cuenta_cobro"],
    contacts: ["Hernán Castro", "Paola Díaz"],
    emailDomain: "viejoroble.com.co",
    numberBase: 5601,
    number: (n) => `IVR-${n}`,
    concept: {
      es: { single: "Material impreso – paquete mensual", multi: ["Catálogos", "Tarjetas de presentación y volantes"] },
      en: { single: "Printed materials – monthly package", multi: ["Catalogs", "Business cards and flyers"] },
      pt: { single: "Material impresso – pacote mensal", multi: ["Catálogos", "Cartões de visita e panfletos"] },
    },
    titles: { latam: "FACTURA ELECTRÓNICA DE VENTA", cuenta_cobro: "CUENTA DE COBRO", es: "Factura", en: "Invoice", pt: "Fatura" },
    city: "Bogotá D.C.",
    signer: { name: "Hernán Castro", role: "Cartera – Imprenta Viejo Roble" },
    latam: { code: "qr" },
    saas: { plan: "Print · monthly", heroNote: "Gracias por su compra.", paymentSubtitle: "Transferencia", customerId: "IVR-ANDES", url: "viejoroble.com.co" },
  },
};

function monthText(period: string | null, lang: Lang): string {
  if (!period) return "";
  const [y, m] = period.split("-").map(Number);
  const es = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
  const pt = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
  const en = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  if (lang === "pt") return `${pt[m - 1]}/${y}`;
  if (lang === "en") return `${en[m - 1]} ${y}`;
  return `${es[m - 1]} de ${y}`;
}

function templateDataFor(
  x: { country: Country; city: string; signer: { name: string; role: string }; latam?: Record<string, string>; saas: RegisteredExtra["saas"] },
  vendorName: string,
  conceptEs: string,
  agreementCurrency: string,
): VendorProfile["templateData"] {
  return (template, ctx) => {
    // La moneda de la factura (puede no ser la del acuerdo: trampa «otra moneda»).
    const currency = ctx.currency;
    const paymentSubtitle = x.saas.paymentSubtitle.replace(new RegExp(`\\b${agreementCurrency}\\b`, "g"), currency);
    switch (template) {
      case "latam": {
        const base = { ...(x.latam ?? {}) };
        if (x.country === "MX") base.subtitle = `Serie A · Folio ${ctx.number.replace(/\D/g, "")}`;
        return base;
      }
      case "saas":
        return { customerId: x.saas.customerId, plan: x.saas.plan, heroNote: x.saas.heroNote, paymentSubtitle };
      case "portal":
        return {
          url: `${x.saas.url}/${ctx.number}`,
          plan: x.saas.plan,
          status: "Open",
          paymentTitle: "Pay by bank transfer",
          paymentSubtitle,
          helpText: "Questions about this invoice?",
        };
      case "cuenta_cobro": {
        const currencyText: Record<string, string> = { COP: "pesos colombianos (COP)", USD: "dólares estadounidenses (USD)", MXN: "pesos mexicanos (MXN)", PEN: "soles (PEN)", BRL: "reales (BRL)", CLP: "pesos chilenos (CLP)", ARS: "pesos argentinos (ARS)" };
        return {
          concept: `${conceptEs}, servicios prestados a ANDES LABS INC.${ctx.period ? ` durante ${monthText(ctx.period, "es")}` : ""}, conforme al acuerdo vigente.`,
          currencyText: currencyText[currency] ?? currency,
          signerName: x.signer.name,
          signerRole: x.signer.role,
          salutation: "Señores",
        };
      }
      case "nota_servico": {
        const n = ctx.number.replace(/\D/g, "").replace(/^0+/, "") || "1";
        const [y, m, d] = ctx.issueDate.split("-");
        return {
          verificationCode: fakeHex(`${vendorName}|${ctx.number}`, 8).toUpperCase().replace(/(.{4})(.{4})/, "$1-$2"),
          municipalRegistration: "5.123.456-7",
          rps: `RPS N° ${n} · Série A · emitido em ${d}/${m}/${y}`,
          serviceCode: "01.01 – Análise e desenvolvimento de sistemas",
          city: x.city,
          state: "SP",
          currencyText: currency === "BRL" ? "BRL (Real brasileiro)" : currency,
          customerCountry: "Estados Unidos",
          issuerHeader: "PRESTAÇÃO DE SERVIÇOS – DOCUMENTO AUXILIAR",
          aliquota: "0,00",
        };
      }
    }
  };
}

let cachedRefs: Map<string, DocumentSpec> | null = null;
function referenceSpecs(): Map<string, DocumentSpec> {
  cachedRefs ??= new Map(loadSpecs().filter(isDocumentSpec).map((s) => [s.id, s]));
  return cachedRefs;
}

/** Perfiles de los proveedores registrados, en el orden de company.json. */
export function registeredProfiles(company: Company): VendorProfile[] {
  const refs = referenceSpecs();
  return company.vendors.map((v: Vendor) => {
    const x = REGISTERED[v.id];
    if (!x) throw new Error(`Falta el perfil de estrés del proveedor ${v.id}`);
    const ref = refs.get(x.ref);
    if (!ref) throw new Error(`Falta la spec de referencia ${x.ref} para ${v.id}`);
    const brand = x.brand ?? ref.brand;
    if (!brand) throw new Error(`${v.id}: sin marca`);
    const agreement = v.agreements[0];
    if (!agreement) throw new Error(`${v.id}: sin acuerdo`);
    const accountLabel = (ref.payment?.accountLabel ?? "Cuenta N°").replace(/:$/, "");
    const routingLabel = (ref.payment?.routingLabel ?? "SWIFT").replace(/:$/, "");
    return {
      id: v.id,
      key: v.id,
      party: { ...ref.vendor, name: v.name, taxId: v.taxId },
      aliases: [...v.aliases],
      brand,
      country: x.country,
      locale: COUNTRY[x.country].locale,
      languages: x.languages,
      templates: x.templates,
      account: { ...v.account, accountLabel, routingLabel: v.account.routingOrSwift ? routingLabel : null },
      agreement,
      contacts: x.contacts,
      emailDomain: x.emailDomain,
      number: x.number,
      numberBase: x.numberBase,
      concept: x.concept,
      titles: x.titles,
      templateData: templateDataFor(x, v.name, x.concept.es.single, agreement.currency),
      city: x.city,
      signer: x.signer,
    };
  });
}

// ───────────────────────── Ficticios ─────────────────────────

/** Bancos ficticios por país, con un código SWIFT inventado (con «QX» para no coincidir con uno real). */
export const FAKE_BANKS: Record<Country, Array<{ name: string; swift: string }>> = {
  CO: [{ name: "Banco Cordillera", swift: "QXCOCOBB" }, { name: "Banco Andino de Fomento", swift: "QXAFCOBB" }],
  MX: [{ name: "Banco Sierra Madre", swift: "QXSMMXMM" }, { name: "Banca Pacífico Norte", swift: "QXPNMXMM" }],
  BR: [{ name: "Banco Serra Azul", swift: "QXSABRSP" }, { name: "Banco Ipê Paulista", swift: "QXIPBRSP" }],
  US: [{ name: "Harborline Bank", swift: "QXHBUS33" }, { name: "First Prairie Trust", swift: "QXFPUS44" }],
  AR: [{ name: "Banco del Plata Sur", swift: "QXPSARBA" }, { name: "Banco Pampeano", swift: "QXPAARBA" }],
  CL: [{ name: "Banco Austral", swift: "QXAUCLRM" }, { name: "Banco Pehuén", swift: "QXPECLRM" }],
  PE: [{ name: "Banco Inti", swift: "QXINPEPL" }, { name: "Banco Andino del Pacífico", swift: "QXAPPEPL" }],
};

/** Número de ruteo ABA inventado que NO pasa el dígito de control. */
export function fakeAba(rng: Rng): string {
  for (;;) {
    const s = Array.from({ length: 9 }, () => rng.int(0, 9)).join("");
    if (!isValidAba(s) && s[0] !== "0") return s;
  }
}

/** Cuenta inventada con el mismo formato (largo y separadores) que `like`, que no pasa CLABE/CBU. */
export function fakeAccountLike(like: string, rng: Rng, avoid: readonly string[] = []): string {
  const avoidSet = new Set(avoid.map((a) => a.replace(/\D/g, "")));
  for (;;) {
    const out = like.replace(/\d/g, () => String(rng.int(0, 9)));
    const digits = out.replace(/\D/g, "");
    if (!avoidSet.has(digits) && !accountPassesCheck(out) && /[1-9]/.test(digits.slice(0, 4))) return out;
  }
}

/** La misma cuenta con UN dígito cambiado (nunca uno que la haga pasar CLABE/CBU). */
export function oneDigitChanged(account: string, rng: Rng): { account: string; position: number } {
  const positions = [...account].map((ch, i) => (/\d/.test(ch) ? i : -1)).filter((i) => i >= 0);
  for (;;) {
    const i = rng.pick(positions.slice(Math.min(2, positions.length - 1)));
    const old = account[i];
    const next = String((Number(old) + rng.int(1, 9)) % 10);
    const out = account.slice(0, i) + next + account.slice(i + 1);
    if (!accountPassesCheck(out)) return { account: out, position: i };
  }
}

/** Id tributario inventado con el formato del país y un dígito de control incorrecto. */
export function fakeTaxId(country: Country, rng: Rng): string {
  const digits = (n: number) => Array.from({ length: n }, (_, i) => (i === 0 ? rng.int(1, 9) : rng.int(0, 9))).join("");
  switch (country) {
    case "CO": {
      const base = `9${digits(9).slice(1)}`;
      const dv = (nitCheckDigit(base) + rng.int(1, 9)) % 10;
      return `${base.slice(0, 3)}.${base.slice(3, 6)}.${base.slice(6)}-${dv}`;
    }
    case "MX":
      for (;;) {
        const rfc = `${rng.pick(["Q", "X", "Z"])}${rng.pick(["AN", "OR", "EL", "IR"])}${pad(rng.int(15, 23), 2)}${pad(rng.int(1, 12), 2)}${pad(rng.int(1, 28), 2)}Q${rng.pick(["X", "Z"])}${rng.int(1, 9)}`;
        if (!isValidRfc(rfc)) return rfc;
      }
    case "BR":
      for (;;) {
        const d = `${digits(8)}0001${digits(2)}`;
        if (!isValidCnpj(d)) return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
      }
    case "US":
      return `${rng.pick(["07", "17", "89", "96"])}-${digits(7)}`;
    case "AR":
      for (;;) {
        const d = `30${digits(9)}`;
        if (!isValidCuit(d)) return `${d.slice(0, 2)}-${d.slice(2, 10)}-${d.slice(10)}`;
      }
    case "CL": {
      const body = `7${digits(8).slice(1)}`;
      const ok = rutCheckDigit(body);
      const options = ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9", "K"].filter((c) => c !== ok);
      return `${body.slice(0, 2)}.${body.slice(2, 5)}.${body.slice(5)}-${rng.pick(options)}`;
    }
    case "PE":
      for (;;) {
        const d = `20${digits(9)}`;
        if (!isValidRuc(d)) return d;
      }
  }
}

const ACCOUNT_SHAPES: Record<Country, { like: string; label: string; routingLabel: string }> = {
  CO: { like: "0000-0000-0000", label: "Cuenta corriente N°", routingLabel: "SWIFT" },
  MX: { like: "000000000000000000", label: "CLABE", routingLabel: "SWIFT" },
  BR: { like: "0000-00000-0", label: "Agência/Conta", routingLabel: "SWIFT" },
  US: { like: "000000000000", label: "Account number", routingLabel: "ABA routing number" },
  AR: { like: "0000000000000000000000", label: "CBU", routingLabel: "SWIFT" },
  CL: { like: "00-000-00000-00", label: "Cuenta corriente N°", routingLabel: "SWIFT" },
  PE: { like: "000-0000000-0-00", label: "Cta. cte. N°", routingLabel: "SWIFT" },
};

/** Cuenta ficticia completa (banco ficticio) con el formato habitual del país. */
export function fakeBankAccount(country: Country, beneficiary: string, rng: Rng, avoid: readonly string[] = []): BankAccount {
  const shape = ACCOUNT_SHAPES[country];
  const bank = rng.pick(FAKE_BANKS[country]);
  return {
    beneficiaryName: beneficiary,
    bankName: bank.name,
    accountNumber: fakeAccountLike(shape.like, rng, avoid),
    routingOrSwift: country === "US" ? fakeAba(rng) : bank.swift,
    accountLabel: shape.label,
    routingLabel: shape.routingLabel,
  };
}

interface FictitiousSeed {
  key: string;
  name: string;
  country: Country;
  currency: string;
  kind: "fixed_recurring" | "hourly";
  amount: number;
  rate: number | null;
  wordmark: string;
  tagline: string;
  logo: LogoKind;
  color: string;
  address: string[];
  domain: string;
  contacts: string[];
  concept: Record<Lang, string>;
  prefix: string;
}

const FICTITIOUS: FictitiousSeed[] = [
  { key: "f-quantum", name: "Quantum Freelance LLC", country: "US", currency: "USD", kind: "fixed_recurring", amount: 2000, rate: null, wordmark: "Quantum Freelance", tagline: "Engineering on demand", logo: "orbit", color: "#7C3AED", address: ["88 Harbor View Drive, Unit 12", "Austin, TX 78701", "United States"], domain: "quantumfreelance.example.com", contacts: ["Alex Turner"], concept: { es: "Desarrollo a demanda – bolsa mensual", en: "On-demand engineering – monthly retainer", pt: "Engenharia sob demanda – pacote mensal" }, prefix: "QF" },
  { key: "f-pixelpro", name: "Pixel Pro Estudio S.A.S.", country: "CO", currency: "COP", kind: "fixed_recurring", amount: 6500000, rate: null, wordmark: "Pixel Pro", tagline: "Estudio de diseño", logo: "dots", color: "#DB2777", address: ["Calle 10 # 40-20, Oficina 503", "Medellín, Antioquia", "Colombia"], domain: "pixelpro-estudio.co", contacts: ["Juliana Mesa"], concept: { es: "Diseño gráfico – paquete mensual", en: "Graphic design – monthly package", pt: "Design gráfico – pacote mensal" }, prefix: "PP" },
  { key: "f-nimbus", name: "Nimbus Data Labs Inc.", country: "US", currency: "USD", kind: "fixed_recurring", amount: 3400, rate: null, wordmark: "Nimbus Data", tagline: "Data pipelines", logo: "wave", color: "#0EA5E9", address: ["410 Market Street, Suite 900", "Seattle, WA 98101", "United States"], domain: "nimbusdatalabs.example.com", contacts: ["Taylor Reed"], concept: { es: "Pipelines de datos – suscripción", en: "Data pipelines – subscription", pt: "Pipelines de dados – assinatura" }, prefix: "NDL" },
  { key: "f-condor", name: "Cóndor Analítica SpA", country: "CL", currency: "USD", kind: "hourly", amount: 0, rate: 55, wordmark: "Cóndor Analítica", tagline: "Ciencia de datos", logo: "peak", color: "#334155", address: ["Av. Apoquindo 3400, Oficina 702", "Las Condes, Santiago", "Chile"], domain: "condoranalitica.cl", contacts: ["Tomás Araya"], concept: { es: "Consultoría en ciencia de datos – horas", en: "Data science consulting – hours", pt: "Consultoria em ciência de dados – horas" }, prefix: "CA" },
  { key: "f-tucan", name: "Tucán Digital S.A.S.", country: "CO", currency: "COP", kind: "fixed_recurring", amount: 9800000, rate: null, wordmark: "Tucán Digital", tagline: "Marketing digital", logo: "sun", color: "#EA580C", address: ["Carrera 15 # 93-60, Piso 4", "Bogotá D.C.", "Colombia"], domain: "tucandigital.co", contacts: ["Natalia Ríos"], concept: { es: "Pauta y marketing digital – mensual", en: "Digital marketing – monthly", pt: "Marketing digital – mensal" }, prefix: "TD" },
  { key: "f-araucaria", name: "Araucaria Software Ltda", country: "BR", currency: "BRL", kind: "fixed_recurring", amount: 12400, rate: null, wordmark: "Araucaria", tagline: "Software sob medida", logo: "tree", color: "#166534", address: ["Rua XV de Novembro, 820 – Sala 41", "Curitiba – PR, 80020-310", "Brasil"], domain: "araucariasoftware.com.br", contacts: ["Bruno Carvalho"], concept: { es: "Desarrollo de software – mensualidad", en: "Software development – monthly fee", pt: "Desenvolvimento de software – mensalidade" }, prefix: "AS" },
  { key: "f-maiz", name: "Maíz Creativo S. de R.L.", country: "MX", currency: "MXN", kind: "fixed_recurring", amount: 48000, rate: null, wordmark: "Maíz Creativo", tagline: "Contenido y video", logo: "cactus", color: "#CA8A04", address: ["Av. Chapultepec 480, Piso 7", "Guadalajara, Jalisco", "México"], domain: "maizcreativo.mx", contacts: ["Fernanda Lozano"], concept: { es: "Producción de video – paquete mensual", en: "Video production – monthly package", pt: "Produção de vídeo – pacote mensal" }, prefix: "MC" },
  { key: "f-lumen", name: "Lumen QA Ltda", country: "BR", currency: "BRL", kind: "fixed_recurring", amount: 7800, rate: null, wordmark: "Lumen QA", tagline: "Qualidade de software", logo: "check", color: "#0F766E", address: ["Av. Paulista, 2200 – Conj. 151", "São Paulo – SP, 01310-300", "Brasil"], domain: "lumenqa.com.br", contacts: ["Camila Teixeira"], concept: { es: "Pruebas de software – mensualidad", en: "Software testing – monthly fee", pt: "Testes de software – mensalidade" }, prefix: "LQ" },
  { key: "f-puertonorte", name: "Puerto Norte Consultores S.A.C.", country: "PE", currency: "PEN", kind: "fixed_recurring", amount: 8500, rate: null, wordmark: "Puerto Norte", tagline: "Consultoría", logo: "pillar", color: "#1D4ED8", address: ["Av. Javier Prado Este 4200, Of. 1101", "Santiago de Surco, Lima", "Perú"], domain: "puertonorte.pe", contacts: ["Andrea Salazar"], concept: { es: "Consultoría de procesos – mensual", en: "Process consulting – monthly", pt: "Consultoria de processos – mensal" }, prefix: "PN" },
  { key: "f-rioclaro", name: "Río Claro DevOps SRL", country: "AR", currency: "USD", kind: "fixed_recurring", amount: 3100, rate: null, wordmark: "Río Claro", tagline: "DevOps", logo: "wave", color: "#2563EB", address: ["Av. Santa Fe 2450, Piso 3", "Ciudad Autónoma de Buenos Aires", "Argentina"], domain: "rioclarodevops.com.ar", contacts: ["Lucas Benítez"], concept: { es: "Soporte DevOps – abono mensual", en: "DevOps support – monthly fee", pt: "Suporte DevOps – mensalidade" }, prefix: "RC" },
  { key: "f-brightpath", name: "Brightpath Hosting LLC", country: "US", currency: "USD", kind: "fixed_recurring", amount: 4200, rate: null, wordmark: "Brightpath", tagline: "Managed hosting", logo: "bars", color: "#9333EA", address: ["1200 Ridge Avenue, Suite 210", "Denver, CO 80202", "United States"], domain: "brightpathhosting.example.com", contacts: ["Morgan Hayes"], concept: { es: "Hosting administrado – mensual", en: "Managed hosting – monthly", pt: "Hospedagem gerenciada – mensal" }, prefix: "BPH" },
  { key: "f-selva", name: "Selva Contenidos S.A.C.", country: "PE", currency: "PEN", kind: "fixed_recurring", amount: 5200, rate: null, wordmark: "Selva Contenidos", tagline: "Redacción y SEO", logo: "tree", color: "#15803D", address: ["Calle Las Begonias 450, Of. 302", "San Isidro, Lima", "Perú"], domain: "selvacontenidos.pe", contacts: ["Diana Paredes"], concept: { es: "Redacción SEO – plan mensual", en: "SEO writing – monthly plan", pt: "Redação SEO – plano mensal" }, prefix: "SC" },
  { key: "f-altiplano", name: "Altiplano Cloud SpA", country: "CL", currency: "USD", kind: "fixed_recurring", amount: 1900, rate: null, wordmark: "Altiplano Cloud", tagline: "Nube administrada", logo: "peak", color: "#475569", address: ["Av. Vitacura 2939, Piso 10", "Las Condes, Santiago", "Chile"], domain: "altiplanocloud.cl", contacts: ["Felipe Morales"], concept: { es: "Nube administrada – mensual", en: "Managed cloud – monthly", pt: "Nuvem gerenciada – mensal" }, prefix: "AC" },
  { key: "f-colibri", name: "Colibrí Diseño S. de R.L.", country: "MX", currency: "MXN", kind: "hourly", amount: 0, rate: 850, wordmark: "Colibrí", tagline: "Diseño de producto", logo: "sun", color: "#DB2777", address: ["Calle Durango 85, Col. Roma Norte", "Cuauhtémoc, 06700 Ciudad de México", "México"], domain: "colibridiseno.mx", contacts: ["Regina Campos"], concept: { es: "Diseño UX – horas", en: "UX design – hours", pt: "Design UX – horas" }, prefix: "CD" },
  { key: "f-bahia", name: "Bahía Soporte S.A.S.", country: "CO", currency: "COP", kind: "hourly", amount: 0, rate: 75000, wordmark: "Bahía Soporte", tagline: "Mesa de ayuda", logo: "wave", color: "#0891B2", address: ["Carrera 3 # 8-22, Centro", "Cartagena, Bolívar", "Colombia"], domain: "bahiasoporte.co", contacts: ["Kelly Mendoza"], concept: { es: "Mesa de ayuda – horas", en: "Help desk – hours", pt: "Central de ajuda – horas" }, prefix: "BS" },
  { key: "f-ipe", name: "Ipê Testes Ltda", country: "BR", currency: "BRL", kind: "fixed_recurring", amount: 6900, rate: null, wordmark: "Ipê Testes", tagline: "QA ágil", logo: "check", color: "#A21CAF", address: ["Rua dos Andradas, 1100 – Sala 9", "Porto Alegre – RS, 90020-008", "Brasil"], domain: "ipetestes.com.br", contacts: ["Gustavo Rocha"], concept: { es: "QA ágil – mensualidad", en: "Agile QA – monthly fee", pt: "QA ágil – mensalidade" }, prefix: "IT" },
];

const LANG_OF: Record<Country, Lang[]> = { CO: ["es"], MX: ["es"], BR: ["pt", "es"], US: ["en"], AR: ["es"], CL: ["es", "en"], PE: ["es"] };

function templatesOf(country: Country): TemplateKind[] {
  if (country === "BR") return ["nota_servico", "latam", "saas"];
  if (country === "US") return ["saas", "portal"];
  if (country === "CO") return ["latam", "cuenta_cobro", "saas"];
  return ["latam", "saas"];
}

/** Perfil completo de un proveedor que no está en la ficha (datos inventados). */
function profileFromSeed(s: FictitiousSeed, rng: Rng): VendorProfile {
  const taxId = fakeTaxId(s.country, rng);
  const party: Party = { name: s.name, taxIdLabel: COUNTRY[s.country].taxLabel, taxId, address: s.address, email: `facturacion@${s.domain}`, phone: null };
  const brand: Brand = { color: s.color, accent: null, logo: s.logo, initials: null, wordmark: s.wordmark, tagline: s.tagline };
  const concept = (lang: Lang) => ({ single: s.concept[lang], multi: [s.concept[lang]] });
  const agreement: Agreement = {
    id: `${s.key}-cobro`,
    description: s.concept.es,
    kind: s.kind,
    currency: s.currency,
    amount: s.kind === "hourly" ? null : s.amount,
    rate: s.rate,
    maxQuantity: s.kind === "hourly" ? 120 : null,
    frequency: "monthly",
    validFrom: "2026-01-01",
    validTo: null,
  };
  const x = {
    country: s.country,
    city: s.address[1] ?? "",
    signer: { name: s.contacts[0], role: `Administración – ${s.wordmark}` },
    latam: (s.country === "CL" ? { code: "barcode", barcodeCaption: "Timbre Electrónico SII" } : { code: "qr" }) as Record<string, string>,
    saas: { plan: s.tagline, heroNote: "Thank you for your business.", paymentSubtitle: "International wire", customerId: `${s.prefix}-ANDES`, url: `billing.${s.domain}` },
  };
  return {
    id: null,
    key: s.key,
    party,
    aliases: [],
    brand,
    country: s.country,
    locale: COUNTRY[s.country].locale,
    languages: LANG_OF[s.country],
    templates: templatesOf(s.country),
    account: fakeBankAccount(s.country, s.name, rng),
    agreement,
    contacts: s.contacts,
    emailDomain: s.domain,
    number: (n) => `${s.prefix}-2026-${pad(n, 3)}`,
    numberBase: 101,
    concept: { es: concept("es"), en: concept("en"), pt: concept("pt") },
    titles: { latam: "FACTURA", saas: "Invoice", portal: "Invoice", cuenta_cobro: "CUENTA DE COBRO", nota_servico: "NOTA FISCAL DE SERVIÇOS ELETRÔNICA – NFS-e", es: "Factura", en: "Invoice", pt: "Fatura" },
    templateData: templateDataFor(x, s.name, s.concept.es, s.currency),
    city: x.city,
    signer: x.signer,
  };
}

/** Proveedores ficticios (no registrados), con ids y cuentas inventados de forma determinista. */
export function fictitiousProfiles(rng: Rng): VendorProfile[] {
  return FICTITIOUS.map((s) => profileFromSeed(s, rng.fork(s.key)));
}

// ───────────────────────── Impostores ─────────────────────────

/** Variantes de nombre por proveedor registrado: una letra cambiada y otra razón social. */
const LOOKALIKE_NAMES: Record<string, { letter: string[]; other: string[] }> = {
  "v-camila": { letter: ["Camila Restrepo Deb S.A.S.", "Camilla Restrepo Dev S.A.S."], other: ["Camila Restrepo Consultores S.A.S.", "CR Devs S.A.S."] },
  "v-nopal": { letter: ["Estudio Nopa1 S. de R.L.", "Estudio Nopall S. de R.L."], other: ["Estudio Nopal Diseño S.A. de C.V.", "Nopal Studio S. de R.L."] },
  "v-testa": { letter: ["Testa Qualidad Ltda", "Testa Quallidade Ltda"], other: ["Testa Qualidade ME", "Testa Qualidade Digital Ltda"] },
  "v-cloudmetrics": { letter: ["CloudMetrlcs Inc.", "Cloud Metrics Inc."], other: ["CloudMetrics Labs Inc.", "CloudMetrix Inc."] },
  "v-bufete": { letter: ["Bufete Andlno Abogados S.A.S.", "Bufete Andino Abogado S.A.S."], other: ["Bufete Andino Asociados S.A.S.", "Andino Abogados Consultores S.A.S."] },
  "v-pampa": { letter: ["Pampa 0ps SRL", "Pampa Opps SRL"], other: ["Pampa Ops Consulting SRL", "Pampa Operaciones SRL"] },
  "v-datossur": { letter: ["Datos de Sur SpA", "Datos del Sud SpA"], other: ["Datos del Sur Analytics SpA", "Datos Sur Consultores SpA"] },
  "v-northwind": { letter: ["Northwlnd Hosting LLC", "Nortwind Hosting LLC"], other: ["Northwind Hosting Group LLC", "Northwind Cloud LLC"] },
  "v-inca": { letter: ["Inka Contenidos S.A.C.", "Inca Contenido S.A.C."], other: ["Inca Contenidos Digitales S.A.C.", "Inca Media S.A.C."] },
  "v-caribe": { letter: ["Soporte Carive S.A.S.", "Soporte Caribbe S.A.S."], other: ["Soporte Caribe Express S.A.S.", "Caribe Soporte Total S.A.S."] },
  "v-roble": { letter: ["Imprenta Viejo Rob1e S.A.", "Imprenta Viejo Robles S.A."], other: ["Imprenta Roble Nuevo S.A.", "Viejo Roble Impresores S.A.S."] },
};

/** Letras latinas → homoglifos cirílicos (se ven iguales, son otros caracteres). */
const HOMOGLYPHS: Record<string, string> = { a: "а", e: "е", o: "о", c: "с", p: "р", C: "С", O: "О", A: "А", E: "Е", T: "Т", M: "М", H: "Н", P: "Р", B: "В" };

/**
 * El nombre con una letra cambiada por su homoglifo cirílico, siempre en la primera palabra (la que
 * distingue al proveedor): en la forma societaria («Ltdа») el nombre seguiría siendo el mismo para
 * quien compara sin la forma societaria, y la trampa no sería un nombre distinto.
 */
export function withHomoglyph(name: string, rng: Rng): string {
  const firstWordEnd = name.search(/\s/) === -1 ? name.length : name.search(/\s/);
  const positions = [...name.slice(0, firstWordEnd)].map((ch, i) => (HOMOGLYPHS[ch] ? i : -1)).filter((i) => i >= 0);
  if (positions.length === 0) throw new Error(`Sin letras para homoglifo en «${name}»`);
  const i = rng.pick(positions);
  return name.slice(0, i) + HOMOGLYPHS[name[i]] + name.slice(i + 1);
}

export type LookalikeKind = "letra_cambiada" | "homoglifo" | "otra_razon_social" | "mismo_nombre_otro_id";

/**
 * Perfil de un impostor que se hace pasar por `real`: otro nombre parecido (sin id tributario o con
 * uno inventado) o el mismo nombre con un id tributario distinto. Cobra a su propia cuenta ficticia.
 */
export function lookalikeProfile(real: VendorProfile, kind: LookalikeKind, rng: Rng): VendorProfile {
  if (!real.id) throw new Error("Solo se imitan proveedores registrados");
  const names = LOOKALIKE_NAMES[real.id];
  let name: string;
  let taxId: string | null;
  switch (kind) {
    case "letra_cambiada":
      name = rng.pick(names.letter);
      taxId = rng.chance(0.5) ? null : fakeTaxId(real.country, rng);
      break;
    case "homoglifo":
      name = withHomoglyph(real.party.name, rng);
      taxId = rng.chance(0.6) ? null : fakeTaxId(real.country, rng);
      break;
    case "otra_razon_social":
      name = rng.pick(names.other);
      taxId = rng.chance(0.4) ? null : fakeTaxId(real.country, rng);
      break;
    case "mismo_nombre_otro_id":
      name = real.party.name;
      taxId = fakeTaxId(real.country, rng);
      break;
  }
  const domain = `${real.emailDomain.split(".")[0]}-${rng.pick(["pagos", "billing", "facturas"])}.com`;
  return {
    ...real,
    id: null,
    key: `${real.key}-impostor`,
    party: { ...real.party, name, taxId, email: `${rng.pick(["cobros", "billing", "pagos"])}@${domain}`, phone: null },
    aliases: [],
    emailDomain: domain,
    account: fakeBankAccount(real.country, name, rng, [real.account.accountNumber]),
  };
}
