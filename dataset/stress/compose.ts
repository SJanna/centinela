/**
 * Composición de documentos del set de estrés: contenido de la factura + forma de presentarla
 * (plantilla visual, foto, correo con el detalle en el cuerpo o con el PDF adjunto, chat) →
 * DocumentSpec del generador existente (dataset/generator/spec.ts).
 *
 * En correos sin adjunto y chats, cada cita (evidence) es un fragmento literal del texto que se
 * escribe, así la lectura «perfecta» del manifiesto sale de lo que de verdad dice el archivo.
 */
import { formatDate, formatMoney, formatQuantity } from "../generator/format";
import type { ChatMessage, DocumentSpec, EmailMeta, EvidenceKey, LineSpec, Locale, Party, PaymentSpec, PhotoSpec, TemplateKind } from "../generator/spec";
import { COUNTRY, type Lang, type VendorProfile } from "./vendors";

export const CUSTOMER: Party = {
  name: "Andes Labs Inc.",
  taxIdLabel: "EIN",
  taxId: "93-4127765",
  address: ["1450 Brandywine Pkwy, Suite 300", "Wilmington, DE 19803", "Estados Unidos"],
  email: "pagos@andeslabs.dev",
  phone: null,
};

/** Lo que dice la factura, independiente de cómo se presenta. */
export interface InvoiceContent {
  vendor: VendorProfile;
  /** id del proveedor registrado que la factura dice ser (null si no lo es). */
  vendorId: string | null;
  party: Party;
  /**
   * A quién va dirigida la factura cuando NO es Andes Labs Inc. (trampa «otra_empresa»). Sin definir, es
   * CUSTOMER y los correos sin adjunto y los chats no lo dicen (así son las legítimas).
   */
  customer?: Party;
  documentType: DocumentSpec["documentType"];
  title: string;
  invoiceNumber: string;
  issueDate: string;
  issueTime: string | null;
  dueDate: string | null;
  servicePeriod: string | null;
  currency: string;
  paymentTerms: string | null;
  lines: LineSpec[];
  subtotal: number | null;
  tax: { label: string; amount: number } | null;
  total: number;
  payment: PaymentSpec | null;
  notes: string[];
  legal: string[];
  templateData: Record<string, string>;
  visibleNote: string | null;
  hiddenText: string | null;
  blurTotal: boolean;
  /** Instrucciones del correo o el chat (las de visibleNote/hiddenText las agrega el generador). */
  embeddedInstructions: { text: string; reason: string }[];
}

export type Channel =
  | { kind: "visual"; format: "pdf" | "png" | "jpg"; template: TemplateKind; photo: PhotoSpec | null }
  | { kind: "email"; attachment: TemplateKind | null }
  | { kind: "chat" };

export interface Presentation {
  channel: Channel;
  locale: Locale;
  language: Lang;
  /** Párrafos o mensajes extra (cambio de banco, instrucciones) que se insertan en el correo o el chat. */
  extras: string[];
  /** Nombre de quien escribe el correo o el chat. */
  contact: string;
  /** Hora del correo o del chat (hh:mm:ss). */
  time: string;
}

/** Cómo se cuenta la presentación en casos.csv («plantilla»). */
export function presentationLabel(p: Presentation): string {
  switch (p.channel.kind) {
    case "visual":
      return p.channel.template;
    case "email":
      return p.channel.attachment ? `correo+adjunto_${p.channel.attachment}` : "correo_cuerpo";
    case "chat":
      return "chat";
  }
}

export function formatOf(p: Presentation): DocumentSpec["format"] {
  return p.channel.kind === "visual" ? p.channel.format : p.channel.kind === "email" ? "eml" : "txt";
}

// ───────────────────────── Textos por idioma ─────────────────────────

interface Words {
  /** Rótulo del destinatario en el detalle de un correo o un chat (solo si la factura es de otra empresa). */
  billTo: string;
  number: string;
  issued: string;
  due: string;
  period: string;
  vendor: string;
  concept: string;
  subtotal: string;
  total: string;
  bankData: string;
  beneficiary: string;
  bank: string;
  greeting: string;
  intro: (doc: string, period: string) => string;
  attachIntro: (doc: string, number: string, period: string) => string;
  closing: string;
  regards: string;
  chatSystem: string;
  chatHello: (name: string) => string;
  chatReply: string;
  chatSend: (doc: string, period: string) => string;
  chatBank: string;
  chatThanks: string;
  subject: (doc: string, number: string, period: string) => string;
}

const MONTHS: Record<Lang, string[]> = {
  es: ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"],
  pt: ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"],
  en: ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"],
};

export function periodText(period: string, lang: Lang): string {
  const [y, m] = period.split("-").map(Number);
  if (lang === "en") return `${MONTHS.en[m - 1]} ${y}`;
  if (lang === "pt") return `${MONTHS.pt[m - 1]} de ${y}`;
  return `${MONTHS.es[m - 1]} de ${y}`;
}

/** Siglas que se conservan en mayúscula al citar el título en una frase. */
const KEEP_UPPER = new Set(["E", "CFDI", "NFS-e", "4.0", "(INVOICE)"]);

/** «la factura electrónica de venta», «el recibo de pago», «a fatura», «la factura E»… */
function article(doc: string, lang: "es" | "pt"): string {
  const lower = doc
    .split(" ")
    .map((w) => (KEEP_UPPER.has(w) ? w : w.toLowerCase()))
    .join(" ");
  const masculine = /^(recibo|comprobante|documento)/i.test(doc);
  if (lang === "pt") return `${masculine ? "o" : "a"} ${lower}`;
  return `${masculine ? "el" : "la"} ${lower}`;
}

const WORDS: Record<Lang, Words> = {
  es: {
    billTo: "Facturar a",
    number: "N°",
    issued: "Fecha de emisión",
    due: "Vencimiento",
    period: "Periodo",
    vendor: "Proveedor",
    concept: "Concepto",
    subtotal: "Subtotal",
    total: "Total",
    bankData: "Datos bancarios",
    beneficiary: "Titular",
    bank: "Banco",
    greeting: "Hola, equipo de Andes Labs:",
    intro: (doc, period) => `Les enviamos ${article(doc, "es")} de ${period}, según el acuerdo vigente.`,
    attachIntro: (doc, number, period) => `Adjuntamos ${article(doc, "es")} ${number} correspondiente a ${period}.`,
    closing: "Quedamos atentos a cualquier duda.",
    regards: "Saludos,",
    chatSystem: "Los mensajes y las llamadas están cifrados de extremo a extremo. Nadie fuera de este chat, ni siquiera WhatsApp, puede leerlos ni escucharlos.",
    chatHello: (name) => `Buen día ${name}! ¿Cómo va todo?`,
    chatReply: "Hola! Todo bien, cuéntame",
    chatSend: (doc, period) => `Te paso ${article(doc, "es")} de ${period}`,
    chatBank: "Datos para la transferencia:",
    chatThanks: "Perfecto, se lo paso al equipo de pagos. Gracias!",
    subject: (doc, number, period) => `${doc} ${number} – ${period}`,
  },
  pt: {
    billTo: "Tomador",
    number: "nº",
    issued: "Data de emissão",
    due: "Vencimento",
    period: "Competência",
    vendor: "Prestador",
    concept: "Descrição",
    subtotal: "Subtotal",
    total: "Total",
    bankData: "Dados bancários",
    beneficiary: "Favorecido",
    bank: "Banco",
    greeting: "Olá, equipe da Andes Labs,",
    intro: (doc, period) => `Segue ${article(doc, "pt")} referente a ${period}, conforme o contrato vigente.`,
    attachIntro: (doc, number, period) => `Segue em anexo ${article(doc, "pt")} ${number} referente a ${period}.`,
    closing: "Ficamos à disposição para qualquer dúvida.",
    regards: "Atenciosamente,",
    chatSystem: "As mensagens e as chamadas são protegidas com a criptografia de ponta a ponta. Ninguém fora desta conversa, nem mesmo o WhatsApp, pode ler ou ouvi-las.",
    chatHello: (name) => `Bom dia, ${name}! Tudo bem?`,
    chatReply: "Oi! Tudo ótimo, pode falar",
    chatSend: (doc, period) => `Estou enviando ${article(doc, "pt")} de ${period}`,
    chatBank: "Dados para a transferência:",
    chatThanks: "Perfeito, vou passar para o time de pagamentos. Obrigada!",
    subject: (doc, number, period) => `${doc} ${number} – ${period}`,
  },
  en: {
    billTo: "Bill to",
    number: "#",
    issued: "Issue date",
    due: "Due date",
    period: "Billing period",
    vendor: "Vendor",
    concept: "Description",
    subtotal: "Subtotal",
    total: "Total",
    bankData: "Bank details",
    beneficiary: "Beneficiary",
    bank: "Bank",
    greeting: "Hi Andes Labs team,",
    intro: (doc, period) => `Please find below our ${doc.toLowerCase()} for ${period}, per our current agreement.`,
    attachIntro: (doc, number, period) => `Attached is ${doc.toLowerCase()} ${number} for ${period}.`,
    closing: "Let us know if you have any questions.",
    regards: "Best regards,",
    chatSystem: "Messages and calls are end-to-end encrypted. No one outside of this chat, not even WhatsApp, can read or listen to them.",
    chatHello: (name) => `Good morning ${name}! How are you?`,
    chatReply: "Hi! All good, go ahead",
    chatSend: (doc, period) => `Sending you the ${doc.toLowerCase()} for ${period}`,
    chatBank: "Wire details:",
    chatThanks: "Great, I'll pass it to the payments team. Thanks!",
    subject: (doc, number, period) => `${doc} ${number} – ${period}`,
  },
};

const AP_PEOPLE = ["Lucía Méndez", "Daniela Vargas", "Tomás Rivero"];

/** Fecha corta del cuerpo de un correo o chat: dd/mm/aaaa (en: mm/dd/aaaa). */
function shortDate(iso: string, lang: Lang): string {
  const [y, m, d] = iso.split("-");
  return lang === "en" ? `${m}/${d}/${y}` : `${d}/${m}/${y}`;
}

/** Monto con el formato del documento y, si el formato no lo dice, el código de la moneda. */
export function moneyWithCode(amount: number, currency: string, locale: Locale): string {
  const text = formatMoney(amount, currency, locale);
  return text.includes(currency) ? text : `${text} ${currency}`;
}

function lineText(l: LineSpec, currency: string, locale: Locale): string {
  const money = (n: number) => formatMoney(n, currency, locale);
  if (l.quantity != null && l.unitPrice != null && (l.unit || l.quantity !== 1)) {
    return `${l.description}: ${formatQuantity(l.quantity, l.unit, locale)} × ${money(l.unitPrice)} = ${money(l.amount)}`;
  }
  return `${l.description}: ${money(l.amount)}`;
}

/** Cuerpo del detalle de la factura (líneas + citas) para correo y chat. */
function detailBlock(c: InvoiceContent, p: Presentation, sep: string): { header: string[]; amounts: string[]; bank: string[]; evidence: Partial<Record<EvidenceKey, string>> } {
  const w = WORDS[p.language];
  const ev: Partial<Record<EvidenceKey, string>> = {};
  const header: string[] = [];
  const docNoun = c.title;
  const numberLine = `${docNoun} ${w.number} ${c.invoiceNumber}`;
  header.push(numberLine);
  ev.invoiceNumber = numberLine;
  const vendorLine = c.party.taxId ? `${w.vendor}: ${c.party.name}${sep}${c.party.taxIdLabel ?? ""} ${c.party.taxId}`.replace(/\s+/g, " ") : `${w.vendor}: ${c.party.name}`;
  header.push(vendorLine);
  ev.vendorName = `${w.vendor}: ${c.party.name}`;
  if (c.party.taxId) ev.vendorTaxId = `${c.party.taxIdLabel ?? ""} ${c.party.taxId}`.trim();
  // Solo la factura dirigida a otra empresa lo dice en el texto (las legítimas no cambian).
  if (c.customer) {
    const cu = c.customer;
    const taxText = cu.taxId ? `${cu.taxIdLabel ?? ""} ${cu.taxId}`.trim() : null;
    header.push(taxText ? `${w.billTo}: ${cu.name}${sep}${taxText}` : `${w.billTo}: ${cu.name}`);
    ev.billToName = `${w.billTo}: ${cu.name}`;
    if (taxText) ev.billToTaxId = taxText;
  }
  const issued = `${w.issued}: ${shortDate(c.issueDate, p.language)}`;
  header.push(issued);
  ev.issueDate = issued;
  if (c.dueDate) {
    const due = `${w.due}: ${shortDate(c.dueDate, p.language)}`;
    header.push(due);
    ev.dueDate = due;
  }
  if (c.servicePeriod) {
    const per = `${w.period}: ${periodText(c.servicePeriod, p.language)}`;
    header.push(per);
    ev.servicePeriod = per;
  }

  const amounts: string[] = c.lines.map((l) => lineText(l, c.currency, p.locale));
  const money = (n: number) => formatMoney(n, c.currency, p.locale);
  if (c.subtotal != null) {
    const s = `${w.subtotal}: ${money(c.subtotal)}`;
    amounts.push(s);
    ev.subtotal = s;
  }
  if (c.tax) {
    const t = `${c.tax.label}: ${money(c.tax.amount)}`;
    amounts.push(t);
    ev.tax = t;
  }
  if (!c.blurTotal) {
    const totalLine = `${w.total}: ${moneyWithCode(c.total, c.currency, p.locale)}`;
    amounts.push(totalLine);
    ev.total = `${w.total}: ${money(c.total)}`;
    ev.currency = totalLine;
  }

  const bank: string[] = [];
  if (c.payment) {
    const pay = c.payment;
    const rows: Array<[string, string, EvidenceKey]> = [
      [w.beneficiary, pay.beneficiaryName, "beneficiaryName"],
      [w.bank, pay.bankName, "bankName"],
      [pay.accountLabel.replace(/:$/, ""), pay.accountNumber, "accountNumber"],
    ];
    if (pay.routingOrSwift) rows.push([(pay.routingLabel ?? "SWIFT").replace(/:$/, ""), pay.routingOrSwift, "routingOrSwift"]);
    for (const [label, value, key] of rows) {
      const line = `${label}: ${value}`;
      bank.push(line);
      ev[key] = line;
    }
  }
  return { header, amounts, bank, evidence: ev };
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTH_ABBR = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function rfc5322(iso: string, time: string, tz: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  const [y, m, day] = iso.split("-");
  return `${WEEKDAYS[d.getUTCDay()]}, ${day} ${MONTH_ABBR[Number(m) - 1]} ${y} ${time} ${tz}`;
}

function slug(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function emailMeta(id: string, c: InvoiceContent, p: Presentation, body: string[]): EmailMeta {
  const w = WORDS[p.language];
  const periodLabel = c.servicePeriod ? periodText(c.servicePeriod, p.language) : shortDate(c.issueDate, p.language);
  const from = `${p.contact} <${slug(p.contact).replace(/-/g, ".")}@${c.vendor.emailDomain}>`;
  const date = rfc5322(c.issueDate, p.time, COUNTRY[c.vendor.country].tz);
  const stamp = `${c.issueDate.replace(/-/g, "")}${p.time.replace(/:/g, "")}`;
  return {
    from,
    to: `Cuentas por pagar · Andes Labs <${CUSTOMER.email}>`,
    cc: null,
    subject: w.subject(c.title, c.invoiceNumber, periodLabel),
    date,
    messageId: `<${stamp}.${id.toLowerCase()}@${c.vendor.emailDomain}>`,
    body,
  };
}

/** Une el contenido y la presentación en una DocumentSpec válida para el generador. */
export function composeSpec(id: string, about: string, c: InvoiceContent, p: Presentation, readerNotes: string): DocumentSpec {
  const base = {
    id,
    about,
    vendorId: c.vendorId,
    language: p.language,
    locale: p.locale,
    documentType: c.documentType,
    title: c.title,
    brand: c.vendor.brand,
    vendor: c.party,
    customer: c.customer ?? CUSTOMER,
    invoiceNumber: c.invoiceNumber,
    issueDate: c.issueDate,
    issuePlace: null as string | null,
    issueTime: c.issueTime,
    dueDate: c.dueDate,
    servicePeriod: c.servicePeriod,
    currency: c.currency,
    paymentTerms: c.paymentTerms,
    lines: c.lines,
    subtotal: c.subtotal,
    tax: c.tax,
    total: c.total,
    payment: c.payment,
    notes: c.notes,
    legal: c.legal,
    templateData: c.templateData,
    visibleNote: c.visibleNote,
    hiddenText: c.hiddenText,
    blurTotal: c.blurTotal,
    embeddedInstructions: c.embeddedInstructions,
    readerNotes,
  };
  const ch = p.channel;
  if (ch.kind === "visual") {
    return {
      ...base,
      issuePlace: ch.template === "cuenta_cobro" ? c.vendor.city : null,
      format: ch.format,
      template: ch.template,
      photo: ch.format === "jpg" ? ch.photo : null,
      emailMeta: null,
      attachment: null,
      chatMessages: null,
      evidence: null,
    };
  }

  const w = WORDS[p.language];
  const periodLabel = c.servicePeriod ? periodText(c.servicePeriod, p.language) : shortDate(c.issueDate, p.language);
  if (ch.kind === "email") {
    if (ch.attachment) {
      const body = [
        w.greeting,
        "",
        w.attachIntro(c.title, c.invoiceNumber, periodLabel),
        ...p.extras.flatMap((x) => ["", x]),
        "",
        w.closing,
        "",
        w.regards,
        p.contact,
        c.party.name,
      ];
      return {
        ...base,
        format: "eml",
        template: null,
        photo: null,
        emailMeta: emailMeta(id, c, p, body),
        attachment: { filename: `${slug(c.invoiceNumber) || "factura"}.pdf`, template: ch.attachment },
        chatMessages: null,
        evidence: null,
      };
    }
    const d = detailBlock(c, p, " – ");
    const body = [
      w.greeting,
      "",
      w.intro(c.title, periodLabel),
      ...p.extras.flatMap((x) => ["", x]),
      "",
      ...d.header,
      "",
      `${w.concept}:`,
      ...d.amounts,
      ...(d.bank.length ? ["", `${w.bankData}:`, ...d.bank] : []),
      "",
      w.closing,
      "",
      w.regards,
      p.contact,
      c.party.name,
    ];
    return {
      ...base,
      format: "eml",
      template: null,
      photo: null,
      emailMeta: emailMeta(id, c, p, body),
      attachment: null,
      chatMessages: null,
      evidence: d.evidence,
    };
  }

  // Chat estilo WhatsApp
  const d = detailBlock(c, p, " – ");
  const date = shortDate(c.issueDate, "es");
  const [hh, mm] = p.time.split(":").map(Number);
  let minute = hh * 60 + mm;
  const at = () => {
    const t = `${String(Math.floor(minute / 60) % 24).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
    minute += 1;
    return t;
  };
  const sender = `${p.contact} (${c.vendor.brand.wordmark})`;
  const ap = AP_PEOPLE[c.invoiceNumber.length % AP_PEOPLE.length];
  const messages: ChatMessage[] = [
    { date, time: at(), sender: null, text: w.chatSystem },
    { date, time: at(), sender, text: w.chatHello(ap.split(" ")[0]) },
    { date, time: at(), sender: ap, text: w.chatReply },
    { date, time: at(), sender, text: w.chatSend(c.title, periodLabel) },
    { date, time: at(), sender, text: [...d.header, ...d.amounts].join("\n") },
    ...p.extras.map((x) => ({ date, time: at(), sender, text: x })),
    ...(d.bank.length ? [{ date, time: at(), sender, text: [w.chatBank, ...d.bank].join("\n") }] : []),
    { date, time: at(), sender: ap, text: w.chatThanks },
  ];
  return {
    ...base,
    format: "txt",
    template: null,
    photo: null,
    emailMeta: null,
    attachment: null,
    chatMessages: messages,
    evidence: d.evidence,
  };
}

/** Notas para el lector (resumen de lo que una lectura perfecta ve), en español. */
export function readerNotesOf(c: InvoiceContent, p: Presentation, extra: string | null): string {
  const what = c.documentType === "receipt" ? "Recibo" : c.documentType === "cuenta_de_cobro" ? "Cuenta de cobro" : "Factura";
  const where =
    p.channel.kind === "email"
      ? p.channel.attachment
        ? "Correo con el documento en PDF adjunto"
        : "Correo con el detalle en el cuerpo"
      : p.channel.kind === "chat"
        ? "Chat estilo WhatsApp"
        : p.channel.format === "jpg"
          ? "Foto de celular del documento impreso"
          : p.channel.format === "png"
            ? "Captura de pantalla"
            : "PDF";
  const total = c.blurTotal ? "total ilegible" : formatMoney(c.total, c.currency, "es-CO");
  const period = c.servicePeriod ? ` por ${periodText(c.servicePeriod, "es")}` : "";
  const pay = c.payment ? ` Pago a ${c.payment.bankName}, ${c.payment.accountLabel.replace(/:$/, "")} ${c.payment.accountNumber}.` : " No trae datos bancarios.";
  const to = c.customer ? ` Dirigida a ${c.customer.name}${c.customer.taxId ? ` (${`${c.customer.taxIdLabel ?? ""} ${c.customer.taxId}`.trim()})` : ""}.` : "";
  return `${where}. ${what} ${c.invoiceNumber} de ${c.party.name}${period}: ${total}.${pay}${to}${extra ? ` ${extra}` : ""}`;
}

export { WORDS, formatDate };
