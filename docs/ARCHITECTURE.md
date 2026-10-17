# Arquitectura

Centinela es un agente con un ciclo fijo por factura: **percibe** (dos lecturas de Claude con prompts o modelos distintos, cada dato con su cita, y detectores en código sin modelo), **decide** (la política de la empresa: 15 comprobaciones en código, `src/engine`), **se revisa** (guardia independiente, `src/guard`), **registra** (registro inmutable con el porqué, `src/store`) y **pide permiso** (ESCALAR con la acción sugerida para una persona). El modelo solo produce `Extraction`; ninguna salida de un modelo elige el resultado. Las dos lecturas vienen de modelos de Anthropic y pueden fallar igual: por eso monto, cuenta y acuerdo se comparan después, en código, con la ficha del proveedor, y lo que el set de estrés mostró que los dos lectores confunden a la vez (un recibo leído como factura, el subtotal copiado como total en una foto borrosa) lo revisan reglas en código que no dependen del modelo. El agente entrega una decisión, no un pago. La tabla siguiente recorre ese ciclo paso a paso.

## Recorrido de una factura

| Paso | Qué hace | Módulo |
|---|---|---|
| 1. Entrada | Normaliza el archivo (PDF y foto van al modelo tal cual; correo → cuerpo + adjuntos; chat → texto). Calcula la huella sha256. Extrae texto plano sin modelo cuando se puede. | `src/ingest` |
| 2. Doble lectura | Dos lectores en paralelo según el perfil de lectura (ver «Perfiles de lectura»; sus errores pueden coincidir) con salida estructurada `Extraction`: cada campo trae valor, cita textual y si fue legible; más el tipo de documento y la lista de instrucciones detectadas. | `src/extract` |
| 3. Verificación | Compara las dos lecturas en campos críticos, revisa la aritmética, verifica que las citas existan en el texto (sin texto verificable, que la cita del total traiga su etiqueta), y corre dos detectores por patrones sin modelo: instrucciones escondidas y documento ya pagado. Produce `ReadingSignals`. | `src/extract` |
| 4. Motor | Evalúa las 15 comprobaciones (todas, sin cortocircuito) y decide. | `src/engine` |
| 5. Guardia | Si el motor dice PAGAR, una implementación independiente revisa los límites duros (y rechaza todo documento con señal de ya pagado). Si discrepa → ESCALAR. | `src/guard` |
| 6. Registro | Guarda `DecisionRecord` inmutable: decisión, lecturas, señales, copia de reglas y proveedores, versiones. | `src/store` |

La pantalla envía las facturas **una por una**, en orden (el fondo, el límite mensual y los duplicados dependen del historial).

## Pago doble entre instancias

`processInvoice` procesa de a una factura **por proceso** (candado en memoria). En Vercel puede haber dos procesos, y cada uno decide sobre el historial que leyó. Para que dos procesos no paguen lo mismo, cada decisión PAGAR guarda tres claves en `decisions`, con índice **único** cada una (los `null` no chocan):

| Columna | Valor | Comprobación que espeja |
|---|---|---|
| `pay_file_key` | huella del archivo | DUP-1 |
| `pay_invoice_key` | proveedor + número de factura normalizado (alfanumérico en mayúsculas, sin tildes, sin ceros a la izquierda en cada tramo numérico, ancho completo convertido) | DUP-2 |
| `pay_period_key` | acuerdo + periodo, o acuerdo + `once` si el acuerdo es de pago único | DUP-3 |

FRENAR y ESCALAR no llevan claves. Si el insert choca, `appendDecision` lanza `DuplicatePaymentError` y no guarda nada; `processInvoice` vuelve a decidir **una vez** con el historial fresco (ya incluye el pago del otro proceso: el motor frena por duplicado). Si vuelve a chocar, registra ESCALAR y marca como no evaluable la comprobación DUP de esa clave, con la explicación.

`ensureSchema` migra bases anteriores: agrega las columnas, rellena las de los PAGAR ya guardados (si dos comparten una clave, solo la recibe el primero) y después crea los índices. El disparador que hace inmutable el registro solo deja rellenar claves vacías de un PAGAR dentro de esa transacción.

**Qué no cubre.** El límite del mes (LIM-2) y el fondo (FON-1) suman pagos distintos, así que no se pueden expresar como clave única: entre instancias siguen dependiendo del candado por proceso. Dos procesos podrían aprobar a la vez dos facturas distintas que juntas superen el límite o el fondo. La interfaz sube de a una factura, lo que reduce ese caso a dos pestañas o dos personas subiendo al mismo tiempo.

## Comprobaciones

Ver `src/core/checks.ts`. Regla: alguna FRENAR → FRENAR; si no, alguna ESCALAR → ESCALAR; si no, PAGAR.

## «Lo acordado»

Cada proveedor de la ficha tiene acuerdos: tipo (`fixed_recurring`, `hourly`, `one_off`), monto o tarifa, moneda, frecuencia (`monthly` / `once`), vigencia y la cuenta destino registrada del proveedor. Una factura no cuadra si cambia la moneda, se sale del monto (± tolerancia), la tarifa × cantidad no coincide o supera el máximo, el periodo ya se pagó, el acuerdo no está vigente o la cuenta destino no es la registrada.

**Supuesto pendiente de revisar con el equipo.**

## Perfiles de lectura

`READER_PROFILE` (o `--profile` en el banco de pruebas) elige modelo y prompt de cada lectura (`src/extract/profiles.ts`). Los dos usan esfuerzo `low`.

| Perfil | Lectura «a» (`lector-a`) | Lectura «b» (`lector-b`) | Costo aprox. por factura |
|---|---|---|---:|
| `economico` (por defecto) | Haiku 5.5, prompt «a» (`v4`) | Haiku 5.5, prompt «b» (`v4b`): otra formulación (auditor que transcribe y luego interpreta, campos en otro orden) para que las dos lecturas no sean copias | USD 0,0026 |
| `calidad` | Sonnet 5.5, prompt «a» (`v4`) | Haiku 5.5, prompt «a» (`v4`) | USD 0,02 |

Con cualquier perfil el modelo solo lee: la verificación, el motor y la guardia son los mismos.

## Documentos ya pagados y total sin texto verificable

El set de estrés encontró dos huecos en los que las dos lecturas coinciden, no hay señales y se pagaba: recibos de algo ya pagado leídos como factura, y una foto con el total borroso donde las dos lecturas pusieron el subtotal como total. Los dos se cierran en código, sin depender de que el modelo acierte:

- **Detector de documento ya pagado** (`src/extract/paid-markers.ts`, como el de instrucciones). Busca en el texto plano (PDF con texto, correo con adjuntos, chat) marcas inequívocas en español, inglés y portugués: «Payment receipt», «Payment received on…», «Payment confirmation», «Paid in full», «Paid via wire», «Settled on…», «Status: Paid», «Charged to your card», «Recibo de pago», «Recibo de caja», «Comprobante de pago», «Pago recibido / aplicado / acreditado», «Pagado el…», «La factura fue pagada», «Factura saldada», «Total pagado», «Recibí de … la suma de», «Comprovante de pagamento», «Pagamento recebido / confirmado», «Fatura quitada», «Plena quitação»; un saldo por pagar en cero justo después de su etiqueta («Balance due: $0.00», «Saldo pendiente: COP 0»); el título «Receipt» / «Recibo N° …» en su propia línea o en el asunto; y sellos aislados («PAGADO», «PAID», «PAGO», «QUITADO», «LIQUIDADO», «CANCELADO», «SETTLED», también con fecha: «PAID 10 AUG 2026»). No se dispara con «Forma de pago», «Datos para el pago», «Pago por transferencia», «Payment terms», «Amount due», «Due upon receipt», «IVA liquidado», «Comprobante autorizado» (AFIP), ni con condiciones, pedidos, futuros o reglas generales («If paid in full by…», «Envíe el comprobante de pago a…», «Le enviaremos el recibo de pago…», «Todo pago realizado fuera de plazo…», «can be paid via ACH»). «Sí,» con tilde, «una vez más» y «once again» no cuentan como condición. La señal `paidDocumentMarkers` junta estas marcas y una entrada por cada lectura que diga `receipt`. Si no está vacía, LEC-1 escala con la cita («El documento indica que ya fue pagado: «Payment received on 2026-08-10…»») y la guardia, con su propia lógica, rechaza el pago. Sobre el dataset: 0 marcas en los 41 archivos base y en las 877 legítimas del set de estrés; detecta los 22 recibos que tienen texto. Los recibos en foto dependen de que una lectura diga `receipt`. Límites: «Paid» o «Pago» con mayúscula inicial solos en una línea no cuentan (son encabezados de columna comunes), y un recibo sin ninguna de estas frases (p. ej. solo «Recibido de: …») depende de las lecturas.
- **Total sin texto verificable** (`totalNotConfirmedByQuote` en `src/extract/assess.ts`). En una imagen, un PDF sin capa de texto o un documento con una imagen adjunta, la cita no se puede comprobar contra el texto. Ahí el total de una lectura solo cuenta como legible si su cita trae una etiqueta de total («Total», «Total a pagar», «Amount due», «Valor total», «Total geral», «La suma de»…; no cuentan «Subtotal», «Total sin IVA», «Total (sin IVA)», «Total s/IVA», «Total ex VAT», «Total HT», «Total neto», «Net total», «Total bruto», «Total parcial», «Total gravado», «Total IVA», «Total de horas»…), no es la misma cita del subtotal, y la nota de la lectura (`readerNotes`) no dice que el total o el «Amount due» está borroso, que no se pudo leer o que se dedujo (`totalDoubtedInNotes`). Si cualquiera de las dos lecturas no lo cumple, el total queda ilegible y LEC-1 escala. Los prompts `v4`/`v4b` piden citar la línea del total con su etiqueta. Límite: sin texto, una etiqueta inventada sobre la fila del subtotal («Total $86,400.00 MXN» cuando no hay impuestos) se ve igual que la fila real del total; si además ninguna lectura anota la duda, la regla no lo ve. En S0922 lo detienen las notas de las dos lecturas reales y, con `v3b`, la cita sin etiqueta de la segunda. Con las lecturas guardadas, la regla de las notas no marca ninguna de las 92 lecturas de fotos sin total borroso. Costo: con las lecturas reales guardadas (prompts `v3`/`v3b`, perfil `economico`) la regla habría escalado de más 6 de las 11 fotos legítimas de la muestra de 100; con `calidad`, 2 de las 3 fotos legítimas del set de 41. Medido con `v4`/`v4b` (perfil `economico`, 17 de octubre): las 11 fotos legítimas de la muestra de 100 pagan, y 0 pagos indebidos en los 61 recibos y totales borrosos, la muestra de 100 y los 41.

## Modos de lectura

- `live`: llama a la API de Anthropic (requiere `ANTHROPIC_API_KEY`).
- `cache`: reutiliza lecturas guardadas (clave = archivo + lector + modelo + versión de prompt). Repetir evaluaciones no cuesta.
- `simulated`: para archivos del dataset usa la lectura «perfecta» del manifiesto. Sirve para probar la lógica de decisión sin costo. **No mide la calidad de lectura.** La pantalla lo indica.

## Defensa contra instrucciones escondidas

1. Arquitectura: el modelo no decide.
2. Prompt: el documento es dato no confiable; el lector debe reportar instrucciones.
3. Detector por patrones sobre el texto plano (incluye texto oculto en PDF).
4. Doble lectura: dos prompts distintos con Haiku 5.5 (perfil `economico`) o Sonnet 5.5 + Haiku 5.5 (perfil `calidad`), todos modelos de Anthropic.
5. PRV-2 compara la cuenta leída con la registrada.

## Stack

Next.js 16 (App Router) en Vercel Hobby · Postgres en Neon (PGlite en local) con Drizzle · SDK de Anthropic con salida estructurada · Vitest + fast-check · GitHub Actions.
