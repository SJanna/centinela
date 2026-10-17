# Contrato de la API (Next.js route handlers)

Todas las respuestas son JSON salvo las de archivo. Los errores son `{ "error": "<mensaje en español>" }` con código 4xx/5xx. Runtime Node (`export const runtime = "nodejs"`), sin caché (`export const dynamic = "force-dynamic"`).

Tipos: `DecisionSummary`, `Stats` vienen de `src/store/repo.ts`; `DecisionRecord`, `Company`, `Rules`, `Vendor` de `src/core/schemas.ts`.

| Método y ruta | Entrada | Respuesta |
|---|---|---|
| `POST /api/invoices` | `multipart/form-data` con campo `file` | `{ decision: DecisionSummary, recordId: string }`. Procesa en el momento; las facturas se procesan de a una (candado en el proceso). |
| `GET /api/decisions?limit=N` | — | `{ decisions: DecisionSummary[] }` (más recientes primero) |
| `GET /api/decisions/[id]` | — | `{ record: DecisionRecord }` |
| `GET /api/invoices/[id]/file` | — | Bytes del archivo original con su `Content-Type`, `Content-Disposition: inline` |
| `GET /api/invoices/[id]/preview` | — | `{ kind: DocKind, mediaType: string, filename: string, plainText: string \| null, meta: Record<string,string> }` (vuelve a normalizar el archivo guardado) |
| `GET /api/stats` | — | `Stats` (usa la fecha actual) |
| `GET /api/company` | — | `{ company: Company }` |
| `PUT /api/company/rules` | `Rules` | `{ company: Company }` |
| `PUT /api/company/vendors` | `Vendor[]` (reemplaza todos; importación) | `{ company: Company }` |
| `POST /api/company/vendors` | `Vendor` (crea o actualiza) | `{ company: Company }` |
| `DELETE /api/company/vendors/[id]` | — | `{ company: Company }` |
| `POST /api/demo/reset` | — | Borra facturas y decisiones y carga `dataset/company.json`. `{ company: Company }` |
| `GET /api/samples` | — | `{ samples: { caseId, filename, formato, descripcion, split, escenario, decision_esperada }[] }` desde `dataset/casos.csv` + `dataset/generated/manifest.json` |
| `GET /api/samples/[caseId]` | — | Bytes del archivo de ejemplo |
| `GET /api/export?format=json\|csv` | — | Descarga del registro completo (`DecisionRecord[]` en JSON, o resumen en CSV) |
| `GET /api/status` | — | `{ readingMode: "live" \| "simulated", models: string[], promptVersion: string, accessProtected: boolean, companyName: string }` |
| `POST /api/access` | `{ code: string }` | Si coincide con `DEMO_ACCESS_CODE`, pone la cookie de acceso. `{ ok: true }` o 401. |

## Acceso a la demo

Si existe la variable `DEMO_ACCESS_CODE`, `src/proxy.ts` exige la cookie `centinela_access`: las páginas redirigen a `/acceso` y las rutas `/api/*` (salvo `/api/access` y `/api/status`) responden 401. Sin la variable, todo queda abierto (desarrollo local).

## Modo de lectura

`READING_MODE` = `live` | `simulated` | `auto` (por defecto `auto`: `live` si hay `ANTHROPIC_API_KEY`, si no `simulated`). En `live` los lectores se envuelven con la caché de la base (`createDbReadingCache`). En `simulated` se usa `dataset/generated/manifest.json`: solo los archivos del set de ejemplo tienen lectura; cualquier otro archivo escala por LEC-1.
