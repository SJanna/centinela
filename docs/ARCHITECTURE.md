# Arquitectura

## Recorrido de una factura

| Paso | Qué hace | Módulo |
|---|---|---|
| 1. Entrada | Normaliza el archivo (PDF y foto van al modelo tal cual; correo → cuerpo + adjuntos; chat → texto). Calcula la huella sha256. Extrae texto plano sin modelo cuando se puede. | `src/ingest` |
| 2. Doble lectura | Dos lectores independientes en paralelo (Sonnet 5.5 y Haiku 5.5) con salida estructurada `Extraction`: cada campo trae valor, cita textual y si fue legible; más la lista de instrucciones detectadas. | `src/extract` |
| 3. Verificación | Compara las dos lecturas en campos críticos, revisa la aritmética, verifica que las citas existan en el texto, y corre un detector de instrucciones por patrones (sin modelo). Produce `ReadingSignals`. | `src/extract` |
| 4. Motor | Evalúa las 15 comprobaciones (todas, sin cortocircuito) y decide. | `src/engine` |
| 5. Guardia | Si el motor dice PAGAR, una implementación independiente revisa los límites duros. Si discrepa → ESCALAR. | `src/guard` |
| 6. Registro | Guarda `DecisionRecord` inmutable: decisión, lecturas, señales, copia de reglas y proveedores, versiones. | `src/store` |

La pantalla envía las facturas **una por una**, en orden (el fondo, el límite mensual y los duplicados dependen del historial).

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
4. Doble lectura con modelos distintos.
5. PRV-2 compara la cuenta leída con la registrada.

## Stack

Next.js 16 (App Router) en Vercel Hobby · Postgres en Neon (PGlite en local) con Drizzle · SDK de Anthropic con salida estructurada · Vitest + fast-check · GitHub Actions.
