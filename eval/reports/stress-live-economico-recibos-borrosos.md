# Banco de pruebas · set de estrés

- Fecha: 2026-10-17T21:48:07.253Z
- Lector: en vivo (API de Anthropic, con caché)
- Modelos: claude-haiku-5-5 · versión del prompt: v3 + v3b
- Perfil de lectura: economico · lector-a: claude-haiku-5-5 (prompt v3) · lector-b: claude-haiku-5-5 (prompt v3b)
- Casos: 61 (muestra estratificada por trampa y formato, semilla 17) · split: all · escenarios en paralelo: 4
- Procesados solo como historial (no cuentan): 991 (con lectura simulada)
- Intervalos: Clopper-Pearson al 95 % entre corchetes. La etiqueta de cada factura sale de su receta (dataset/stress/plan.ts), no del motor.

## Resumen

| Métrica | Valor |
|---|---:|
| Aciertos | 44/61 · 72,1 % [59,2–82,9] |
| Pagos indebidos (sobre las que no se debían pagar) | 6/61 · 9,8 % [3,7–20,2] |
| Escaladas de más (sobre PAGAR/FRENAR esperados) | 0/9 · 0,0 % [0,0–33,6] |
| Frenos de más (sobre las que no debían frenarse) | 0/52 · 0,0 % [0,0–6,8] |
| Autonomía (PAGAR/FRENAR resueltos sin escalar) | 4/9 · 44,4 % [13,7–78,8] |
| Tokens (entrada / salida) | 781085 / 200544 |
| Costo estimado | USD 0.1784 (USD 0.00292 por factura) |

## Matriz de confusión (filas: esperado; columnas: obtenido)

| Esperado | PAGAR | FRENAR | ESCALAR | ERROR |
|---|---:|---:|---:|---:|
| PAGAR | 0 | 0 | 0 | 0 |
| FRENAR | 0 | 9 | 0 | 0 |
| ESCALAR | 6 | 0 | 46 | 0 |

## Por trampa (una factura con varias trampas cuenta en cada una)

| Grupo | Casos | Aciertos | Pagos indebidos | Escaladas de más | Frenos de más | Autonomía | Costo (USD) |
|---|---:|---:|---:|---:|---:|---:|---:|
| Total ilegible en foto (`total_borroso`) | 34 | 33/34 · 97,1 % [84,7–99,9] | 1/34 · 2,9 % [0,1–15,3] | — | 0/34 · 0,0 % [0,0–10,3] | — | 0.1026 |
| Recibo (no es factura) (`recibo`) | 27 | 11/27 · 40,7 % [22,4–61,2] | 5/27 · 18,5 % [6,3–38,1] | 0/9 · 0,0 % [0,0–33,6] | 0/18 · 0,0 % [0,0–18,5] | 4/9 · 44,4 % [13,7–78,8] | 0.0757 |
| Mismo número en otro formato (`duplicado_numero`) | 9 | 4/9 · 44,4 % [13,7–78,8] | 0/9 · 0,0 % [0,0–33,6] | 0/9 · 0,0 % [0,0–33,6] | — | 4/9 · 44,4 % [13,7–78,8] | 0.0232 |
| Mismo periodo con otro número (`duplicado_periodo`) | 9 | 4/9 · 44,4 % [13,7–78,8] | 0/9 · 0,0 % [0,0–33,6] | 0/9 · 0,0 % [0,0–33,6] | — | 4/9 · 44,4 % [13,7–78,8] | 0.0232 |
| Instrucciones escondidas (`instruccion_escondida`) | 5 | 5/5 · 100,0 % [47,8–100,0] | 0/5 · 0,0 % [0,0–52,2] | — | 0/5 · 0,0 % [0,0–52,2] | — | 0.0151 |
| Sobre el umbral (`sobre_umbral`) | 2 | 0/2 · 0,0 % [0,0–84,2] | 0/2 · 0,0 % [0,0–84,2] | — | 0/2 · 0,0 % [0,0–84,2] | — | 0.0057 |

## Por formato

| Grupo | Casos | Aciertos | Pagos indebidos | Escaladas de más | Frenos de más | Autonomía | Costo (USD) |
|---|---:|---:|---:|---:|---:|---:|---:|
| jpg | 36 | 35/36 · 97,2 % [85,5–99,9] | 1/36 · 2,8 % [0,1–14,5] | — | 0/36 · 0,0 % [0,0–9,7] | — | 0.1093 |
| pdf | 12 | 4/12 · 33,3 % [9,9–65,1] | 1/12 · 8,3 % [0,2–38,5] | 0/6 · 0,0 % [0,0–45,9] | 0/6 · 0,0 % [0,0–45,9] | 3/6 · 50,0 % [11,8–88,2] | 0.0337 |
| eml | 10 | 2/10 · 20,0 % [2,5–55,6] | 4/10 · 40,0 % [12,2–73,8] | 0/3 · 0,0 % [0,0–70,8] | 0/7 · 0,0 % [0,0–41,0] | 1/3 · 33,3 % [0,8–90,6] | 0.0266 |
| png | 3 | 3/3 · 100,0 % [29,2–100,0] | 0/3 · 0,0 % [0,0–70,8] | — | 0/3 · 0,0 % [0,0–70,8] | — | 0.0088 |

## Por presentación

| Grupo | Casos | Aciertos | Pagos indebidos | Escaladas de más | Frenos de más | Autonomía | Costo (USD) |
|---|---:|---:|---:|---:|---:|---:|---:|
| latam | 25 | 25/25 · 100,0 % [86,3–100,0] | 0/25 · 0,0 % [0,0–13,7] | 0/2 · 0,0 % [0,0–84,2] | 0/23 · 0,0 % [0,0–14,8] | 2/2 · 100,0 % [15,8–100,0] | 0.0760 |
| saas | 20 | 11/20 · 55,0 % [31,5–76,9] | 2/20 · 10,0 % [1,2–31,7] | 0/3 · 0,0 % [0,0–70,8] | 0/17 · 0,0 % [0,0–19,5] | 0/3 · 0,0 % [0,0–70,8] | 0.0592 |
| correo_cuerpo | 5 | 1/5 · 20,0 % [0,5–71,6] | 3/5 · 60,0 % [14,7–94,7] | 0/1 · 0,0 % [0,0–97,5] | 0/4 · 0,0 % [0,0–60,2] | 1/1 · 100,0 % [2,5–100,0] | 0.0102 |
| cuenta_cobro | 5 | 5/5 · 100,0 % [47,8–100,0] | 0/5 · 0,0 % [0,0–52,2] | — | 0/5 · 0,0 % [0,0–52,2] | — | 0.0167 |
| correo+adjunto_saas | 3 | 0/3 · 0,0 % [0,0–70,8] | 1/3 · 33,3 % [0,8–90,6] | 0/2 · 0,0 % [0,0–84,2] | 0/1 · 0,0 % [0,0–97,5] | 0/2 · 0,0 % [0,0–84,2] | 0.0094 |
| correo+adjunto_latam | 2 | 1/2 · 50,0 % [1,3–98,7] | 0/2 · 0,0 % [0,0–84,2] | — | 0/2 · 0,0 % [0,0–84,2] | — | 0.0070 |
| nota_servico | 1 | 1/1 · 100,0 % [2,5–100,0] | 0/1 · 0,0 % [0,0–97,5] | 0/1 · 0,0 % [0,0–97,5] | — | 1/1 · 100,0 % [2,5–100,0] | 0.0000 |

## Por idioma

| Grupo | Casos | Aciertos | Pagos indebidos | Escaladas de más | Frenos de más | Autonomía | Costo (USD) |
|---|---:|---:|---:|---:|---:|---:|---:|
| es | 38 | 32/38 · 84,2 % [68,7–94,0] | 3/38 · 7,9 % [1,7–21,4] | 0/4 · 0,0 % [0,0–60,2] | 0/34 · 0,0 % [0,0–10,3] | 3/4 · 75,0 % [19,4–99,4] | 0.1136 |
| en | 22 | 11/22 · 50,0 % [28,2–71,8] | 3/22 · 13,6 % [2,9–34,9] | 0/4 · 0,0 % [0,0–60,2] | 0/18 · 0,0 % [0,0–18,5] | 0/4 · 0,0 % [0,0–60,2] | 0.0648 |
| pt | 1 | 1/1 · 100,0 % [2,5–100,0] | 0/1 · 0,0 % [0,0–97,5] | 0/1 · 0,0 % [0,0–97,5] | — | 1/1 · 100,0 % [2,5–100,0] | 0.0000 |

## Por dificultad

| Grupo | Casos | Aciertos | Pagos indebidos | Escaladas de más | Frenos de más | Autonomía | Costo (USD) |
|---|---:|---:|---:|---:|---:|---:|---:|
| media | 56 | 39/56 · 69,6 % [55,9–81,2] | 6/56 · 10,7 % [4,0–21,9] | 0/9 · 0,0 % [0,0–33,6] | 0/47 · 0,0 % [0,0–7,5] | 4/9 · 44,4 % [13,7–78,8] | 0.1629 |
| alta | 5 | 5/5 · 100,0 % [47,8–100,0] | 0/5 · 0,0 % [0,0–52,2] | — | 0/5 · 0,0 % [0,0–52,2] | — | 0.0155 |

## Por decisión esperada

| Grupo | Casos | Aciertos | Pagos indebidos | Escaladas de más | Frenos de más | Autonomía | Costo (USD) |
|---|---:|---:|---:|---:|---:|---:|---:|
| ESCALAR | 52 | 40/52 · 76,9 % [63,2–87,5] | 6/52 · 11,5 % [4,4–23,4] | — | 0/52 · 0,0 % [0,0–6,8] | — | 0.1551 |
| FRENAR | 9 | 4/9 · 44,4 % [13,7–78,8] | 0/9 · 0,0 % [0,0–33,6] | 0/9 · 0,0 % [0,0–33,6] | — | 4/9 · 44,4 % [13,7–78,8] | 0.0232 |

## Por tipo de escenario

| Grupo | Casos | Aciertos | Pagos indebidos | Escaladas de más | Frenos de más | Autonomía | Costo (USD) |
|---|---:|---:|---:|---:|---:|---:|---:|
| volumen | 44 | 32/44 · 72,7 % [57,2–85,0] | 6/44 · 13,6 % [5,2–27,4] | 0/6 · 0,0 % [0,0–45,9] | 0/38 · 0,0 % [0,0–9,3] | 2/6 · 33,3 % [4,3–77,7] | 0.1250 |
| fondo-bajo | 4 | 4/4 · 100,0 % [39,8–100,0] | 0/4 · 0,0 % [0,0–60,2] | — | 0/4 · 0,0 % [0,0–60,2] | — | 0.0141 |
| limite-bajo | 4 | 3/4 · 75,0 % [19,4–99,4] | 0/4 · 0,0 % [0,0–60,2] | — | 0/4 · 0,0 % [0,0–60,2] | — | 0.0120 |
| tolerancia-0 | 4 | 2/4 · 50,0 % [6,8–93,2] | 0/4 · 0,0 % [0,0–60,2] | 0/3 · 0,0 % [0,0–70,8] | 0/1 · 0,0 % [0,0–97,5] | 2/3 · 66,7 % [9,4–99,2] | 0.0114 |
| umbral-bajo | 3 | 2/3 · 66,7 % [9,4–99,2] | 0/3 · 0,0 % [0,0–70,8] | — | 0/3 · 0,0 % [0,0–70,8] | — | 0.0092 |
| reglas-base | 2 | 1/2 · 50,0 % [1,3–98,7] | 0/2 · 0,0 % [0,0–84,2] | — | 0/2 · 0,0 % [0,0–84,2] | — | 0.0068 |

## Consumo por modelo

Precios usados (USD por millón de tokens, entrada / salida): claude-sonnet-5-5 2 / 10 · claude-haiku-5-5 0.1 / 0.5.

| Modelo | Tokens de entrada | Tokens de salida | Costo estimado |
|---|---:|---:|---:|
| claude-haiku-5-5 | 781085 | 200544 | USD 0.1784 |

| Lector | Modelo · prompt | Tokens de entrada | Tokens de salida | Costo estimado |
|---|---|---:|---:|---:|
| lector-a | claude-haiku-5-5 · v3 | 379228 | 93109 | USD 0.0845 |
| lector-b | claude-haiku-5-5 · v3b | 401857 | 107435 | USD 0.0939 |

## Fallos por tipo

- **6** · recibo: esperado ESCALAR, obtenido ESCALAR · faltan LEC-1 · p. ej. S0019, S0064, S0189, S0334, S1368, S1456
- **5** · recibo: esperado ESCALAR, obtenido PAGAR · faltan LEC-1 · p. ej. S0030, S0488, S0768, S0916, S1086
- **5** · recibo: esperado FRENAR, obtenido FRENAR · faltan LEC-1 · p. ej. S0551, S0600, S1175, S1301, S1710
- **1** · total_borroso: esperado ESCALAR, obtenido PAGAR · faltan LEC-1 · p. ej. S0922

## Detalle de fallos

- **S0019** (e01-volumen, pdf, saas, recibo+sobre_umbral) · Recibo de pago (no es una factura) de Datos del Sur SpA · PDF saas · USD 5.205,00 · esperado ESCALAR [LEC-1, LIM-1], obtenido ESCALAR [LIM-1] · resumen: Se escala a una persona: no cumple «Bajo el umbral de aprobación».
  - lector-a (claude-haiku-5-5, v3): tipo invoice · proveedor «Datos del Sur SpA» · n.º 1401 · emisión 2026-08-07 · periodo 2026-08 · USD 5205 (subtotal 5205, impuesto ∅) · cuenta 00-123-45678-09 en BANCO DE CHILE (BCHICLRM) · instrucciones: 0
  - lector-b (claude-haiku-5-5, v3b): tipo invoice · proveedor «Datos del Sur SpA» · n.º 1401 · emisión 2026-08-07 · periodo 2026-08 · USD 5205 (subtotal 5205, impuesto ∅) · cuenta 00-123-45678-09 en BANCO DE CHILE (BCHICLRM) · instrucciones: 0
- **S0030** (e01-volumen, eml, correo_cuerpo, recibo) · Recibo de pago (no es una factura) de CloudMetrics · correo_cuerpo · USD 1.200,00 · esperado ESCALAR [LEC-1], obtenido PAGAR [—] · PAGO INDEBIDO · resumen: Se paga a CloudMetrics Inc.: USD 1.200,00. Cumple las 15 comprobaciones.
  - lector-a (claude-haiku-5-5, v3): tipo invoice · proveedor «CloudMetrics» · n.º CM-INV-2026-1004 · emisión 2026-09-08 · periodo 2026-08 · USD 1200 (subtotal 1200, impuesto 0) · cuenta 3300198822 en Silicon Valley Bank (121140399) · instrucciones: 0
  - lector-b (claude-haiku-5-5, v3b): tipo invoice · proveedor «CloudMetrics» · n.º CM-INV-2026-1004 · emisión 2026-09-08 · periodo 2026-08 · USD 1200 (subtotal 1200, impuesto 0) · cuenta 3300198822 en Silicon Valley Bank (121140399) · ilegible: issueDate · instrucciones: 0
- **S0064** (e02-umbral-bajo, eml, correo_cuerpo, recibo+sobre_umbral) · Recibo de pago (no es una factura) de Datos del Sur · correo_cuerpo · USD 3.300,00 · esperado ESCALAR [LEC-1, LIM-1], obtenido ESCALAR [LIM-1] · resumen: Se escala a una persona: no cumple «Bajo el umbral de aprobación».
  - lector-a (claude-haiku-5-5, v3): tipo invoice · proveedor «Datos del Sur» · n.º 1417 · emisión 2026-11-06 · periodo ∅ · USD 3300 (subtotal 3300, impuesto 0) · cuenta 00-123-45678-09 en BANCO DE CHILE (BCHICLRMXXX) · instrucciones: 0
  - lector-b (claude-haiku-5-5, v3b): tipo invoice · proveedor «Datos del Sur» · n.º 1417 · emisión 2026-11-06 · periodo ∅ · USD 3300 (subtotal 3300, impuesto 0) · cuenta 00-123-45678-09 en BANCO DE CHILE (BCHICLRMXXX) · instrucciones: 0
- **S0189** (e04-reglas-base, eml, correo+adjunto_latam, recibo) · Recibo de pago (no es una factura) de Pampa Ops · correo+adjunto_latam · USD 2.800,00 · esperado ESCALAR [LEC-1], obtenido ESCALAR [LEC-4] · resumen: Se escala a una persona: no cumple «Sin instrucciones escondidas».
  - lector-a (claude-haiku-5-5, v3): tipo invoice · proveedor «Pampa Ops» · n.º 0003-00000944 · emisión 2026-07-07 · periodo 2026-07 · USD 2800 (subtotal 2800, impuesto ∅) · cuenta 0070999030004123456789 en Banco Galicia (GABAARBA) · instrucciones: 1
  - lector-b (claude-haiku-5-5, v3b): tipo invoice · proveedor «Pampa Ops» · n.º 0003-00000944 · emisión 2026-07-07 · periodo 2026-07 · USD 2800 (subtotal 2800, impuesto ∅) · cuenta 0070999030004123456789 en Banco Galicia (GABAARBA) · instrucciones: 0
  - señales: instrucciones detectadas: 1 (model)
- **S0334** (e07-tolerancia-0, pdf, saas, recibo) · Recibo de pago (no es una factura) de Estudio Nopal S. de R.L. · PDF saas · $41.400,00 MXN · esperado ESCALAR [LEC-1], obtenido ESCALAR [LEC-4] · resumen: Se escala a una persona: no cumple «Sin instrucciones escondidas».
  - lector-a (claude-haiku-5-5, v3): tipo invoice · proveedor «Estudio Nopal S. de R.L.» · n.º A-480 · emisión 2026-09-06 · periodo 2026-09 · MXN 41400 (subtotal 41400, impuesto 0) · cuenta 012180001234567891 en BBVA México (BCMRMXMM) · instrucciones: 0
  - lector-b (claude-haiku-5-5, v3b): tipo invoice · proveedor «Estudio Nopal S. de R.L.» · n.º A-480 · emisión 2026-09-06 · periodo 2026-09 · MXN 41400 (subtotal 41400, impuesto 0) · cuenta 012180001234567891 en BBVA México (BCMRMXMM) · instrucciones: 1
  - señales: instrucciones detectadas: 1 (model)
- **S0488** (e10-volumen, eml, correo_cuerpo, recibo) · Recibo de pago (no es una factura) de Estudio Nopal S. de R.L. · correo_cuerpo · $65.925,00 MXN · esperado ESCALAR [LEC-1], obtenido PAGAR [—] · PAGO INDEBIDO · resumen: Se paga a Estudio Nopal S. de R.L.: MXN 65.925,00 (≈ USD 3.625,88). Cumple las 15 comprobaciones.
  - lector-a (claude-haiku-5-5, v3): tipo invoice · proveedor «Estudio Nopal S. de R.L.» · n.º A-505 · emisión 2026-10-07 · periodo 2026-10 · MXN 65925 (subtotal 65925, impuesto 0) · cuenta 012180001234567891 en BBVA México (BCMRMXMM) · instrucciones: 0
  - lector-b (claude-haiku-5-5, v3b): tipo invoice · proveedor «Estudio Nopal S. de R.L.» · n.º A-505 · emisión 2026-10-07 · periodo 2026-10 · MXN 65925 (subtotal 65925, impuesto 0) · cuenta 012180001234567891 en BBVA México (BCMRMXMM) · instrucciones: 0
- **S0551** (e12-tolerancia-0, eml, correo+adjunto_saas, recibo+duplicado_numero+duplicado_periodo) · Recibo del pago de S0549 (0003-00001017, ya pagada) · correo+adjunto_saas · esperado FRENAR [LEC-1, DUP-2, DUP-3], obtenido FRENAR [LEC-4, DUP-2, DUP-3] · resumen: Se frena: ya se pagó una factura de Pampa Ops SRL con el número 0003-00001017 (factura e12-tolerancia-0/S0549, 20 de octubre de 2026).
  - lector-a (claude-haiku-5-5, v3): tipo invoice · proveedor «Pampa Ops SRL» · n.º 0003-00001017 · emisión 2026-10-14 · periodo 2026-10 · USD 2800 (subtotal 2800, impuesto ∅) · cuenta 007 099 903 000 412 345 678 9 en Banco Galicia (GABAARBA) · instrucciones: 0
  - lector-b (claude-haiku-5-5, v3b): tipo invoice · proveedor «Pampa Ops SRL» · n.º 0003-00001017 · emisión 2026-10-14 · periodo 2026-10 · USD 2800 (subtotal 2800, impuesto ∅) · cuenta 007 099 903 000 412 345 678 9 en Banco Galicia (GABAARBA) · instrucciones: 1
  - señales: instrucciones detectadas: 1 (model)
- **S0600** (e13-volumen, eml, correo+adjunto_saas, recibo+duplicado_numero+duplicado_periodo) · Recibo del pago de S0599 (CM-INV-2026-1140, ya pagada) · correo+adjunto_saas · esperado FRENAR [LEC-1, DUP-2, DUP-3], obtenido FRENAR [DUP-2, DUP-3] · resumen: Se frena: ya se pagó una factura de CloudMetrics Inc. con el número CM-INV-2026-1140 (factura e13-volumen/S0599, 20 de octubre de 2026).
  - lector-a (claude-haiku-5-5, v3): tipo invoice · proveedor «CloudMetrics» · n.º CM-INV-2026-1140 · emisión 2026-10-20 · periodo 2026-10 · USD 1200 (subtotal 1200, impuesto 0) · cuenta 3300-1988-22 en Silicon Valley Bank (121140399) · instrucciones: 0
  - lector-b (claude-haiku-5-5, v3b): tipo invoice · proveedor «CloudMetrics» · n.º CM-INV-2026-1140 · emisión 2026-10-20 · periodo 2026-10 · USD 1200 (subtotal 1200, impuesto 0) · cuenta 3300-1988-22 en Silicon Valley Bank (121140399) · instrucciones: 0
- **S0768** (e16-volumen, eml, correo_cuerpo, recibo) · Recibo de pago (no es una factura) de Soporte Caribe · correo_cuerpo · COP 1.080.000 · esperado ESCALAR [LEC-1], obtenido PAGAR [—] · PAGO INDEBIDO · resumen: Se paga a Soporte Caribe S.A.S.: COP 1.080.000,00 (≈ USD 270,00). Cumple las 15 comprobaciones.
  - lector-a (claude-haiku-5-5, v3): tipo invoice · proveedor «Soporte Caribe» · n.º SC-2488 · emisión 2026-11-02 · periodo 2026-10 · COP 1080000 (subtotal 1080000, impuesto 0) · cuenta 0550-4881-2233 en Banco Davivienda (CAFECOBB) · instrucciones: 0
  - lector-b (claude-haiku-5-5, v3b): tipo invoice · proveedor «Soporte Caribe» · n.º SC-2488 · emisión 2026-11-02 · periodo 2026-10 · COP 1080000 (subtotal 1080000, impuesto 0) · cuenta 0550-4881-2233 en Banco Davivienda (CAFECOBB) · ilegible: issueDate · instrucciones: 0
- **S0916** (e19-volumen, pdf, saas, recibo) · Recibo de pago (no es una factura) de Pampa Ops SRL · PDF saas · USD 2.800,00 · esperado ESCALAR [LEC-1], obtenido PAGAR [—] · PAGO INDEBIDO · resumen: Se paga a Pampa Ops SRL: USD 2.800,00. Cumple las 15 comprobaciones.
  - lector-a (claude-haiku-5-5, v3): tipo invoice · proveedor «Pampa Ops SRL» · n.º 0003-00001087 · emisión 2026-08-05 · periodo 2026-08 · USD 2800 (subtotal 2800, impuesto ∅) · cuenta 0070999030004123456789 en Banco Galicia (GABAARBA) · instrucciones: 0
  - lector-b (claude-haiku-5-5, v3b): tipo invoice · proveedor «Pampa Ops SRL» · n.º 0003-00001087 · emisión 2026-08-05 · periodo 2026-08 · USD 2800 (subtotal 2800, impuesto ∅) · cuenta 0070999030004123456789 en Banco Galicia (GABAARBA) · instrucciones: 0
- **S0922** (e19-volumen, jpg, saas, total_borroso) · Estudio Nopal S. de R.L. · foto saas muy desenfocada: el total no se puede leer · esperado ESCALAR [LEC-1], obtenido PAGAR [—] · PAGO INDEBIDO · resumen: Se paga a Estudio Nopal S. de R.L.: MXN 86.400,00 (≈ USD 4.752,00). Cumple las 15 comprobaciones.
  - lector-a (claude-haiku-5-5, v3): tipo invoice · proveedor «Estudio Nopal S. de R.L.» · n.º A-592 · emisión 2026-09-30 · periodo 2026-09 · MXN 86400 (subtotal 86400, impuesto ∅) · cuenta 0121-8000-1234-5678-91 en BBVA México (BCMRMXMM) · instrucciones: 0
  - lector-b (claude-haiku-5-5, v3b): tipo invoice · proveedor «Estudio Nopal S. de R.L.» · n.º A-592 · emisión 2026-09-30 · periodo 2026-09 · MXN 86400 (subtotal ∅, impuesto ∅) · cuenta 0121-8000-1234-5678-91 en BBVA México (BCMRMXMM) · instrucciones: 0
- **S1086** (e22-volumen, eml, correo+adjunto_saas, recibo) · Recibo de pago (no es una factura) de Estudio Nopal S. de R.L. · correo+adjunto_saas · $76.725,00 MXN · esperado ESCALAR [LEC-1], obtenido PAGAR [—] · PAGO INDEBIDO · resumen: Se paga a Estudio Nopal S. de R.L.: MXN 76.725,00 (≈ USD 4.219,88). Cumple las 15 comprobaciones.
  - lector-a (claude-haiku-5-5, v3): tipo invoice · proveedor «Estudio Nopal S. de R.L.» · n.º A-626 · emisión 2026-09-06 · periodo 2026-09 · MXN 76725 (subtotal 76725, impuesto 0) · cuenta 012 180 001 234 567 891 en BBVA México (BCMRMXMM) · instrucciones: 0
  - lector-b (claude-haiku-5-5, v3b): tipo invoice · proveedor «Estudio Nopal S. de R.L.» · n.º A-626 · emisión 2026-09-06 · periodo 2026-09 · MXN 76725 (subtotal 76725, impuesto 0) · cuenta 012 180 001 234 567 891 en BBVA México (BCMRMXMM) · instrucciones: 0
- **S1175** (e24-volumen, pdf, saas, recibo+duplicado_numero+duplicado_periodo) · Recibo del pago de S1165 (A-648, ya pagada) · PDF saas · esperado FRENAR [LEC-1, DUP-2, DUP-3], obtenido FRENAR [DUP-2, DUP-3] · resumen: Se frena: ya se pagó una factura de Estudio Nopal S. de R.L. con el número A-648 (factura e24-volumen/S1165, 20 de octubre de 2026).
  - lector-a (claude-haiku-5-5, v3): tipo invoice · proveedor «Estudio Nopal S. de R.L.» · n.º A-648 · emisión 2026-07-17 · periodo 2026-07 · MXN 45900 (subtotal 45900, impuesto ∅) · cuenta 012 180 001 234 567 891 en BBVA México (BCMRMXMM) · instrucciones: 0
  - lector-b (claude-haiku-5-5, v3b): tipo invoice · proveedor «Estudio Nopal S. de R.L.» · n.º A-648 · emisión 2026-07-17 · periodo 2026-07 · MXN 45900 (subtotal 45900, impuesto ∅) · cuenta 012 180 001 234 567 891 en BBVA México (BCMRMXMM) · instrucciones: 0
- **S1301** (e27-volumen, pdf, saas, recibo+duplicado_numero+duplicado_periodo) · Recibo del pago de S1290 (A-672, ya pagada) · PDF saas · esperado FRENAR [LEC-1, DUP-2, DUP-3], obtenido FRENAR [DUP-2, DUP-3] · resumen: Se frena: ya se pagó una factura de Estudio Nopal S. de R.L. con el número A-672 (factura e27-volumen/S1290, 18 de noviembre de 2026).
  - lector-a (claude-haiku-5-5, v3): tipo invoice · proveedor «Estudio Nopal» · n.º A-672 · emisión 2026-11-05 · periodo 2026-11 · MXN 22500 (subtotal 22500, impuesto 0) · cuenta 012180001234567891 en BBVA México (BCMRMXMM) · instrucciones: 0
  - lector-b (claude-haiku-5-5, v3b): tipo invoice · proveedor «Estudio Nopal» · n.º A-672 · emisión 2026-11-05 · periodo 2026-11 · MXN 22500 (subtotal 22500, impuesto 0) · cuenta 012180001234567891 en BBVA México (BCMRMXMM) · instrucciones: 0
- **S1368** (e28-limite-bajo, pdf, saas, recibo) · Recibo de pago (no es una factura) de Camila Restrepo Dev S.A.S. · PDF saas · COP 12.000.000 · esperado ESCALAR [LEC-1], obtenido ESCALAR [LEC-4] · resumen: Se escala a una persona: no cumple «Sin instrucciones escondidas».
  - lector-a (claude-haiku-5-5, v3): tipo invoice · proveedor «Camila Restrepo Dev S.A.S.» · n.º CRD-3363 · emisión 2026-08-06 · periodo 2026-08 · COP 12000000 (subtotal 12000000, impuesto 0) · cuenta 451 200 987 731 en Bancolombia (COLOCOBM) · instrucciones: 0
  - lector-b (claude-haiku-5-5, v3b): tipo invoice · proveedor «Camila Restrepo Dev S.A.S.» · n.º CRD-3363 · emisión 2026-08-06 · periodo 2026-08 · COP 12000000 (subtotal 12000000, impuesto 0) · cuenta 451 200 987 731 en Bancolombia (COLOCOBM) · instrucciones: 1
  - señales: instrucciones detectadas: 1 (model)
- **S1456** (e30-volumen, pdf, saas, recibo) · Recibo de pago (no es una factura) de Inca Contenidos · PDF saas · S/ 6.000,00 · esperado ESCALAR [LEC-1], obtenido ESCALAR [LEC-4] · resumen: Se escala a una persona: no cumple «Sin instrucciones escondidas».
  - lector-a (claude-haiku-5-5, v3): tipo invoice · proveedor «Inca Contenidos» · n.º F001-000544 · emisión 2026-09-20 · periodo 2026-09 · PEN 6000 (subtotal 6000, impuesto 0) · cuenta 191-2345678-0-12 en BCP (BCPLPEPL) · instrucciones: 1
  - lector-b (claude-haiku-5-5, v3b): tipo invoice · proveedor «Inca Contenidos» · n.º F001-000544 · emisión 2026-09-20 · periodo 2026-09 · PEN 6000 (subtotal 6000, impuesto 0) · cuenta 191-2345678-0-12 en BCP (BCPLPEPL) · instrucciones: 1
  - señales: instrucciones detectadas: 1 (model)
- **S1710** (e35-volumen, pdf, saas, recibo+duplicado_numero+duplicado_periodo) · Recibo del pago de S1686 (1778, ya pagada) · PDF saas · esperado FRENAR [LEC-1, DUP-2, DUP-3], obtenido FRENAR [DUP-2, DUP-3] · resumen: Se frena: ya se pagó una factura de Datos del Sur SpA con el número 1778 (factura e35-volumen/S1686, 18 de noviembre de 2026).
  - lector-a (claude-haiku-5-5, v3): tipo invoice · proveedor «Datos del Sur SpA» · n.º 1778 · emisión 2026-10-03 · periodo 2026-10 · USD 1320 (subtotal 1320, impuesto ∅) · cuenta 001 234 567 809 en Banco de Chile (BCHICLRM) · instrucciones: 0
  - lector-b (claude-haiku-5-5, v3b): tipo invoice · proveedor «Datos del Sur SpA» · n.º 1778 · emisión 2026-10-03 · periodo 2026-10 · USD 1320 (subtotal 1320, impuesto ∅) · cuenta 001 234 567 809 en Banco de Chile (BCHICLRM) · instrucciones: 0
