@AGENTS.md

# Centinela · agente que decide qué facturas pagar

Prototipo para el reto Blinka del hackathon 30X. Lee facturas (PDF, imagen, correo, chat), decide **PAGAR / FRENAR / ESCALAR** según reglas de la empresa y deja un registro que cualquiera entiende. No mueve dinero. Arquitectura completa en `docs/ARCHITECTURE.md`.

## Invariantes (no se negocian)

1. **El modelo lee, la lógica decide.** Nada que salga de un modelo de lenguaje elige el resultado. El modelo solo produce `Extraction`; la decisión la toma `src/engine` (código puro).
2. **Por defecto no se paga.** PAGAR solo si las 15 comprobaciones de `src/core/checks.ts` están en `pass`. Una comprobación en `fail` produce su `outcomeIfFail`; una en `not_evaluable` produce ESCALAR.
3. **Doble control de pagos.** Toda decisión PAGAR del motor pasa por `src/guard`. Si la guardia no aprueba, la decisión final es ESCALAR con `guardOverride: true`.
4. **Explicaciones con plantillas.** Los textos de `CheckResult.explanation`, `Decision.summary` y `humanAction` se generan con plantillas y valores concretos, nunca con un modelo.
5. **Las etiquetas del dataset son la referencia.** `dataset/casos.csv` y `dataset/company.json` no se editan para que una prueba pase. Si una etiqueta parece mal, se reporta. Hoy son un borrador redactado con Claude, pendiente de revisión humana.

## Mapa de módulos

| Carpeta | Qué hace | Puede importar |
|---|---|---|
| `src/core` | Contratos: esquemas zod, tipos, catálogo de comprobaciones, normalización, puertos | solo `zod` |
| `src/engine` | `decide(input, ctx): Decision` — función pura | `src/core` |
| `src/guard` | `guardPayment(input, ctx, decision): GuardResult` — implementación independiente, NO importa `src/engine` ni `src/core/normalize` | solo tipos de `src/core/schemas` |
| `src/ingest` | `normalizeFile(bytes, filename, mediaType?)` → `NormalizedDoc` | `src/core` |
| `src/extract` | Lectores (Anthropic, caché, simulado) y verificación de lecturas → `ReadingAssessment` | `src/core`, `@anthropic-ai/sdk` |
| `src/store` | Drizzle (PGlite en local / Neon en producción) y repositorios | `src/core` |
| `src/pipeline` | Orquesta ingest → extract → engine → guard → store | todo lo anterior |
| `src/app` | Pantalla y API (Next.js App Router) | `src/pipeline`, `src/store`, `src/core` |
| `eval/` | Banco de pruebas | `src/*` |
| `dataset/` | Empresa ficticia, casos etiquetados, generador de facturas | — |

`src/engine` y `src/guard` no pueden importar `@anthropic-ai/sdk`, `drizzle-orm`, `next`, ni nada de E/S.

## Comandos

- `npm run test` — todas las pruebas (Vitest). Para un módulo: `npx vitest run src/engine`.
- `npm run typecheck` — `tsc --noEmit`.
- `npm run dataset:generate` — genera las facturas de `dataset/generated/` a partir de `dataset/specs/`.
- `npm run eval` — banco de pruebas con lector simulado (sin costo). `npm run eval -- --reader=live` usa la API de Anthropic (necesita `ANTHROPIC_API_KEY`, cuesta dinero).
- `npm run dev` — servidor local (usa PGlite en `.data/` si no hay `DATABASE_URL`).

## Convenciones

- Texto visible para usuarios: **español**. Identificadores de código: inglés.
- Montos: compara en centavos (`toCents`). Las tasas de cambio son fijas y vienen de `rules.fxToUsd`.
- Fechas: ISO 8601. Periodos: `YYYY-MM`.
- Modelos: lectura principal `claude-sonnet-5-5`, segunda lectura `claude-haiku-5-5`, ambos con esfuerzo `low`.
- No agregues dependencias sin necesidad; si lo haces, usa `npm i` (hay `.npmrc` con `legacy-peer-deps`).

## Terminado significa

`npm run typecheck` y `npm run test` en verde, y `npm run eval` con **0 pagos indebidos** y sin bajar la autonomía.
