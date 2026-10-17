# Lo que necesita intervención del equipo

En orden de prioridad.

## Perfil económico y estrés (17 oct)

**Resuelto y medido con Claude real.** Los 6 pagos indebidos del set de estrés (5 recibos y 1 foto con el total borroso) ya no se pagan con el perfil `economico` (Haiku en las dos lecturas, por defecto). El set de 41 sigue perfecto y la muestra de 100 no pierde autonomía. El arreglo tiene tres partes:
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
- Decidir si se corren las 2000 (`npm run eval:stress:live`, unos USD 5,5).
- `calidad` con `v4`, sin medir en vivo. Al repetir las lecturas `v3` guardadas daba 38/41: B04 y B21 escalaban de más porque Sonnet citó solo el monto.
- `src/components/invoice/trace.ts` no muestra la señal `paidDocumentMarkers`.
- `docs/ARCHITECTURE.md` (regla del total) todavía dice «Falta medir con v4/v4b».

**Cómo correrlo** (el perfil sale de `--profile` o de `READER_PROFILE`; por defecto `economico`):

```bash
npm run eval                                          # 41 casos, simulado, sin costo
npm run eval:stress                                   # 2000 casos, simulado, ~6 s
npm run eval:live -- --concurrency=4 --out=live-economico-v4         # 41 casos con Claude, ~USD 0,10
npm run eval:stress:live -- --sample=100 --out=stress-live-economico-muestra100-v4   # piloto de 100, ~USD 0,25
npm run eval:stress:live -- --case=<los 61> --sample=61 --out=stress-live-economico-recibos-borrosos-v4   # ~USD 0,19
npm run eval:stress:live                              # las 2000, ~USD 5,5
npm run eval:live -- --profile=calidad --out=live-calidad
```

La lista de los 61 está en `caseFilter` de `eval/reports/stress-live-economico-recibos-borrosos.json`. Con `--sample`, el historial de cada escenario se arma con la lectura simulada, sin costo. Las lecturas quedan en caché (`dataset/reading-cache` y `dataset/stress/reading-cache`), así que repetir una corrida no cuesta.

**Reportes** en `eval/reports/` (en cada fallo, el reporte muestra qué leyó cada lector):

| Corrida | Ahora (`v4`/`v4b`) | Antes (`v3`/`v3b`) |
|---|---|---|
| 41 casos | `live-economico-v4.md` | `live-economico.md` |
| Muestra de 100 | `stress-live-economico-muestra100-v4.md` | `stress-live-economico-muestra100.md` |
| Los 61 recibos y totales borrosos | `stress-live-economico-recibos-borrosos-v4.md` | `stress-live-economico-recibos-borrosos.md` |
| Los 6 pagos indebidos · `calidad` | — | `stress-live-calidad-indebidos.md` |

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

- **Límite mensual y fondo entre instancias de Vercel.** Los duplicados están protegidos en la base con índices únicos. El límite del mes y el fondo dependen de un candado por proceso: dos personas subiendo a la vez en dos instancias distintas podrían, en teoría, pasarse del límite. La interfaz sube de a una factura. Ver [ARCHITECTURE.md](ARCHITECTURE.md#pago-doble-entre-instancias).
- **«Reiniciar demo» borra el registro.** Es una función de demo. Después de reiniciar, la misma factura se puede volver a pagar.
- **Autonomía en el escenario base: 52 %.** Es baja a propósito: 11 de las 23 facturas son trampas que deben escalarse. El escenario «reservado» y facturas normales adicionales la suben. Si quieren que el video muestre más autonomía, agreguen casos normales al set.
- **Texto extraído de títulos con letras espaciadas** sale unido («TOTALAPAGAR») en la pestaña «Texto extraído». No afecta decisiones.
