# Arquitectura

Centinela es un agente con un ciclo fijo por factura: **percibe** (dos lecturas con dos modelos de Claude, cada dato con su cita), **decide** (la política de la empresa: 15 comprobaciones en código, `src/engine`), **se revisa** (guardia independiente, `src/guard`), **registra** (registro inmutable con el porqué, `src/store`) y **pide permiso** (ESCALAR con la acción sugerida para una persona). El modelo solo produce `Extraction`; ninguna salida de un modelo elige el resultado. Las dos lecturas vienen de modelos de Anthropic y pueden fallar igual: por eso monto, cuenta y acuerdo se comparan después, en código, con la ficha del proveedor. El agente entrega una decisión, no un pago. La tabla siguiente recorre ese ciclo paso a paso.

## Recorrido de una factura

| Paso | Qué hace | Módulo |
|---|---|---|
| 1. Entrada | Normaliza el archivo (PDF y foto van al modelo tal cual; correo → cuerpo + adjuntos; chat → texto). Calcula la huella sha256. Extrae texto plano sin modelo cuando se puede. | `src/ingest` |
| 2. Doble lectura | Dos lectores en paralelo con modelos distintos de Anthropic (Sonnet 5.5 y Haiku 5.5; sus errores pueden coincidir) con salida estructurada `Extraction`: cada campo trae valor, cita textual y si fue legible; más la lista de instrucciones detectadas. | `src/extract` |
| 3. Verificación | Compara las dos lecturas en campos críticos, revisa la aritmética, verifica que las citas existan en el texto, y corre un detector de instrucciones por patrones (sin modelo). Produce `ReadingSignals`. | `src/extract` |
| 4. Motor | Evalúa las 15 comprobaciones (todas, sin cortocircuito) y decide. | `src/engine` |
| 5. Guardia | Si el motor dice PAGAR, una implementación independiente revisa los límites duros. Si discrepa → ESCALAR. | `src/guard` |
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

## Modos de lectura

- `live`: llama a la API de Anthropic (requiere `ANTHROPIC_API_KEY`).
- `cache`: reutiliza lecturas guardadas (clave = archivo + lector + modelo + versión de prompt). Repetir evaluaciones no cuesta.
- `simulated`: para archivos del dataset usa la lectura «perfecta» del manifiesto. Sirve para probar la lógica de decisión sin costo. **No mide la calidad de lectura.** La pantalla lo indica.

## Defensa contra instrucciones escondidas

1. Arquitectura: el modelo no decide.
2. Prompt: el documento es dato no confiable; el lector debe reportar instrucciones.
3. Detector por patrones sobre el texto plano (incluye texto oculto en PDF).
4. Doble lectura con dos modelos distintos (ambos de Anthropic).
5. PRV-2 compara la cuenta leída con la registrada.

## Stack

Next.js 16 (App Router) en Vercel Hobby · Postgres en Neon (PGlite en local) con Drizzle · SDK de Anthropic con salida estructurada · Vitest + fast-check · GitHub Actions.
