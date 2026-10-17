# Centinela · agente que decide qué facturas pagar

Prototipo para el **reto Blinka** del hackathon **30X**. Centinela es un agente que recibe facturas de proveedores (PDF, foto, correo o chat) y entrega una decisión con su porqué: **pagar, frenar o escalar a una persona**. No mueve dinero.

## Dónde encaja

Una cuenta en dólares resuelve cómo pagarle a un proveedor en Latinoamérica. Centinela responde si esa factura se debe pagar: la compara con lo acordado, con lo ya pagado y con la cuenta registrada, y deja escrito el porqué.

Centinela entrega una decisión, no un pago. No está integrado con Blinka ni con ningún banco.

## Cómo trabaja el agente

1. **Percibe.** Lee cada factura dos veces con Claude (Sonnet 5.5 y Haiku 5.5, por separado). Cada dato trae la cita literal del documento. Después, código sin IA comprueba que las dos lecturas coincidan, que las sumas cuadren, que los datos leídos aparezcan en el texto del documento (cuando lo trae; en una foto no se puede) y que no haya instrucciones escondidas («ya aprobado por el CFO», texto blanco en un PDF…).
2. **Decide.** Aplica la política de la empresa: 15 comprobaciones en código fijo. Lectura, duplicados, proveedor y cuenta registrada (beneficiario permitido), acuerdo (moneda, monto, vigencia), umbral de aprobación, límite del mes y fondo. Solo paga si se cumplen todas. Esa política es el motor de reglas de `src/engine`.
3. **Se revisa.** Antes de registrar una decisión de pagar, una guardia escrita aparte, que no usa el código del motor, vuelve a comprobar los límites duros. Si no está de acuerdo, la factura se escala.
4. **Registra.** Cada decisión queda en un registro que la base no deja modificar: el porqué en frases con los valores concretos, las dos lecturas, la copia de las reglas usadas y las versiones.
5. **Pide permiso.** Lo que se sale de la política va a una persona con la acción sugerida. Por ejemplo: «Confirmar el cambio de cuenta con el proveedor por un canal conocido, no por el que llegó la factura.»

**El modelo lee; no decide.** Ninguna salida de un modelo elige el resultado. Es la garantía de confianza que pide el punto 04 del reto: una factura, por convincente que sea, no puede convencer al agente de pagar algo que la política no permite.

Más detalle en [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). Las comprobaciones están en [src/core/checks.ts](src/core/checks.ts).

## Resultados

41 facturas de prueba realistas de una empresa ficticia (Andes Labs Inc.), con casos normales y trampas, en [dataset/casos.csv](dataset/casos.csv). 13 forman un set reservado para medir. No es una medición a ciegas: varias pruebas automáticas también usan esos casos.

Con Claude real (Sonnet 5.5 + Haiku 5.5, 17 de octubre de 2026):

| Qué | Resultado |
|---|---|
| Decisiones correctas | 40 de 41 (IC 95 %: 87–99,9 %, Clopper-Pearson) |
| Pagos indebidos | 0. De las 23 facturas que no debían pagarse, no pagó ninguna. |
| Set reservado | 13 de 13 |
| Autonomía | Decidió sola 23 de 41 (todas correctas) y escaló 18: 17 a propósito y 1 de más. |
| Costo de lectura | USD 0,84 por las 41 (unos 2 centavos por factura) |
| Pruebas automáticas | Más de 1.100 (Vitest y fast-check) |

Con 23 casos, «0 pagos indebidos» no prueba que la tasa sea cero: con 95 % de confianza, la real podría llegar a ~13 % (regla de tres: 3 ÷ 23). Por eso existen la guardia y el escalado.

El único fallo fue una escalada de más (B05). En un chat, una lectura incluyó la letra del tipo de comprobante en el número de factura («E 0003-00000871») y la otra no. Al no coincidir, el agente escaló en vez de pagar. Reporte completo: [eval/reports/live.md](eval/reports/live.md).

## Límites conocidos

- **Las etiquetas no están revisadas por personas.** [dataset/casos.csv](dataset/casos.csv) y [dataset/company.json](dataset/company.json) los redactó Claude como borrador. Son la verdad contra la que se mide el agente y falta que una persona los revise.
- **Las dos lecturas son de Claude.** Son dos modelos distintos, ambos de Anthropic, y pueden equivocarse igual. Por eso monto, cuenta y acuerdo los revisa después código sin IA contra la ficha del proveedor.
- **Detectar instrucciones escondidas no es infalible.** El detector usa patrones y la lectura del modelo. Si una instrucción pasa sin detectarse, no puede saltarse la política. Lo más que puede hacer es torcer una lectura, y aun así la cuenta, el monto y el acuerdo se comparan con la ficha del proveedor.
- **No consulta a ninguna autoridad tributaria** (DIAN, SAT u otras) ni valida dígitos de control de cuentas o identificaciones.
- **La aprobación humana aún no se registra en la app.** Lo escalado muestra la acción sugerida; los botones Aprobar y Rechazar están pendientes.
- **«Reiniciar demo» borra todo el registro.** La base no deja editar ni borrar una decisión, pero el reinicio vacía las tablas. Es una función de demo.

Lo que falta: [docs/PENDIENTES.md](docs/PENDIENTES.md).

## Probar en local

Requiere Node 20.18+ (recomendado 22).

```bash
npm install
```

```bash
npm run dev
```

Abre http://localhost:3000 y pulsa **Probar con ejemplos → Reproducir escenario base**. Sin variables de entorno funciona en **modo simulado**: las facturas de ejemplo se «leen» con su lectura perfecta del set de datos. Sirve para probar la política sin costo; no mide la lectura. Para leer cualquier factura con Claude, crea `.env.local` con `ANTHROPIC_API_KEY` (ver [.env.example](.env.example)).

## Banco de pruebas

```bash
npm run eval:live
```

Lee las 41 facturas con Claude (necesita `ANTHROPIC_API_KEY`) y escribe `eval/reports/latest.md`. Falla si hay un solo pago indebido. La corrida completa costó USD 0,84; las lecturas quedan en caché (`dataset/reading-cache`) y repetirlas no cuesta.

```bash
npm run eval
```

La misma evaluación con lectura simulada (los datos exactos de cada factura). Prueba la política sin costo. Es la que corre la CI.

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
| `src/extract` | Percibe: lectores (Anthropic, caché, simulado) y verificación de lecturas |
| `src/engine` | Decide: la política de la empresa (función pura, sin modelo) |
| `src/guard` | Se revisa: guardia independiente de pagos |
| `src/store` | Registra: base de datos (PGlite en local, Neon en producción) |
| `src/pipeline` | Orquesta el ciclo, una factura a la vez |
| `src/app` | Pantallas y API (Next.js) |
| `eval/` | Banco de pruebas |
| `dataset/` | Empresa ficticia, casos etiquetados y generador de facturas |

Guion del video: [docs/DEMO.md](docs/DEMO.md). Pitch y preguntas del jurado: [docs/PITCH.md](docs/PITCH.md).

Construido con Claude Code. La empresa, los proveedores, los números de cuenta y las facturas son ficticios.
