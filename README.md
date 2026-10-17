# Centinela · agente que decide qué facturas pagar

Prototipo para el **reto Blinka** del hackathon **30X**. Centinela lee facturas (PDF, foto, correo o chat), decide si **pagarlas, frenarlas o escalarlas a una persona** según las reglas de la empresa, y deja un registro que cualquiera puede entender sin abrir el código. No mueve dinero.

## Cómo decide

1. **Lee dos veces.** Dos modelos distintos (Claude Sonnet 5.5 y Claude Haiku 5.5) extraen los datos de la factura por separado. Cada dato viene con la cita literal del documento.
2. **Verifica la lectura sin modelo.** Comprueba que las dos lecturas coincidan, que las cuentas cuadren, que las citas existan en el documento y busca instrucciones escondidas («ya aprobado por el CFO», texto blanco en un PDF…).
3. **Decide con lógica fija.** Un motor de reglas puro evalúa 15 comprobaciones: lectura, duplicados, proveedor y cuenta registrada, acuerdo (moneda, monto, vigencia), umbral de aprobación, límite mensual y fondo. Solo paga si se cumplen todas.
4. **Revisa cada pago dos veces.** Una «guardia», escrita por separado, vuelve a comprobar los límites duros antes de registrar un pago. Si no está de acuerdo, la factura se escala.
5. **Registra y explica.** Cada decisión guarda el porqué (frases con los valores concretos), las dos lecturas, la copia de las reglas usadas y las versiones.

**El modelo nunca decide.** Solo lee. Por eso una instrucción escondida en una factura no puede aprobar un pago.

Más detalle en [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). Las comprobaciones están en [src/core/checks.ts](src/core/checks.ts).

## Probar en local

Requiere Node 20.18+ (recomendado 22).

```bash
npm install
```

```bash
npm run dev
```

Abre http://localhost:3000 y pulsa **Probar con ejemplos → Reproducir escenario base**. Sin variables de entorno funciona en **modo simulado**: las facturas de ejemplo se «leen» con su lectura perfecta del set de datos (sirve para probar la lógica sin costo). Para leer cualquier factura con modelos reales, crea `.env.local` con `ANTHROPIC_API_KEY` (ver [.env.example](.env.example)).

## Banco de pruebas

41 facturas de una empresa ficticia (Andes Labs Inc.), con casos normales y trampa, en [dataset/casos.csv](dataset/casos.csv). 13 de ellas forman un set reservado que no se usó para ajustar nada.

**Resultado con Claude real** (Sonnet 5.5 + Haiku 5.5, 17 de octubre de 2026): **40 de 41 correctas, 0 pagos indebidos, 13 de 13 en el set reservado**. Costo de la corrida completa: USD 0,84 (unos 2 centavos por factura). El único fallo fue una escalada de más: en un chat, una lectura incluyó la letra del tipo de comprobante en el número de factura («E 0003-00000871») y la otra no; al no coincidir, el agente escaló en vez de pagar. Reporte completo: [eval/reports/live.md](eval/reports/live.md).

```bash
npm run eval:live
```

Lee las 41 facturas con los modelos reales (necesita `ANTHROPIC_API_KEY`) y escribe `eval/reports/latest.md`. Falla si hay un solo pago indebido.

```bash
npm run eval
```

La misma evaluación con lectura simulada (los datos exactos de cada factura): prueba la lógica de decisión sin costo. Es la que corre la CI.

## Pruebas

```bash
npm run test
```

Pruebas unitarias y de propiedades (fast-check). Entre otras: «si el motor dice PAGAR, se cumplen las 15 comprobaciones» y «si el motor dice PAGAR, la guardia independiente también lo aprueba».

## Desplegar (costo USD 0)

1. Sube el repositorio a GitHub. La CI ([.github/workflows/ci.yml](.github/workflows/ci.yml)) corre tipos, lint, pruebas, banco de pruebas y build.
2. Crea una base gratuita en [Neon](https://neon.tech) y copia su `DATABASE_URL`.
3. Importa el repositorio en [Vercel](https://vercel.com) (plan Hobby) y configura las variables:
   - `DATABASE_URL`: la de Neon.
   - `DEMO_ACCESS_CODE`: un código para que solo el jurado use la demo (cada factura nueva cuesta lectura).
   - `ANTHROPIC_API_KEY`: para lectura real. Sin ella, la demo queda en modo simulado.
4. Despliega. Las tablas se crean solas en el primer uso.

## Estructura

| Carpeta | Qué hace |
|---|---|
| `src/core` | Contratos: esquemas, catálogo de comprobaciones, normalización |
| `src/ingest` | Convierte PDF, imagen, correo o chat en un documento normalizado |
| `src/extract` | Lectores (Anthropic, caché, simulado) y verificación de lecturas |
| `src/engine` | Motor de reglas (función pura) |
| `src/guard` | Guardia independiente de pagos |
| `src/store` | Base de datos (PGlite en local, Neon en producción) |
| `src/pipeline` | Orquesta todo, una factura a la vez |
| `src/app` | Pantallas y API (Next.js) |
| `eval/` | Banco de pruebas |
| `dataset/` | Empresa ficticia, casos etiquetados y generador de facturas |

Lo que falta y requiere al equipo: [docs/PENDIENTES.md](docs/PENDIENTES.md). Guion del video: [docs/DEMO.md](docs/DEMO.md).

Construido con Claude Code. Ningún dato real de clientes ni de empresas.
