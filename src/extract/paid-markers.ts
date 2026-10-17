/**
 * Detector de documento YA PAGADO por patrones (sin modelo), en español, inglés y portugués.
 *
 * Un recibo (algo que ya se pagó) puede traer número, vencimiento y datos bancarios igual que una
 * factura, y los lectores lo confunden con un cobro. Este detector no depende de que el modelo
 * acierte: busca en el texto plano del documento (PDF con texto, correo con sus adjuntos, chat)
 * marcas inequívocas de que el pago ya se hizo. Cualquier marca produce ESCALAR (LEC-1) y la guardia
 * rechaza el pago; un falso positivo nunca paga, solo pide a una persona que mire.
 *
 * Se busca sobre el mismo texto plegado que el detector de instrucciones (minúsculas, sin tildes, NFKD,
 * sin invisibles) y con la misma segunda pasada para títulos con letras separadas («R E C I B O  D E
 * P A G O») o que la entrada de PDF ya unió («RECIBODEPAGO»). La cita que se devuelve es la línea del
 * texto original.
 *
 * Marcas (documentadas a propósito):
 *
 * 1. El documento se presenta como recibo: «payment receipt», «receipt of/for payment», «receipt for
 *    invoice», «payment confirmation / acknowledgement», «received with thanks», «Received from … the
 *    sum of», «recibo (oficial) de pago / caja / dinero», «comprobante / constancia de pago /
 *    transferencia / depósito / consignación», «confirmación de pago», «Recibí de … la suma de»,
 *    «recibí conforme», «comprovante / recibo de pagamento / transferência / PIX», «confirmação de
 *    pagamento», «recibo / termo de quitação», «plena quitação», «Recebi de … a importância de». Y una
 *    línea que es solo el título «Receipt» / «Recibo» (con su número si lo trae: «RECEIPT #1234»,
 *    «Recibo N° 0045», también en el asunto de un correo) o «Receipt from <proveedor>».
 * 2. Dice que el pago ya se hizo o se recibió: «payment received» (también «payment of USD 1,200.00
 *    received»), «received your/the payment», «paid on», «paid in full», «fully paid», «has been /
 *    was paid», «is paid.», «paid via/by/with <medio>», «settled on», «date paid», «payment
 *    successful / completed / confirmed / applied / posted / processed / credited», «thank(s) for your
 *    payment», «thanks for paying», «amount/total paid», «invoice paid / settled», «status: paid»;
 *    «pago recibido / aplicado / acreditado / confirmado / realizado / efectuado / exitoso»,
 *    «transacción aprobada», «recibimos su pago / transferencia», «acusamos recibo de su pago»,
 *    «pagado el», «pagado con tarjeta», «fue / está pagada», «ya fue pagad…», «se pagó el»,
 *    «total/monto/importe/valor pagado / recibido», «gracias por su/tu pago», «factura pagada /
 *    saldada / liquidada / cancelada», «estado: pagado»; «pagamento recebido / confirmado / efetuado /
 *    realizado / aprovado», «recebemos o seu pagamento / a sua transferência», «já (foi) pago», «foi
 *    paga», «fatura paga / quitada», «total/valor pago / recebido», «obrigado pelo pagamento»,
 *    «situação: paga».
 * 3. No queda nada por pagar: «Balance due: $0.00», «Amount due USD 0.00», «Saldo pendiente: COP 0»,
 *    «Saldo a pagar: $0,00», «Valor em aberto: R$ 0,00» (el monto cero tiene que ir justo después de
 *    la etiqueta; «Previous balance due: $0.00» y «Saldo anterior» no cuentan).
 * 4. Sello en su propia línea: «PAID», «PAGADO», «PAGADA», «PAGO», «PAGA», «QUITADO», «LIQUIDADO»,
 *    «SALDADO», «CANCELADO», «SETTLED», en mayúsculas o con letras separadas, con signos, números,
 *    una fecha («PAID 10 AUG 2026», «PAGADO EL 10 DE AGOSTO») o «with thanks» alrededor si los hay.
 *    Las formas largas («Pagado», «Quitado», «Settled»…) cuentan también con mayúscula inicial, y
 *    cualquiera con una marca de verificación («Paid ✓»).
 *
 * No cuentan (frases normales de una factura o de un cobro):
 * - «Forma de pago», «Datos para el pago», «Condiciones de pago», «Fecha de pago», «Pagar a», «Por
 *   pagar», «Pago por transferencia», «Payment terms», «Payment details», «Amount due», «Balance due»,
 *   «Pay to», «Payable to», «Due upon receipt», «Comprobante autorizado» (AFIP): ningún patrón las toma.
 * - Una marca dentro de una condición o un pedido de la misma frase: «If paid in full by…», «Si ya
 *   pagó, ignore este aviso», «Once the invoice is paid…», «Una vez…», «Después de…», «Após…»,
 *   «Payments received after the due date…», «Envíe el comprobante de pago a pagos@…», «Please send
 *   the payment receipt». Se descarta si antes, en la misma frase, hay una condición («if», «once»,
 *   «when», «upon», «unless», «until», «after», «si», «cuando», «una vez», «en caso», «hasta que»,
 *   «caso», «após»…) o un verbo de pedido («send», «email», «envíe», «adjunte», «encaminhe»…). No
 *   cuentan como condición «Sí,» (con tilde), «once again» / «una vez más» ni «Caso 4521». No es un
 *   pedido «We send you the payment receipt» ni «Per your request» (quien escribe manda el recibo).
 *   «Les enviamos el recibo de pago» SÍ cuenta; «Le enviaremos el recibo de pago…» (futuro) no.
 * - Una regla general sobre cualquier pago: «Todo pago realizado fuera de plazo…», «Any payment…».
 * - Un futuro o una obligación: «to be paid on», «must be paid in full», «será pagado el», «can be paid
 *   via ACH», «Payment processed within 3 days», «Payment confirmation will be sent…».
 * - Un monto pagado en cero: «Amount paid: $0.00», «Total pagado: 0,00».
 * - «gracias por su pago oportuno / puntual / anticipado», «thank you for your payment in advance»,
 *   «thank you for paying on time / by bank transfer».
 * - «IVA liquidado», «El IVA fue liquidado…» (liquidación de impuestos): «liquidado» solo cuenta en
 *   «factura/cuenta/saldo liquidada» o como sello.
 */
import { foldText, regionAt, rejoinSpacedLetters, snippetAround } from "./heuristics";

export interface PaidMarker {
  /** Línea del documento donde aparece (texto original, espacios colapsados). */
  text: string;
  /** Por qué indica que ya se pagó, en español. */
  reason: string;
}

const REASON_RECEIPT = "Se presenta como recibo o comprobante de un pago ya hecho";
const REASON_PAID = "Dice que el pago ya se hizo o ya se recibió";
const REASON_ZERO = "Dice que no queda saldo por pagar";
const REASON_STAMP = "Sello de «pagado» en una línea propia";

interface PaidRule {
  reason: string;
  pattern: RegExp;
  /** No cuenta si el monto que sigue es cero («Amount paid: $0.00»). */
  skipIfZeroAmount?: boolean;
  /** No cuenta si lo que va justo antes, en la misma frase, cumple esto («For payment confirmation, …»). */
  notAfter?: RegExp;
  /**
   * Solo en la pasada normal. La segunda pasada (sin espacios ni límites de palabra) es para títulos;
   * en una frase larga o con palabras cortas al final daría coincidencias dentro de otras palabras.
   */
  strictOnly?: boolean;
}

/** «para la», «for», «pra»: la marca es el nombre de algo que se pide o se describe, no un hecho. */
const FOR_PREFIX = /\b(?:para|pra|for|por)\s+(?:(?:la|el|su|tu|a|o|your|the)\s+)?$/;
/** Lo que sigue a «payment confirmation» / «confirmación de pago» cuando es una etiqueta o un aviso. */
const NOT_A_FACT_AFTER = "(?!\\s*(?:will|to|must|should|shall|is\\s+required|required|email|e-mail|sera|se\\s+enviara|debe|deve|sera\\s+enviad[oa])\\b)(?!\\s*[:\\-]?\\s*\\S+@)";
/**
 * Lo que sigue a «payment receipt» / «recibo de pago» cuando el recibo todavía no existe («… will be
 * sent», «… estará disponible», «… available on request»). «May» no está: es también el mes
 * («Payment receipt May 2026»); «… is available in your account» tampoco (dice que el pago ya se hizo).
 */
const RECEIPT_NOT_FACT =
  "(?!\\s+(?:will|shall|can|must|should|is\\s+(?:sent|issued|required)|are\\s+(?:sent|issued)|(?:is\\s+|are\\s+)?available\\s+(?:on|upon)\\s+request|upon|on\\s+request|sera|seran|estara|estaran|se\\s+(?:enviara|emitira|emite|envia)|puede|podra|debe|deberan?|deve|devera|a\\s+solicitud|disponible\\s+(?:a|bajo|previa)\\s+solicitud|mediante\\s+solicitud)\\b)";
/** Futuros u obligaciones justo antes de «paid» («must be paid», «to be paid»…). */
const EN_MODAL_BEFORE = "(?<!\\b(?:be|been|being|must|should|shall|will|would|to|can|may|not|never)\\s+(?:\\w+\\s+)?)";
const ES_MODAL_BEFORE = "(?<!\\b(?:ser|sera|seran|sea|sean|debe|deben|debera|deberan|es|son|puede|pueden|podra|podran)\\s+(?:\\w+\\s+)?)";
/** Medios de pago después de «paid via / pagado con». */
const EN_METHODS =
  "(?:wire|bank|credit|debit|card|visa|master\\s*card|amex|american\\s+express|ach|paypal|stripe|transfer|check|cheque|cash|zelle|swift|sepa|direct\\s+debit|apple\\s+pay|google\\s+pay)";
const ES_METHODS = "(?:transferencia|tarjeta|efectivo|cheque|pse|consignacion|deposito|nequi|daviplata|spei|yape|plin|mercado\\s*pago)";
/** Lo que no es un hecho cumplido después de la marca («… after the due date», «… within 3 days»). */
const NOT_LATER = "(?!\\s+(?:after|late|later|by|before|within|on\\s+or|no\\s+later|upon|once|when|only|in\\s+advance|in\\s+installments|in\\s+(?:\\d|one|two|three|four|five|six|thirty|sixty|ninety)|monthly|despues|tarde|antes|dentro|fuera|con\\s+posterioridad|a\\s+mas\\s+tardar|apos|depois|ate|em\\s+atraso)\\b)";
/** Monto cero con su moneda, justo después de una etiqueta de saldo («: $0.00», «COP 0», «R$ 0,00»). */
const ZERO_AMOUNT =
  "\\s*[:\\-–]?\\s*(?:(?:usd|us\\$|eur|gbp|cad|mxn|cop|brl|pen|clp|ars|uyu|bob|pyg|r\\$|s\\/|\\$|€|£)\\s*)?0(?:[.,]0{1,2})?(?![\\d.,]*\\d)(?!\\s*%)";

const rx = (source: string) => new RegExp(source, "g");

// Todos los patrones se aplican sobre texto plegado (minúsculas, sin tildes).
const RULES: PaidRule[] = [
  // 1. Se presenta como recibo
  { reason: REASON_RECEIPT, pattern: rx(`\\bpayment\\s+receipt\\b${RECEIPT_NOT_FACT}`) },
  { reason: REASON_RECEIPT, pattern: /\breceipt\s+(?:of|for)\s+(?:your\s+)?payment\b/g },
  { reason: REASON_RECEIPT, pattern: /\breceipt\s+for\s+(?:invoice|order|your\s+(?:order|purchase|subscription))\b/g, strictOnly: true },
  { reason: REASON_RECEIPT, pattern: rx(`\\brecibo\\s+(?:oficial\\s+)?de\\s+(?:pago|caja|dinero)\\b${RECEIPT_NOT_FACT}`) },
  { reason: REASON_RECEIPT, pattern: rx(`\\b(?:comprobante|constancia)\\s+de\\s+(?:pago|transferencia|deposito|consignacion)\\b${RECEIPT_NOT_FACT}`) },
  { reason: REASON_RECEIPT, pattern: rx(`\\b(?:comprovante|recibo)\\s+de\\s+(?:pagamento|transferencia|deposito|pix)\\b${RECEIPT_NOT_FACT}`) },
  { reason: REASON_RECEIPT, pattern: /\b(?:recibo|termo|carta|declaracao)\s+de\s+quitacao\b/g },
  { reason: REASON_RECEIPT, pattern: /\b(?:plena|total|geral|rasa)\s+(?:e\s+(?:geral|irrevogavel|irretratavel)\s+)?quitacao\b/g, strictOnly: true },
  { reason: REASON_RECEIPT, pattern: rx(`\\bpayment\\s+(?:confirmation|acknowledg(?:e)?ment)\\b${NOT_A_FACT_AFTER}`), notAfter: FOR_PREFIX },
  { reason: REASON_RECEIPT, pattern: rx(`\\bconfirmacion\\s+del?\\s+(?:su\\s+)?pago\\b${NOT_A_FACT_AFTER}`), notAfter: FOR_PREFIX },
  { reason: REASON_RECEIPT, pattern: rx(`\\bconfirmacao\\s+de\\s+(?:seu\\s+)?pagamento\\b${NOT_A_FACT_AFTER}`), notAfter: FOR_PREFIX },
  { reason: REASON_RECEIPT, pattern: /\breceived\s+with\s+thanks\b/g },
  { reason: REASON_RECEIPT, pattern: /\brecibi\s+conforme\b/g, strictOnly: true },
  { reason: REASON_RECEIPT, pattern: /\brecib(?:i|imos)\s+(?:de|del)\b[^\n]{0,160}?\b(?:la\s+)?(?:suma|cantidad)\s+de\b/g, strictOnly: true },
  { reason: REASON_RECEIPT, pattern: /\breceb(?:i|emos)\s+(?:de|do|da)\b[^\n]{0,160}?\b(?:a\s+)?(?:importancia|quantia|soma)\s+de\b/g, strictOnly: true },
  { reason: REASON_RECEIPT, pattern: /\breceived\s+from\b[^\n]{0,160}?\bthe\s+(?:sum|amount)\s+of\b/g, strictOnly: true },

  // 2. El pago ya se hizo o se recibió · inglés
  { reason: REASON_PAID, pattern: /\bpayment\s+(?:has\s+been\s+|was\s+)?received\b(?!\s+(?:after|by|before|later|late|within|past)\b)/g },
  { reason: REASON_PAID, pattern: /\breceived\s+(?:your|the)\s+(?:payment|transfer|wire|remittance)\b/g, strictOnly: true },
  { reason: REASON_PAID, pattern: /(?<!\b(?:be|must|should|shall|will|would|to|can|may|not|never)\s+)\bpaid\s+(?:on|in\s+full)\b/g },
  { reason: REASON_PAID, pattern: rx(`${EN_MODAL_BEFORE}\\bfully\\s+paid\\b`), strictOnly: true },
  { reason: REASON_PAID, pattern: /\b(?:has|have|had)\s+(?:already\s+)?been\s+(?:paid|settled)\b/g },
  { reason: REASON_PAID, pattern: rx(`\\b(?:was|were)\\s+(?:(?:already|successfully|fully)\\s+)?(?:paid|settled)\\b${NOT_LATER}`), strictOnly: true },
  { reason: REASON_PAID, pattern: /\b(?:is|are)\s+(?:(?:now|already)\s+)?(?:fully\s+)?paid(?:\s+in\s+full)?(?=[^\S\n]*(?:[.!;)]|\n|$))/g, strictOnly: true },
  { reason: REASON_PAID, pattern: rx(`${EN_MODAL_BEFORE}\\bpaid\\s+(?:via|by|with|using|through)\\s+${EN_METHODS}\\b`), strictOnly: true },
  { reason: REASON_PAID, pattern: rx(`${EN_MODAL_BEFORE}\\bsettled\\s+(?:on|in\\s+full|via|by\\s+(?:wire|bank|card|transfer|ach))\\b`), strictOnly: true },
  { reason: REASON_PAID, pattern: /\b(?:date\s+paid|paid\s+date)\b(?=[^\n\d]{0,20}\d)/g, strictOnly: true },
  {
    reason: REASON_PAID,
    pattern: rx(
      `\\bpayment\\s+(?:was\\s+|has\\s+been\\s+)?(?:successful(?:ly\\s+(?:made|processed|received|completed|applied))?|complete|completed|confirmed|applied|posted|processed|settled|credited|cleared)\\b${NOT_LATER}`,
    ),
    strictOnly: true,
  },
  {
    reason: REASON_PAID,
    pattern: rx(
      `\\bpayment\\s+of\\s+(?:(?:usd|us\\$|eur|gbp|cad|mxn|cop|brl|pen|clp|ars|r\\$|s\\/|\\$|€|£)\\s*)?\\d[\\d.,]*(?:\\s*(?:usd|eur|gbp|cad|mxn|cop|brl|pen|clp|ars))?\\s+(?:(?:has\\s+been|was)\\s+)?(?:received|made|processed|applied|credited)\\b${NOT_LATER}`,
    ),
    strictOnly: true,
  },
  { reason: REASON_PAID, pattern: /\bthank(?:s|\s+you)\s+(?:(?:so|very)\s+much\s+)?for\s+(?:your|the)\s+(?:recent\s+)?payment\b(?!\s+in\s+advance)/g },
  {
    reason: REASON_PAID,
    pattern: /\bthank(?:s|\s+you)\s+(?:(?:so|very)\s+much\s+)?for\s+paying\b(?!\s+(?:on\s+time|promptly|in\s+advance|by|via|with|through|before|within)\b)/g,
    strictOnly: true,
  },
  { reason: REASON_PAID, pattern: /\b(?:amount|total)\s+(?:paid|received)\b/g, skipIfZeroAmount: true },
  {
    reason: REASON_PAID,
    pattern: rx(
      `${EN_MODAL_BEFORE}\\bcharged\\s+to\\s+your\\s+(?:card|credit\\s+card|debit\\s+card|visa|master\\s*card|amex|account)\\b|\\byour\\s+(?:card|credit\\s+card|debit\\s+card|account)\\s+(?:was|has\\s+been)\\s+(?:successfully\\s+)?charged\\b`,
    ),
    strictOnly: true,
  },

  // 2. El pago ya se hizo o se recibió · español
  { reason: REASON_PAID, pattern: /\bpago\s+recibido\b/g },
  {
    reason: REASON_PAID,
    pattern: rx(
      `\\bpago\\s+(?:fue\\s+|ha\\s+sido\\s+)?(?:aplicado|acreditado|confirmado|realizado|efectuado|exitoso|aprobado|registrado|procesado|completado)\\b${NOT_LATER}`,
    ),
    strictOnly: true,
  },
  { reason: REASON_PAID, pattern: /\btransacci?on\s+(?:aprobada|exitosa)\b/g, strictOnly: true },
  {
    reason: REASON_PAID,
    pattern: /\b(?:hemos\s+recibido|recibimos|ya\s+recibimos|acabamos\s+de\s+recibir|se\s+recibio|se\s+ha\s+recibido)\s+(?:(?:su|el|tu|la)\s+)?(?:pago|transferencia|deposito|consignacion|abono)\b/g,
  },
  { reason: REASON_PAID, pattern: /\bacus(?:amos|o)\s+recibo\s+de\s+(?:(?:su|tu|el)\s+)?(?:pago|transferencia|deposito|consignacion)\b/g, strictOnly: true },
  { reason: REASON_PAID, pattern: /(?<!\b(?:ser|sera|seran|sea|sean|debe|deben|debera|deberan|es|son)\s+)\bpagad[oa]s?\s+el\b/g },
  { reason: REASON_PAID, pattern: rx(`${ES_MODAL_BEFORE}\\bpagad[oa]s?\\s+(?:con|por|mediante|via|en)\\s+${ES_METHODS}\\b`), strictOnly: true },
  { reason: REASON_PAID, pattern: /\bpagad[oa]s?\s+(?:en\s+su\s+totalidad|totalmente)\b/g },
  {
    reason: REASON_PAID,
    pattern: /\bya\s+(?:(?:fue|fueron|ha\s+sido|han\s+sido|esta|estan|quedo|quedaron|se\s+encuentra|se\s+encuentran)\s+)?pagad[oa]s?\b/g,
  },
  { reason: REASON_PAID, pattern: /\bya\s+se\s+pag(?:o|aron)\b/g },
  { reason: REASON_PAID, pattern: /\bse\s+pag(?:o|aron)\s+(?:el|la|los|las|con|por|mediante|en\s+su\s+totalidad|totalmente)\b/g, strictOnly: true },
  {
    reason: REASON_PAID,
    pattern: rx(
      `\\b(?:fue|fueron|ha\\s+sido|han\\s+sido|esta|estan|quedo|quedaron|se\\s+encuentra|se\\s+encuentran)\\s+(?:totalmente\\s+|completamente\\s+|debidamente\\s+)?(?:pagad[oa]s?|saldad[oa]s?)\\b${NOT_LATER}`,
    ),
    strictOnly: true,
  },
  { reason: REASON_PAID, pattern: /\b(?:total|monto|importe|valor)\s+(?:pagado|recibido)\b/g, skipIfZeroAmount: true },
  { reason: REASON_PAID, pattern: /\bgracias\s+por\s+(?:su|tu|el)\s+pago\b(?!\s+(?:oportuno|puntual|anticipado|a\s+tiempo)\b)/g },

  // 2. El pago ya se hizo o se recibió · portugués
  { reason: REASON_PAID, pattern: /\bpagamento\s+(?:foi\s+)?recebido\b/g },
  {
    reason: REASON_PAID,
    pattern: rx(
      `\\bpagamento\\s+(?:foi\\s+)?(?:confirmado|efetuado|realizado|aprovado|concluido|compensado|creditado|identificado|processado)\\b${NOT_LATER}`,
    ),
    strictOnly: true,
  },
  { reason: REASON_PAID, pattern: /\btransacao\s+aprovada\b/g, strictOnly: true },
  { reason: REASON_PAID, pattern: /\brecebemos\s+(?:o\s+|a\s+)?(?:seu\s+|sua\s+)?(?:pagamento|transferencia|deposito|pix)\b/g },
  { reason: REASON_PAID, pattern: /\bja\s+(?:(?:foi|foram|esta|estao)\s+)?pag[oa]s?\b/g },
  {
    reason: REASON_PAID,
    pattern: rx(`\\b(?:foi|foram|esta|estao|encontra-se|encontram-se)\\s+(?:integralmente\\s+|totalmente\\s+)?(?:pag[oa]s?|quitad[oa]s?)\\b${NOT_LATER}`),
    strictOnly: true,
  },
  { reason: REASON_PAID, pattern: /\b(?:total|valor)\s+(?:pago|recebido)\b/g, skipIfZeroAmount: true },
  { reason: REASON_PAID, pattern: /\bobrigad[oa]\s+pelo\s+(?:seu\s+)?pagamento\b/g },

  // 2. Un documento o un saldo «pagado / saldado / quitado / settled», y un estado «pagado»
  {
    reason: REASON_PAID,
    pattern: rx(
      `\\b(?:factura|fatura|cuenta(?:\\s+de\\s+cobro)?|boleto|nota\\s+fiscal|saldo|deuda|invoice|bill|balance|order)\\s+(?:(?:(?:ya|ja|already|now)\\s+)?(?:esta|fue|foi|ha\\s+sido|is|was|has\\s+been|se\\s+encuentra|encontra-se)\\s+)?(?:(?:totalmente|integralmente|fully)\\s+)?(?:pagad[oa]|paga|quitad[oa]|liquidad[oa]|saldad[oa]|cancelad[oa]|paid|settled)\\b${NOT_LATER}`,
    ),
    strictOnly: true,
  },
  {
    reason: REASON_PAID,
    pattern:
      /\b(?:status|estado|estatus|situacion|situacao)(?:\s+(?:de\s+(?:la\s+)?(?:factura|pago|cuenta)|do\s+pagamento|da\s+fatura|of\s+(?:the\s+)?(?:invoice|payment)|del\s+pago))?\s*[:\-–]?\s*(?:paid|pagad[oa]|(?:pago|paga)(?=[^\S\n]*(?:[.;,)]|\n|$))|quitad[oa]|liquidad[oa]|saldad[oa]|cancelad[oa]|settled)\b(?!\s*(?:pendiente|pending|parcial|partial|parcialmente|partially|vencido|overdue|due|em\s+aberto|atrasado|rechazado|rejected|fallido|failed)\b)/g,
    strictOnly: true,
  },

  // 3. No queda nada por pagar
  {
    reason: REASON_ZERO,
    pattern: rx(
      `(?<!\\b(?:previous|prior|past|old|last|unpaid|credit|available|opening|starting|account|anterior|vencido|inicial|disponible)\\s+)\\b(?:balance|saldo|(?:balance|amount|total)\\s+(?:due|outstanding|remaining|payable|owing|owed)|(?:remaining|outstanding)\\s+balance|saldo\\s+(?:pendiente|a\\s+pagar|por\\s+pagar|adeudado|insoluto|restante|devedor|em\\s+aberto|a\\s+cobrar)|(?:valor|total|monto|importe)\\s+(?:a|por)\\s+pagar|valor\\s+em\\s+aberto|total\\s+(?:devido|a\\s+receber))${ZERO_AMOUNT}`,
    ),
    strictOnly: true,
  },
];

/**
 * Las mismas frases sin exigir espacios ni límites de palabra, para títulos con letras separadas o
 * ya unidos («RECIBODEPAGO»). Se dejan fuera las que dependen de lo que va antes (lookbehind) y las
 * marcadas como solo de la pasada normal.
 */
const RELAXED_RULES: PaidRule[] = RULES.filter((r) => !r.strictOnly && r.pattern.source.includes("\\s+") && !r.pattern.source.includes("(?<")).map((r) => ({
  ...r,
  pattern: new RegExp(r.pattern.source.replace(/\\s\+/g, "\\s*").replace(/\\b/g, ""), r.pattern.flags),
}));

// ───────────────────────── Contexto: condiciones, pedidos, futuros ─────────────────────────

/**
 * Antes de la marca, en la misma frase: una condición («if», «cuando», «una vez»…). «si» se mira aparte
 * (ver isConditional). «After reviewing…», «Después de revisar…» y «Upon review…» cuentan una
 * revisión ya hecha, no una condición.
 */
const CONDITIONAL =
  /\b(?:if|once|when|whenever|upon(?!\s+(?:review|reviewing|checking|verification|verifying))|unless|until|after(?!\s+\w+ing\b)|provided|as\s+long\s+as|cuando|una\s+vez|en\s+caso|hasta\s+que|siempre\s+que|despues\s+de(?!\s+(?:revisar|verificar|consultar|validar|confirmar))|luego\s+de(?!\s+(?:revisar|verificar|consultar|validar|confirmar))|apos|depois\s+de(?!\s+(?:verificar|conferir|consultar|validar|confirmar))|ate\s+que|contanto\s+que|desde\s+que|caso(?!\s*(?:#|n\s*[°o.]|no\.|nro|numero|\d)))\b/;
/** Expresiones con «once» / «una vez» que no son una condición. */
const NOT_CONDITIONAL = /\b(?:once\s+(?:again|more)|una\s+vez\s+mas|uma\s+vez\s+mais|mais\s+uma\s+vez|de\s+una\s+vez)\b/g;
/** «si» sin tilde como palabra (sobre el texto original en minúsculas: «Sí,» no es una condición). */
const SI_CONDITIONAL = /(?<![\p{L}\p{N}])si(?![\p{L}\p{N}])/u;
/** Antes de la marca, en la misma frase: un pedido («envíe el comprobante», «please send the receipt»). */
const REQUEST =
  /\b(?:send|email|e-mail|forward|submit|provide|upload|request|attach|envie|envien|enviar|envienos|enviarnos|remita|remitan|remitir|mande|manden|mandar|adjunte|adjunten|adjuntar|comparta|compartan|compartir|solicite|soliciten|solicitar|enviem|encaminhe|encaminhem|encaminhar|anexe|anexem|anexar|compartilhe|compartilhar)\b/;
/** Quien escribe manda el recibo ahora o ya lo mandó («we send you», «I'm forwarding», «per your request»): no es un pedido. */
const NOT_REQUEST =
  /\b(?:(?:we|i)(?:'re|'m|\s+(?:are|am|have|hereby|now|also|kindly|gladly))?\s+(?:send|sent|email|emailed|forward|forwarded|submit|submitted|provide|attach|attached|sending|emailing|forwarding|attaching|providing)|(?:as\s+)?per\s+your\s+request|at\s+your\s+request|as\s+requested)\b/g;
/** Un futuro de quien escribe («Le enviaremos el recibo de pago…», «We will send a payment receipt…»): el recibo todavía no existe. */
const FUTURE = /\b(?:will|shall|enviaremos|remitiremos|mandaremos|emitiremos|entregaremos|haremos\s+llegar|vamos\s+a\s+(?:enviar|mandar|remitir|emitir))\b|[’']ll\b/;
/** Una regla general sobre cualquier pago justo antes de la marca («Todo pago realizado…», «Any payment received…»). */
const QUANTIFIER_BEFORE = /\b(?:todo|toda|todos|todas|cualquier|any|all|every|each|qualquer)\s+$/;
/** Cuánto texto antes de la marca se mira como «la misma frase». */
const PREFIX_WINDOW = 100;
const INVISIBLE = /\p{Default_Ignorable_Code_Point}/gu;

/** Dónde empieza la frase de `at` (corta en un salto de línea o en «. », «! », «? », «; »), a lo sumo PREFIX_WINDOW atrás. */
function sentenceStart(folded: string, at: number): number {
  const from = Math.max(0, at - PREFIX_WINDOW);
  for (let i = at - 1; i >= from; i--) {
    const ch = folded[i];
    if (ch === "\n") return i + 1;
    if ((ch === "." || ch === "!" || ch === "?" || ch === ";") && /\s/.test(folded[i + 1] ?? "")) return i + 1;
  }
  return from;
}

/** ¿Hay una condición antes de la marca? `original` es el mismo tramo del texto sin plegar (para distinguir «si» de «sí»). */
function isConditional(prefix: string, original: string): boolean {
  if (CONDITIONAL.test(prefix.replace(NOT_CONDITIONAL, " "))) return true;
  return SI_CONDITIONAL.test(original.replace(INVISIBLE, "").normalize("NFKC").toLowerCase());
}

/** ¿El primer número que sigue (hasta 40 caracteres) es cero? «Amount paid: $0.00» → true. */
function followedByZero(folded: string, end: number): boolean {
  const m = /\d[\d.,' ]*/.exec(folded.slice(end, end + 40));
  return m != null && /^[0.,' ]+$/.test(m[0].trim());
}

function excluded(rule: PaidRule, text: string, folded: string, map: readonly number[], fStart: number, fEnd: number): boolean {
  const from = sentenceStart(folded, fStart);
  const prefix = folded.slice(from, fStart);
  if (isConditional(prefix, text.slice(map[from], map[fStart]))) return true;
  if (REQUEST.test(prefix.replace(NOT_REQUEST, " "))) return true;
  if (QUANTIFIER_BEFORE.test(prefix)) return true;
  if (rule.reason === REASON_RECEIPT && FUTURE.test(prefix)) return true;
  if (rule.notAfter?.test(prefix)) return true;
  return rule.skipIfZeroAmount === true && followedByZero(folded, fEnd);
}

// ───────────────────────── Líneas: sellos y títulos ─────────────────────────

/** Palabras de un sello de pagado. */
const STAMP_WORDS: ReadonlySet<string> = new Set([
  "paid", "pagado", "pagada", "pagados", "pagadas", "pago", "paga", "quitado", "quitada", "liquidado", "liquidada",
  "saldado", "saldada", "cancelado", "cancelada", "settled",
]);
/** Las que cuentan también con mayúscula inicial («Pagado», «Settled»): no son un encabezado común. */
const LONG_STAMP_WORDS: ReadonlySet<string> = new Set([
  "pagado", "pagada", "quitado", "quitada", "liquidado", "liquidada", "saldado", "saldada", "cancelado", "cancelada", "settled",
]);
/** Sellos que también son un sustantivo común: solo cuentan solos en la línea (con signos o números). */
const AMBIGUOUS_STAMP_WORDS: ReadonlySet<string> = new Set(["pago", "paga"]);
/** Palabras que pueden acompañar al sello: una fecha («10 AUG 2026», «EL 10 DE AGOSTO») o «with thanks». */
const STAMP_COMPANIONS: ReadonlySet<string> = new Set([
  "on", "el", "em", "en", "de", "del", "do", "da", "in", "full", "with", "thanks", "thank", "you", "gracias", "obrigado", "obrigada",
  "jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "sept", "oct", "nov", "dec",
  "ene", "abr", "ago", "dic", "fev", "mai", "set", "out", "dez",
  "january", "february", "march", "april", "june", "july", "august", "september", "october", "november", "december",
  "enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "setiembre", "octubre", "noviembre", "diciembre",
  "janeiro", "fevereiro", "marco", "maio", "junho", "julho", "setembro", "outubro", "novembro", "dezembro",
]);
const CHECK_MARK = /[✓✔☑✅]/u;

function isUppercase(s: string): boolean {
  return s === s.toUpperCase() && s !== s.toLowerCase();
}

function isTitleCase(s: string): boolean {
  const [first, ...rest] = [...s];
  return isUppercase(first) && rest.join("") === rest.join("").toLowerCase();
}

function foldWord(s: string): string {
  return foldText(s).folded;
}

/**
 * Líneas que son un sello de pagado: «PAID», «*** PAGADO ***», «PAGADO 12/08/2026», «PAID 10 AUG
 * 2026», «P A G A D O», «Pagado», «Paid ✓». El sello va en mayúsculas (las formas largas también con
 * mayúscula inicial; cualquiera con una marca de verificación) y lo demás de la línea son signos,
 * números o palabras de una fecha.
 */
function stampLines(text: string): { line: string; position: number }[] {
  const out: { line: string; position: number }[] = [];
  let position = 0;
  for (const raw of text.split("\n")) {
    const line = raw.replace(INVISIBLE, "");
    let words = [...line.matchAll(/\p{L}+/gu)].map((m) => m[0]);
    // «P A G A D O»: letras sueltas separadas por espacios.
    if (words.length >= 4 && words.every((w) => [...w].length === 1)) words = [words.join("")];
    const [stamp, ...rest] = words;
    if (stamp != null && words.length <= 8) {
      const key = foldWord(stamp);
      const cased = isUppercase(stamp) || (LONG_STAMP_WORDS.has(key) && isTitleCase(stamp)) || CHECK_MARK.test(line);
      // «PAGO» y «PAGA» también son sustantivos («PAGO: 15/11/2026» puede ser la fecha de pago): solos, sin números ni «:».
      const companionsOk = AMBIGUOUS_STAMP_WORDS.has(key)
        ? rest.length === 0 && !/[\d:]/.test(line)
        : rest.every((w) => STAMP_COMPANIONS.has(foldWord(w)));
      if (STAMP_WORDS.has(key) && cased && companionsOk) {
        out.push({ line: raw.replace(/\s+/g, " ").trim(), position });
      }
    }
    position += raw.length + 1;
  }
  return out;
}

/** Prefijos de la línea del asunto de un correo («Asunto: Re: …»). */
const SUBJECT_PREFIX = /^\s*(?:(?:asunto|subject|assunto|re|rv|fw|fwd|tr|enc)\s*:\s*)+/;
/** La línea es el título «Receipt» / «Recibo», con su número si lo trae, o «Receipt from <proveedor>». */
const RECEIPT_TITLE =
  /^[^\p{L}\p{N}]*(?:(?:receipt|recibo)(?:\s*(?:#|n\s*[°o.]+|no\.?|nro\.?|num(?:ero)?\.?|number|nr\.?)?\s*[\w./-]*\d[\w./-]*)?[^\p{L}]*|receipt\s+from\s+\S.*)$/u;

/** Líneas que son el título de un recibo: «Receipt», «RECEIPT #1234-5678», «Recibo N° 0045», «Receipt from CloudMetrics». */
function receiptTitleLines(text: string): { line: string; position: number }[] {
  const out: { line: string; position: number }[] = [];
  let position = 0;
  for (const raw of text.split("\n")) {
    const folded = foldText(raw).folded.replace(SUBJECT_PREFIX, "").trim();
    if (folded && RECEIPT_TITLE.test(folded)) out.push({ line: raw.replace(/\s+/g, " ").trim(), position });
    position += raw.length + 1;
  }
  return out;
}

// ───────────────────────── Detector ─────────────────────────

/**
 * Busca marcas de que el documento es de algo ya pagado. Devuelve una entrada por línea (si una
 * línea activa varias marcas, las razones se unen con "; "), en el orden del documento.
 */
export function detectPaidDocumentMarkers(text: string): PaidMarker[] {
  if (!text) return [];
  const { folded, map } = foldText(text);
  const bySnippet = new Map<string, { position: number; reasons: Set<string> }>();

  const record = (snippet: string, position: number, reason: string) => {
    if (!snippet) return;
    const entry = bySnippet.get(snippet);
    if (entry) {
      entry.reasons.add(reason);
      entry.position = Math.min(entry.position, position);
    } else {
      bySnippet.set(snippet, { position, reasons: new Set([reason]) });
    }
  };
  /** Registra una coincidencia [fStart, fEnd) del texto plegado, salvo que el contexto la descarte. */
  const add = (rule: PaidRule, fStart: number, fEnd: number) => {
    if (excluded(rule, text, folded, map, fStart, fEnd)) return;
    const start = map[fStart];
    const end = Math.max(map[Math.min(fEnd, map.length - 1)], start + 1);
    record(snippetAround(text, start, end), start, rule.reason);
  };

  for (const rule of RULES) {
    for (const m of folded.matchAll(rule.pattern)) add(rule, m.index, m.index + m[0].length);
  }

  // Segunda pasada: títulos con letras separadas por espacios o ya unidos («RECIBODEPAGO»).
  const re = rejoinSpacedLetters(folded, text, map);
  if (re) {
    const toFolded = (i: number) => re.map[Math.min(i, re.map.length - 1)];
    for (const rule of RELAXED_RULES) {
      for (const m of re.text.matchAll(rule.pattern)) {
        const s = m.index;
        const e = s + m[0].length;
        const region = regionAt(re.regions, s, e);
        // En un tramo unido basta tocarlo; en una palabra larga en mayúsculas la frase debe empezar con ella.
        if (!region || (!region.joined && region.start !== s)) continue;
        add(rule, toFolded(s), toFolded(e));
      }
    }
  }

  for (const { line, position } of stampLines(text)) record(line, position, REASON_STAMP);
  for (const { line, position } of receiptTitleLines(text)) record(line, position, REASON_RECEIPT);

  return [...bySnippet.entries()]
    .sort((a, b) => a[1].position - b[1].position)
    .map(([snippet, { reasons }]) => ({ text: snippet, reason: [...reasons].join("; ") }));
}
