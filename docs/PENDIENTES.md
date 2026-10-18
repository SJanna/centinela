# Lo que necesita intervención del equipo

En orden de prioridad.

## 18 oct · escenario base de 120 facturas (rama `base-100`)

El escenario base pasó de 23 a 120 facturas (B24–B120: atraso de julio a septiembre y cierre de octubre) y `company.json` sube el límite del mes a USD 150.000 y el fondo a USD 250.000, con 26 proveedores nuevos. Mezcla: 82 PAGAR (68 %), 12 FRENAR (10 %), 26 ESCALAR (22 %). Detalle en [ARCHITECTURE.md](ARCHITECTURE.md#escenario-base-ampliado-b24b120).

- **Revisión humana de las 97 etiquetas nuevas** (invariante 5): son un borrador, como las demás.
- **Medir las 97 con lectura real** antes de decir «0 pagos indebidos» sobre 120 o 138 casos: `npm run eval:live -- --concurrency=4 --out=live-economico-v6-138` (unos USD 0,30 más; las 41 ya leídas salen de la caché). Las más expuestas a la lectura: B29 y B103 (imágenes sin texto: dependen de que una lectura diga `receipt` u `other`), B91 (destinatario), B86 («rn» → «m»), B107 («$» en un chat) y B97 (foto muy borrosa: la escala la nitidez, sin modelo).
- **Para quien lleva DEMO, PITCH y el guion del video** (esta rama no los toca): «Reproducir escenario base» ahora reproduce 120 facturas, unos 3 minutos como mínimo (1,47 s por factura en la pantalla, más subida y lectura); el límite del mes es USD 150.000 y el fondo USD 250.000; «0 pagos indebidos en 23 casos» medido con Claude real sigue valiendo para el set de 41, no para el escenario de 120.
- **B23 ya no cita el límite del mes.** Con el límite en USD 150.000, B23 (factura sin datos bancarios, USD 7.200) sigue en ESCALAR con LEC-1, pero ya no falla LIM-2 y su resumen deja de decir «Dentro del límite del mes». Es el único cambio entre las 41 de antes (en `eval` y en `eval:cache`), consecuencia de subir el límite; ni DEMO, ni PITCH ni el guion lo mencionan.
- **Tablero con 120 tarjetas, sin probar en el navegador.** Al terminar «Reproducir escenario base» la columna Pagadas tiene 82 tarjetas animadas (`motion.li` con `layout`), sin límite ni virtualización (`src/components/dashboard/board.tsx`). Hay que reproducirlo una vez en modo simulado; si se traba, mostrar las primeras ~20 y «y N más».
- **Fechas.** La pantalla decide con el reloj de la máquina, no con el «now» del escenario (`/api/invoices` no lo pasa). Por eso ninguna factura nueva se emite después del 16 de octubre (como las de antes) y ninguna trampa nueva depende de la fecha de hoy: la factura de un mes que todavía no empieza del plan original se cambió por una de enero, anterior al contrato (B81).

## Noche del 17 al 18 de octubre: endurecimiento (resumen)

Todo en commits locales en `main`, sin push. Prompts actuales: `v6`/`v6b`. Detalle de cada ataque en [REDTEAM.md](REDTEAM.md).

| Qué | Antes | Ahora |
|---|---|---|
| Factura dirigida a otra empresa (LOG-11) | se pagaba | ACU-1 y la guardia comparan el destinatario con `company.buyer` (la base lo guarda) |
| Documento anulado, borrador, proforma o nota crédito (ronda 2) | con `v5` se pagaron una proforma de octubre y una foto con marca de agua BORRADOR | detector en el texto y en las notas de las lecturas (`voidDocumentMarkers`), `v6` los clasifica como `other`, guardia |
| «$» de un proveedor argentino o chileno leído como USD | dependía del modelo | ACU-2 y la guardia comparan con el país del proveedor (`currencyOnlyDollarSign`) |
| Factura del mes anterior sin periodo escrito (DUP-B) | con `v6` se pagaba dos veces octubre | si la factura menciona un mes anterior ya pagado, DUP-3 escala; se imputa al mes que dice |
| Límite del mes y fondo entre instancias de Vercel | dependían de un candado por proceso | la base inserta un PAGAR solo si no entró otro pago mientras se decidía (comprobado contra Postgres 15) |

Medido (lectura real, `economico`, `v6`): 41/41 y 13/13 en el reservado; muestra de 100 del estrés 98/100; equipo rojo 0 pagos en 42 ataques; 0 pagos indebidos en todo. Gasto real de la noche: unos USD 1,2.

**Quedan abiertos (documentados):**
- En imágenes, las reglas de moneda, sellos y «mes anterior» dependen de lo que las lecturas transcriben o anotan.
- Una factura del mes anterior sin periodo y sin ninguna mención («servicios profesionales», emitida el 5 de noviembre) se imputa a noviembre: así la etiqueta el dataset (S1925). Si octubre ya se pagó, el monto vuelve a pagarse solo si nada en la factura dice que es de octubre.
- Un XML de factura electrónica (CFDI, DIAN) se lee como texto, pero suele no traer la cuenta bancaria: escala por dato faltante.
- Las etiquetas del dataset siguen siendo el borrador de Claude (punto 2).

## Perfil económico y estrés (17 y 18 oct)

**18 oct · prompts `v5`/`v5b` (destinatario de la factura), medido con Claude real.**
- No hubo ningún pago indebido.
- El set de 41 sigue perfecto.
- En la muestra de 100, las escaladas de más bajan de 3 a 1.
- LOG-11, la factura dirigida a otra empresa, ahora escala por ACU-1. Ninguno de los 28 ataques del equipo rojo se paga: 25 escalan y 3 se frenan (detalle en [REDTEAM.md](REDTEAM.md#medición-con-claude-real-prompts-v5v5b-2026-10-18)).
- Se gastaron USD 0,56 de un tope de USD 1,20.

| Corrida (lectura real, `economico`) | Aciertos | Pagos indebidos | Escaladas de más | Costo |
|---|---:|---:|---:|---:|
| 41 casos · `v4`/`v4b` | 41/41 (13/13 en el set reservado) | 0 | 0 de 24 | USD 0,09 |
| 41 casos · **`v5`/`v5b`** | **41/41** (13/13) | **0** | **0 de 24** | USD 0,11 |
| Muestra de 100 (semilla 17) · `v4` | 97/100 | 0 de 68 | 3 de 46 | USD 0,25 |
| Muestra de 100 (semilla 17) · **`v5`** | **99/100** | **0 de 68** | **1 de 44** | USD 0,30 |
| Los mismos 100 de la muestra `v4`, leídos con **`v5`** | 99/100 | 0 de 68 | 1 de 46 | +USD 0,07 (23 casos) |
| Equipo rojo: inyección, visual y lógica (28 ataques) · `v4` → **`v5`** | — | 1 (LOG-11) → **0** | — | USD 0,08 |

**Por qué hay dos filas de la muestra.**
- La misma semilla ya no da la misma muestra. El set de estrés cambió: 20 trampas `proveedor_parecido` pasaron a ser `otra_empresa`.
- Con la semilla 17 coinciden 77 casos y cambian 23. Ninguno de los 23 es legítimo: las 32 legítimas son las mismas.
- Para comparar con la muestra `v4` exacta, se leyeron aparte los 23 que salieron de ella. Entre ellos están los dos frágiles de `v4`, S0768 y S0922, y escalan.

**Qué cambió con `v5` en la muestra**
- En 75 de los 77 casos comunes fallan las mismas comprobaciones que con `v4`. Los otros dos ahora pagan, como debían:
  - S1581: el lector «b» ya no marca la cuenta como ilegible.
  - S1831: el lector «a» ya no toma el alias como proveedor.
- La única escalada de más es S0784, que ya pasaba con `v3` y `v4`. Ninguna lectura trae horas ni tarifa, así que ACU-3 queda sin datos.
- Las dos `otra_empresa` de la muestra escalan solo por ACU-1:
  - S1804, un correo dirigido a «Andes Labs Colombia S.A.S.».
  - S1922, un chat dirigido a «Brightwave Analytics LLC».
- **Destinatario.** Se compararon las 246 lecturas de los 123 casos con la etiqueta del dataset:
  - 190 traen el destinatario correcto y 56 lo dejan vacío donde el documento no lo dice.
  - No hay ninguno inventado, omitido ni distinto.
  - En el set de 41 pasa lo mismo: 68 correctos y 14 vacíos.
- **Para vigilar.** Ninguno de estos casos cambia una decisión hoy:
  - El lector «b» sigue marcando cuentas como ilegibles cuando duda del formato. Pasó en S0433 (CLABE de 20 dígitos) y en S1673 (campo «Agência/Conta»). Las dos escalaban igual, pero es el patrón que antes dio S1581 y S1029 de más.
  - En S0922 (total borroso), las dos lecturas ponen MXN 86.400 con la cita «Total $86,400.00 MXN». Lo detienen dos cosas: el lector «a» marca el total ilegible y las notas de los dos dicen que «Amount due» está borroso (`totalDoubtedInNotes`). El hueco conocido sigue.
  - En S0861, el lector «b» marcó como ilegible el EIN del destinatario. Esa sola marca deja ACU-1 sin evaluar y, en una factura legítima, escalaría de más. Pasó en 1 de 246 lecturas.
- **Costo.** Cada factura cuesta USD 0,0030 con `v5`, frente a 0,0025 con `v4` (+16 %, por los campos nuevos). Las 2000 costarían unos USD 6,4.

**17 oct · `v4`/`v4b`. Resuelto y medido con Claude real.** Los 6 pagos indebidos del set de estrés (5 recibos y 1 foto con el total borroso) ya no se pagan con el perfil `economico` (Haiku en las dos lecturas, por defecto). El set de 41 sigue perfecto y la muestra de 100 no pierde autonomía. El arreglo tiene tres partes:
- un detector de documento ya pagado, en código (`src/extract/paid-markers.ts`), que lleva a LEC-1 y a la guardia;
- la regla del total en fotos (`totalNotConfirmedByQuote` y `totalDoubtedInNotes`);
- los prompts `v4`/`v4b`.

Queda por decidir si se corren las 2000 (unos USD 5,5).

| Corrida (lectura real, `economico`) | Aciertos | Pagos indebidos | Escaladas de más | Costo |
|---|---:|---:|---:|---:|
| 41 casos · antes (`v3`/`v3b`) | 41/41 | 0 | 0 de 24 | USD 0,09 |
| 41 casos · **ahora (`v4`/`v4b`)** | **41/41** (13/13 en el set reservado) | **0** | **0 de 24** | USD 0,09 |
| Muestra estratificada de 100 (semilla 17) · antes | 95/100 | 2 | 3 de 46 | USD 0,26 |
| Muestra estratificada de 100 · **ahora** | **97/100** | **0** | **3 de 46** | USD 0,25 |
| Los 61 recibos y totales borrosos · antes | 44/61 | 6 | 0 de 9 | USD 0,18 |
| Los 61 recibos y totales borrosos · **ahora** | **61/61** | **0** | **0 de 9** | USD 0,19 |

Con el perfil `calidad` (Sonnet + Haiku) se pagaban 3 de esos 6. Con el código nuevo, repitiendo las lecturas `v3` guardadas, los 6 escalan. Con `v4` no se midió en vivo.

**Cómo se detienen ahora (los 61)**
- **Recibos (27).** Con `v4`/`v4b` las dos lecturas dicen `receipt` en 25 de 27; antes era en 5. Las dos excepciones:
  - S0488, un correo titulado «Recibo de pago A-505»: las dos lecturas dijeron `invoice`. Lo detuvo solo el detector de texto, con 3 marcas.
  - S0768: solo una lectura dijo `receipt`, y el detector también lo marcó.

  Los 5 recibos en imagen, que no tienen texto para el detector, los clasificaron como `receipt` las dos lecturas.
- **Total borroso (34).** En 33 las dos lecturas marcan el total como ilegible. El caso que queda es S0922:
  - El lector «a» lo marcó ilegible.
  - El lector «b» puso MXN 86.400 con una cita inventada, «Total $86,400.00 MXN». Es justo el hueco conocido de la regla de la cita.
  - Su propia nota dice que «Amount due» está borroso, así que `totalDoubtedInNotes` lo detiene igual.

  Lo detuvieron dos defensas independientes. Si las dos lecturas inventaran la etiqueta y ninguna anotara la duda, se pagaría.

**Escaladas de más en la muestra (3 de 46, todas por lectura)**

Las tres son del mismo tipo que antes. Ninguna viene del detector de pagado ni de la regla del total.
- S0784, foto de cuenta de cobro: ninguna lectura trae horas ni tarifa, así que ACU-3 queda sin datos. Ya pasaba antes.
- S1581, correo en el cuerpo: el lector «b» (`v4b`) marca la cuenta como ilegible y LEC-1 escala. Antes le pasaba lo mismo a S1029.
- S1831, foto saas: el lector «a» toma el alias «CR Dev» como proveedor y LEC-2 escala. Antes era el «b».

Las 11 fotos legítimas de la muestra ahora citan el total con su etiqueta («TOTAL A PAGAR COP 12.000.000», «Total a cobrar …») y pasan. Con las lecturas `v3` guardadas, la regla del total habría escalado 6 de ellas.

**Costo**
- Por factura, con `economico`: USD 0,0026 (0,0032 en fotos).
- Las 2000 costarían unos USD 5,5, ponderando por formato. Reutilizando las 157 ya leídas con `v4`, unos USD 5,1. Con `calidad`, unos USD 41.
- En esta medición se gastaron USD 0,54: 0,19 + 0,25 + 0,09.

**Pendiente**
- Decidir si se corren las 2000 (`npm run eval:stress:live`): unos USD 6,4 con `v5`. Hasta ahora hay 123 leídas con `v5`.
- Los 61 recibos y totales borrosos no se midieron con `v5` (unos USD 0,22).
- `calidad` con `v4` y con `v5`, sin medir en vivo. Al repetir las lecturas `v3` guardadas daba 38/41: B04 y B21 escalaban de más porque Sonnet citó solo el monto.
- `src/components/invoice/trace.ts` no muestra la señal `paidDocumentMarkers`.
- `docs/ARCHITECTURE.md` (regla del total) todavía dice «Falta medir con v4/v4b».

**Cómo correrlo** (el perfil sale de `--profile` o de `READER_PROFILE`; por defecto `economico`):

```bash
npm run eval                                          # 41 casos, simulado, sin costo
npm run eval:stress                                   # 2000 casos, simulado, ~6 s
npm run eval:live -- --concurrency=4 --out=live-economico-v5         # 41 casos con Claude, ~USD 0,11
npm run eval:stress:live -- --sample=100 --out=stress-live-economico-muestra100-v5   # piloto de 100, ~USD 0,30
npm run eval:stress:live -- --case=<los 61> --sample=61 --out=stress-live-economico-recibos-borrosos-v5   # ~USD 0,22
npm run eval:stress:live                              # las 2000, ~USD 6,4
npx tsx redteam/run.ts --dir redteam/attacks/logica --budget-usd 0.15   # una carpeta del equipo rojo, ~USD 0,02-0,04
npm run eval:live -- --profile=calidad --out=live-calidad
```

La lista de los 61 está en `caseFilter` de `eval/reports/stress-live-economico-recibos-borrosos.json`. Con `--sample`, el historial de cada escenario se arma con la lectura simulada, sin costo. Las lecturas quedan en caché (`dataset/reading-cache` y `dataset/stress/reading-cache`), así que repetir una corrida no cuesta.

**Reportes** en `eval/reports/` (en cada fallo, el reporte muestra qué leyó cada lector):

| Corrida | Ahora (`v5`/`v5b`) | `v4`/`v4b` | `v3`/`v3b` |
|---|---|---|---|
| 41 casos | `live-economico-v5.md` | `live-economico-v4.md` | `live-economico.md` |
| Muestra de 100 | `stress-live-economico-muestra100-v5.md` (y los 23 de la muestra `v4` que no entran: `stress-live-economico-muestra100-v4-restantes-v5.md`) | `stress-live-economico-muestra100-v4.md` | `stress-live-economico-muestra100.md` |
| Los 61 recibos y totales borrosos | — | `stress-live-economico-recibos-borrosos-v4.md` | `stress-live-economico-recibos-borrosos.md` |
| Los 6 pagos indebidos · `calidad` | — | — | `stress-live-calidad-indebidos.md` |

## 1. ~~Clave de Anthropic y evaluación con lectura real~~ (hecho el 17 de octubre)

`npm run eval:live`: 40 de 41 correctas, 0 pagos indebidos, 13 de 13 en el set reservado, USD 0,84. Reporte en [eval/reports/live.md](../eval/reports/live.md). La primera corrida destapó que la API rechazaba el esquema de salida (más de 16 campos opcionales); se corrigió con el formato de cable de `src/extract/wire.ts`.

Mejora opcional: B05 escala de más porque una lectura incluye la letra del tipo de comprobante argentino («E 0003-00000871») en el número de factura. Se arregla aclarándolo en el prompt (`src/extract/prompt.ts`, subir a v4) y volviendo a correr `eval:live` (~USD 0,85).

## 2. Revisar las etiquetas y «lo acordado»

- `dataset/casos.csv` y `dataset/company.json` los escribió Claude como borrador. Deben revisarlos personas: son la verdad contra la que se mide el agente.
- La definición de «lo acordado» (acuerdo por proveedor con tipo, monto o tarifa, moneda, frecuencia, vigencia y cuenta registrada) sigue siendo un supuesto. Conviene confirmarla con el jurado.
- Pregunta abierta para el jurado: ¿qué formato tendrá su set de facturas, y traerá sus propias reglas y proveedores? La pantalla Proveedores importa JSON y la de Reglas edita todo, pero conviene saberlo antes.

## 3. Desplegar

Pasos en el [README](../README.md#desplegar-costo-usd-0): GitHub → Neon → Vercel con `DATABASE_URL`, `DEMO_ACCESS_CODE` y `ANTHROPIC_API_KEY`. Claude no subió nada a GitHub ni desplegó: son acciones públicas que te tocan a ti.

Después de desplegar:
- Entra con el código, pulsa **Reiniciar demo** y **Probar con ejemplos → Reproducir escenario base**.
- Sube una factura propia (foto o PDF) para comprobar la lectura real en producción.

## 4. Grabar el video

Guion en [docs/DEMO.md](DEMO.md). Graba sobre la versión desplegada (en local aparece el indicador «N» de Next en modo desarrollo).

## 5. Ajustes acordados para retomar (revisión del reto, 17 de octubre)

**Fecha límite: 18 de octubre** (la hora exacta está dentro de HackRadar). El formulario exige tres enlaces: repositorio público en GitHub (listo), URL de la demo y video.

Veredicto de la revisión: el proyecto cumple el reto y cuenta como agente, pero hoy se presenta como «motor de reglas». Ajustes, en orden:

1. **Contarlo como agente (1–2 h, sin riesgo).**
   - README y [DEMO.md](DEMO.md) con el ciclo **percibe → decide → se revisa → registra → pide permiso**.
   - Una sola cifra de autonomía: «decidió sola 23 de 41 (todas correctas) y escaló 18: 17 a propósito y 1 de más» (con Claude real). Hecho en README, DEMO y PITCH el 17 de octubre.
   - Corregir en el README que las etiquetas «las fijan personas»: las redactó Claude y falta revisarlas.
   - Cambiar bancos y códigos SWIFT/ABA de `dataset/company.json` por ficticios.
2. **Cerrar el ciclo de permiso (3–5 h).**
   - Aprobar y Rechazar en lo escalado, con nombre y motivo.
   - Cada respuesta es un registro nuevo encadenado a la decisión original, y cuenta para el fondo y el límite del mes.
   - Solo se puede autorizar lo que se puede escalar (umbral, proveedor nuevo, cambio de cuenta); nunca un duplicado ni un pago sin fondo. La guardia vuelve a revisar.
3. **Opcional: mostrar al agente trabajando (3–4 h).** La traza paso a paso aparece en vivo mientras procesa.

**No hacer:** un orquestador de Claude con herramientas antes de la entrega. No dejar que el modelo toque la decisión.

**Frase para el pitch:** «Centinela lee cada factura como una persona, pero paga como un contador: un modelo entiende el documento y la política de la empresa decide. Ninguna factura, por convincente que sea, puede convencerlo de pagar algo que las reglas no permiten. Cuando algo se sale de ellas, le pide permiso a una persona y explica por qué.»

## 6. Reglas dinámicas (descrito, para después de la entrega)

**Por qué:** el reto pide «reglas configurables, **como** límites por pago y por periodo, beneficiarios permitidos y aprobación humana por encima de cierto monto». Hoy la empresa edita valores, pero no puede crear reglas. Además:
- El enunciado separa «límite por pago» de «aprobación humana sobre cierto monto», y hoy solo existe el umbral que escala (LIM-1). Falta un **tope duro por pago** que frene siempre.
- Los equipos pueden compartir facturas «junto con las reglas de pago de una empresa ficticia»: el jurado podría traer reglas que hoy no se pueden expresar.

**Diseño propuesto:** un catálogo de tipos de regla que la empresa activa y parametriza desde `/reglas`. No son reglas libres ni código: todo sigue siendo determinista y explicable.

| Tipo | Ejemplo | Efecto |
|---|---|---|
| Tope por pago | Nunca pagar más de USD 20.000 en una factura | Frena |
| Límite por proveedor | No más de USD 6.000 al mes a Estudio Nopal | Escala |
| Aprobación por país o moneda | Todo pago en BRL pasa por una persona | Escala |
| Proveedor bloqueado | No pagar a Imprenta Viejo Roble | Frena |
| Factura vencida o adelantada | Escalar si venció hace más de 60 días | Escala |

**Reglas de seguridad del diseño:**
- Las reglas nuevas **solo restringen** (frenan o escalan); nunca autorizan un pago.
- Las 15 comprobaciones base siguen siempre activas.
- Cada regla aparece en el detalle de la factura con su explicación, igual que las actuales, y queda copiada en el registro de cada decisión.
- La guardia revisa al menos las que frenan.

**Opcional encima:** la empresa escribe la regla en lenguaje natural; Claude la traduce a un tipo del catálogo, la muestra estructurada y una persona la aprueba antes de activarla. El modelo propone la regla; no decide pagos.

**Esfuerzo estimado:** tope por pago solo, ~1 h · catálogo de 4–5 tipos con pantalla y pruebas, 3–5 h · lenguaje natural encima, +2 h.

## 7. Capas de confiabilidad ajustadas a Blinka (investigación del 17 de octubre)

**Qué hace Blinka y qué no** (fuentes: blinka.co, su OpenAPI v2.0.0, docs.blinka.co y la documentación de Mural Pay, su socio de pagos):
- Ya cubre: identidad del cliente (Persona), formato del destino por riel, aprobación humana de beneficiarios nuevos (un método de pago creado por API queda `pending` hasta que una persona lo aprueba; no se puede editar, se archiva y se crea otro).
- Tiene un servidor MCP en acceso anticipado que **redacta borradores de transferencias, no las ejecuta** (alcances `blinka:read`, `blinka:transfers:draft`).
- La API solo muestra los últimos 4 dígitos de las cuentas.
- No tiene cuentas por pagar ni lectura de facturas de proveedores. **Nadie en su stack verifica que una factura corresponda a una obligación real**: esa es la capa de Centinela.
- ACH, wire y USDC no se revierten, y Mural deja al cliente como responsable de las «instrucciones incorrectas».

**Orden ajustado por importancia para Blinka:**

| # | Capa | Estado | Esfuerzo | Dataset |
|---|---|---|---|---|
| 1 | Ficha del proveedor + cuenta registrada (PRV-2) | Ya está | — | — |
| 2 | Destino por riel (ABA+cuenta, CLABE, llave Pix, CBU/CVU/alias+CUIT, CCI, IBAN, cadena+wallet USDC) en vez de un número genérico | Falta | 4–6 h | Cambia |
| 3 | Duplicados con índices únicos | Ya está | — | — |
| 4 | Clave de idempotencia derivada del duplicado, en el detalle, el CSV y el JSON exportado (para quien ejecute el pago) | **Hecho** (17 oct) | — | No |
| 5 | Acuerdo, monto, umbral, límite y fondo | Ya está | — | — |
| 6 | Límite de 30 días móviles (Mural retiene por volumen de 30 días) | Falta | 1–2 h | No |
| 7 | Dos lecturas, citas, aritmética, instrucciones escondidas | Ya está | — | — |
| 8 | Dígitos de control por riel (ABA, CLABE, IBAN, CPF/CNPJ, NIT, RUT, CBU/CVU, CUIT, EIP-55) | Falta | 2–3 h | **Cambia: hoy fallan 9 de 11 proveedores** |
| 9 | Ruta disponible por moneda y país (no hay ruta local en USD a CO, AR ni CL) | Falta | ~1 h | No |
| 10 | Entidad pagadora (clientes con muchas entidades) | Falta | 2–3 h + `eval:live` | Cambia |
| 11 | Paquete de soporte para pagos retenidos (factura con nombre, monto y descripción) | Parcial | 1–2 h | No |
| 12 | Coincidencia del titular cuando el riel la ofrece (p. ej. Pix con CNPJ) | Falta; la consulta la hace el riel, fuera del reto | ~1 h simulado | No |
| 13 | Factura electrónica XML/QR y consulta al SAT | Falta; baja de prioridad (ningún XML/QR trae la cuenta) | Medio | Cambia |

**Fuera del reto:** ejecutar pagos, crear métodos de pago, verificar identidad (KYB), calificar algo como fraude.

**Para el pitch:** «Una cuenta en dólares resuelve cómo pagarle a un proveedor en Latinoamérica; Centinela responde si esa factura se debe pagar. La compara con lo acordado, con lo ya pagado y con la cuenta registrada, y deja escrito el porqué.» No prometer integración con Blinka: no existe.

## Riesgos conocidos (decisiones conscientes, documentadas)

- ~~**Límite mensual y fondo entre instancias de Vercel.**~~ Cerrado: la base solo inserta un PAGAR si el registro tiene los mismos pagos que el historial con que se decidió (candado de transacción + inserción condicional). Ver [ARCHITECTURE.md](ARCHITECTURE.md#pago-doble-entre-instancias).
- **«Reiniciar demo» borra el registro.** Es una función de demo. Después de reiniciar, la misma factura se puede volver a pagar.
- **Autonomía en el escenario base: 78 %.** Con 120 facturas, 94 se deciden solas (82 se pagan y 12 se frenan) y 26 son trampas que deben escalarse. Con las 23 de antes era 52 %.
- **Texto extraído de títulos con letras espaciadas** sale unido («TOTALAPAGAR») en la pestaña «Texto extraído». No afecta decisiones.
