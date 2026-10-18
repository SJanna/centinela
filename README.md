# Centinela · agente que decide qué facturas pagar

Prototipo para el **reto Blinka** del hackathon **30X**. Centinela es un agente que recibe facturas de proveedores (PDF, foto, correo o chat) y entrega una decisión con su porqué: **pagar, frenar o escalar a una persona**. No mueve dinero.

## Dónde encaja

Una cuenta en dólares resuelve cómo pagarle a un proveedor en Latinoamérica. Centinela responde si esa factura se debe pagar: la compara con lo acordado, con lo ya pagado y con la cuenta registrada, y deja escrito el porqué.

Centinela entrega una decisión, no un pago. No está integrado con Blinka ni con ningún banco.

## Cómo trabaja el agente

1. **Percibe.** Lee cada factura dos veces con Claude, por separado y con dos instrucciones distintas (Haiku 5.5 dos veces por defecto; Sonnet 5.5 y Haiku 5.5 con el perfil `calidad`). Cada dato trae la cita literal del documento. Después, código sin IA comprueba que las dos lecturas coincidan, que las sumas cuadren, que los datos leídos aparezcan en el texto del documento (cuando lo trae; en una foto no se puede) y que no haya instrucciones escondidas («ya aprobado por el CFO», texto blanco en un PDF…).
2. **Decide.** Aplica la política de la empresa: 15 comprobaciones en código fijo. Lectura, duplicados, proveedor y cuenta registrada (beneficiario permitido), acuerdo (moneda, monto, vigencia), umbral de aprobación, límite del mes y fondo. Solo paga si se cumplen todas. Esa política es el motor de reglas de `src/engine`.
3. **Se revisa.** Antes de registrar una decisión de pagar, una guardia escrita aparte, que no usa el código del motor, vuelve a comprobar los límites duros. Si no está de acuerdo, la factura se escala.
4. **Registra.** Cada decisión queda en un registro que la base no deja modificar: el porqué en frases con los valores concretos, las dos lecturas, la copia de las reglas usadas y las versiones.
5. **Pide permiso.** Lo que se sale de la política va a una persona con la acción sugerida. Por ejemplo: «Confirmar el cambio de cuenta con el proveedor por un canal conocido, no por el que llegó la factura.»

**El modelo lee; no decide.** Ninguna salida de un modelo elige el resultado. Es la garantía de confianza que pide el punto 04 del reto: una factura, por convincente que sea, no puede convencer al agente de pagar algo que la política no permite.

Más detalle en [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). Las comprobaciones están en [src/core/checks.ts](src/core/checks.ts).

## Resultados

138 facturas de prueba realistas de una empresa ficticia (Andes Labs Inc.), con casos normales y trampas, en [dataset/casos.csv](dataset/casos.csv). 13 forman un set reservado para medir. No es una medición a ciegas: varias pruebas automáticas también usan esos casos. Además, un set de estrés de 2.000 facturas generadas (formatos, idiomas y trampas variadas) y un equipo rojo de 42 ataques.

El escenario base tiene 120 facturas: el cierre de octubre con el atraso de julio a septiembre (B24–B120 se sumaron a B01–B23). Se pagan 82 (68 %), se frenan 12 por duplicado (10 %) y escalan 26 trampas (22 %); lo pagado suma USD 128.081,90 del límite del mes de USD 150.000. Las 97 facturas nuevas son, como el resto, un borrador sin revisión humana, y **todavía no se midieron con lecturas reales**: con el lector simulado dan 138 de 138.

Con Claude real, perfil por defecto (Haiku 5.5 dos veces, prompts `v6`/`v6b`, 18 de octubre de 2026). Estas cifras son del set de 41 casos (B01–B23 y los otros escenarios), medido antes de ampliar el escenario base:

| Qué | Resultado |
|---|---|
| Decisiones correctas (41) | 41 de 41 (IC 95 %: 91–100 %, Clopper-Pearson) · set reservado 13 de 13 |
| Pagos indebidos (41) | 0. De las 23 facturas que no debían pagarse, no pagó ninguna. |
| Autonomía (41) | Pagó o frenó sola las 24 que debía decidir sola; escaló las 17 trampas que piden una persona. |
| Muestra de 100 del set de estrés | 98 de 100, 0 pagos indebidos en 68 trampas, 2 escaladas de más (una foto donde las dos lecturas no coinciden y una cuenta de cobro sin horas legibles) |
| Errores honestos | 17 fotos y descuidos reales (foto girada, cortada, con reflejo, de una pantalla, por WhatsApp; sellos tenues, periodo borroso de un mes ya pagado, factura reenviada): con `economico` 0 pagos indebidos y las 8 legítimas pagan. Con `calidad` se pagaba un periodo borroso ya pagado; quedó cerrado en código ([docs/REDTEAM.md](docs/REDTEAM.md)). |
| Equipo rojo | 42 ataques (instrucciones escondidas, engaño visual, lógica de pagos, documentos que no son un cobro): 0 pagados. Los 7 que lograron un pago en alguna versión (3 correos con instrucciones o adjuntos que la lectura no veía, una factura dirigida a otra empresa, una proforma, una foto con marca de agua «BORRADOR» y una factura del mes anterior sin periodo escrito) quedaron cerrados en código, con prueba ([docs/REDTEAM.md](docs/REDTEAM.md)). |
| Costo de lectura | unos USD 0,003 por factura (USD 0,11 las 41) |
| Pruebas automáticas | 2.304 (Vitest y fast-check), más los bancos de pruebas simulados: 138 de 138 y 2.000 de 2.000 |

Con 23 + 68 trampas leídas con Claude real, «0 pagos indebidos» no prueba que la tasa sea cero: con 95 % de confianza, la real podría llegar a ~3 % (regla de tres: 3 ÷ 91). Por eso existen la guardia y el escalado, y por eso lo que los dos lectores pueden confundir a la vez se revisa en código sin IA (documento ya pagado o anulado, moneda escrita solo con «$», destinatario de la factura, mes que la factura no dice).

Reportes: [eval/reports/live-economico-v6.md](eval/reports/live-economico-v6.md) (41, lectura en vivo), [eval/reports/stress-live-economico-muestra100-v6.md](eval/reports/stress-live-economico-muestra100-v6.md) (muestra de 100 en vivo) y [eval/reports/stress-cache-economico-muestra100-v6.md](eval/reports/stress-cache-economico-muestra100-v6.md) (las mismas lecturas decididas con el código final).

## Límites conocidos

- **Las etiquetas no están revisadas por personas.** [dataset/casos.csv](dataset/casos.csv) y [dataset/company.json](dataset/company.json) los redactó Claude como borrador. Son la verdad contra la que se mide el agente y falta que una persona los revise.
- **Las dos lecturas son de Claude.** Con el perfil por defecto son el mismo modelo (Haiku 5.5) con dos prompts distintos; con `READER_PROFILE=calidad`, Sonnet 5.5 y Haiku 5.5. Pueden equivocarse igual. Por eso monto, cuenta, acuerdo, destinatario y duplicados los revisa después código sin IA contra la ficha del proveedor y el historial.
- **En una imagen no hay texto que revisar sin modelo.** Ahí algunas reglas (moneda escrita solo con «$», sellos de anulado o borrador, «mes anterior») dependen de lo que las dos lecturas transcriben o anotan. Si las dos se equivocan igual y no lo anotan, la regla no lo ve; la cuenta, el monto y el acuerdo se siguen comparando con la ficha.
- **Una foto borrosa nunca se paga sola, pero la medida es global.** La entrada mide la nitidez sin IA (fotos, fotos adjuntas y las 3 primeras páginas de un PDF escaneado) y, por debajo de 120, una persona pide una copia legible. Un dato borroso en una foto nítida (solo el total, solo el periodo) no baja la medida: ahí cuentan lo que las lecturas marcan como ilegible o anotan (total y periodo). El umbral está calibrado con fotos sintéticas del set de estrés; falta probarlo con fotos reales de celular. No se mide un PDF escaneado con capa de texto (OCR) ni sus páginas después de la 3.
- **Dos modelos distintos no se equivocan menos igual.** En la ronda de errores honestos, Sonnet y Haiku dejaron los dos vacío el mismo periodo borroso (lo cierra una regla en código) y el perfil `calidad` cuesta unas 9 veces más por foto. Se recomienda leer con `economico` ([docs/REDTEAM.md](docs/REDTEAM.md)).
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

Lee las 41 facturas con Claude (necesita `ANTHROPIC_API_KEY`) y escribe `eval/reports/latest.md`. Falla si hay un solo pago indebido. Con el perfil por defecto (`economico`) la corrida completa cuesta unos USD 0,11 (con `READER_PROFILE=calidad`, unos USD 0,84); las lecturas quedan en caché (`dataset/reading-cache`) y repetirlas no cuesta.

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
