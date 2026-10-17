# Banco de pruebas · set de estrés

- Fecha: 2026-10-17T21:48:50.592Z
- Lector: en vivo (API de Anthropic, con caché)
- Modelos: claude-sonnet-5-5, claude-haiku-5-5 · versión del prompt: v3
- Perfil de lectura: calidad · lector-a: claude-sonnet-5-5 (prompt v3) · lector-b: claude-haiku-5-5 (prompt v3)
- Casos: 6 (muestra estratificada por trampa y formato, semilla 17) · split: all · escenarios en paralelo: 4
- Procesados solo como historial (no cuentan): 190 (con lectura simulada)
- Intervalos: Clopper-Pearson al 95 % entre corchetes. La etiqueta de cada factura sale de su receta (dataset/stress/plan.ts), no del motor.

## Resumen

| Métrica | Valor |
|---|---:|
| Aciertos | 3/6 · 50,0 % [11,8–88,2] |
| Pagos indebidos (sobre las que no se debían pagar) | 3/6 · 50,0 % [11,8–88,2] |
| Escaladas de más (sobre PAGAR/FRENAR esperados) | — |
| Frenos de más (sobre las que no debían frenarse) | 0/6 · 0,0 % [0,0–45,9] |
| Autonomía (PAGAR/FRENAR resueltos sin escalar) | — |
| Tokens (entrada / salida) | 63740 / 15067 |
| Costo estimado | USD 0.1252 (USD 0.02087 por factura) |

## Matriz de confusión (filas: esperado; columnas: obtenido)

| Esperado | PAGAR | FRENAR | ESCALAR | ERROR |
|---|---:|---:|---:|---:|
| PAGAR | 0 | 0 | 0 | 0 |
| FRENAR | 0 | 0 | 0 | 0 |
| ESCALAR | 3 | 0 | 3 | 0 |

## Por trampa (una factura con varias trampas cuenta en cada una)

| Grupo | Casos | Aciertos | Pagos indebidos | Escaladas de más | Frenos de más | Autonomía | Costo (USD) |
|---|---:|---:|---:|---:|---:|---:|---:|
| Recibo (no es factura) (`recibo`) | 5 | 2/5 · 40,0 % [5,3–85,3] | 3/5 · 60,0 % [14,7–94,7] | — | 0/5 · 0,0 % [0,0–52,2] | — | 0.1017 |
| Total ilegible en foto (`total_borroso`) | 1 | 1/1 · 100,0 % [2,5–100,0] | 0/1 · 0,0 % [0,0–97,5] | — | 0/1 · 0,0 % [0,0–97,5] | — | 0.0236 |

## Por formato

| Grupo | Casos | Aciertos | Pagos indebidos | Escaladas de más | Frenos de más | Autonomía | Costo (USD) |
|---|---:|---:|---:|---:|---:|---:|---:|
| eml | 4 | 1/4 · 25,0 % [0,6–80,6] | 3/4 · 75,0 % [19,4–99,4] | — | 0/4 · 0,0 % [0,0–60,2] | — | 0.0799 |
| jpg | 1 | 1/1 · 100,0 % [2,5–100,0] | 0/1 · 0,0 % [0,0–97,5] | — | 0/1 · 0,0 % [0,0–97,5] | — | 0.0236 |
| pdf | 1 | 1/1 · 100,0 % [2,5–100,0] | 0/1 · 0,0 % [0,0–97,5] | — | 0/1 · 0,0 % [0,0–97,5] | — | 0.0218 |

## Por presentación

| Grupo | Casos | Aciertos | Pagos indebidos | Escaladas de más | Frenos de más | Autonomía | Costo (USD) |
|---|---:|---:|---:|---:|---:|---:|---:|
| correo_cuerpo | 3 | 0/3 · 0,0 % [0,0–70,8] | 3/3 · 100,0 % [29,2–100,0] | — | 0/3 · 0,0 % [0,0–70,8] | — | 0.0561 |
| saas | 2 | 2/2 · 100,0 % [15,8–100,0] | 0/2 · 0,0 % [0,0–84,2] | — | 0/2 · 0,0 % [0,0–84,2] | — | 0.0454 |
| correo+adjunto_saas | 1 | 1/1 · 100,0 % [2,5–100,0] | 0/1 · 0,0 % [0,0–97,5] | — | 0/1 · 0,0 % [0,0–97,5] | — | 0.0238 |

## Por idioma

| Grupo | Casos | Aciertos | Pagos indebidos | Escaladas de más | Frenos de más | Autonomía | Costo (USD) |
|---|---:|---:|---:|---:|---:|---:|---:|
| en | 3 | 2/3 · 66,7 % [9,4–99,2] | 1/3 · 33,3 % [0,8–90,6] | — | 0/3 · 0,0 % [0,0–70,8] | — | 0.0639 |
| es | 3 | 1/3 · 33,3 % [0,8–90,6] | 2/3 · 66,7 % [9,4–99,2] | — | 0/3 · 0,0 % [0,0–70,8] | — | 0.0614 |

## Por dificultad

| Grupo | Casos | Aciertos | Pagos indebidos | Escaladas de más | Frenos de más | Autonomía | Costo (USD) |
|---|---:|---:|---:|---:|---:|---:|---:|
| media | 6 | 3/6 · 50,0 % [11,8–88,2] | 3/6 · 50,0 % [11,8–88,2] | — | 0/6 · 0,0 % [0,0–45,9] | — | 0.1252 |

## Por decisión esperada

| Grupo | Casos | Aciertos | Pagos indebidos | Escaladas de más | Frenos de más | Autonomía | Costo (USD) |
|---|---:|---:|---:|---:|---:|---:|---:|
| ESCALAR | 6 | 3/6 · 50,0 % [11,8–88,2] | 3/6 · 50,0 % [11,8–88,2] | — | 0/6 · 0,0 % [0,0–45,9] | — | 0.1252 |

## Por tipo de escenario

| Grupo | Casos | Aciertos | Pagos indebidos | Escaladas de más | Frenos de más | Autonomía | Costo (USD) |
|---|---:|---:|---:|---:|---:|---:|---:|
| volumen | 6 | 3/6 · 50,0 % [11,8–88,2] | 3/6 · 50,0 % [11,8–88,2] | — | 0/6 · 0,0 % [0,0–45,9] | — | 0.1252 |

## Consumo por modelo

Precios usados (USD por millón de tokens, entrada / salida): claude-sonnet-5-5 2 / 10 · claude-haiku-5-5 0.1 / 0.5.

| Modelo | Tokens de entrada | Tokens de salida | Costo estimado |
|---|---:|---:|---:|
| claude-sonnet-5-5 | 31870 | 5344 | USD 0.1172 |
| claude-haiku-5-5 | 31870 | 9723 | USD 0.0080 |

| Lector | Modelo · prompt | Tokens de entrada | Tokens de salida | Costo estimado |
|---|---|---:|---:|---:|
| lector-a | claude-sonnet-5-5 · v3 | 31870 | 5344 | USD 0.1172 |
| lector-b | claude-haiku-5-5 · v3 | 31870 | 9723 | USD 0.0080 |

## Fallos por tipo

- **3** · recibo: esperado ESCALAR, obtenido PAGAR · faltan LEC-1 · p. ej. S0030, S0488, S0768

## Detalle de fallos

- **S0030** (e01-volumen, eml, correo_cuerpo, recibo) · Recibo de pago (no es una factura) de CloudMetrics · correo_cuerpo · USD 1.200,00 · esperado ESCALAR [LEC-1], obtenido PAGAR [—] · PAGO INDEBIDO · resumen: Se paga a CloudMetrics Inc.: USD 1.200,00. Cumple las 15 comprobaciones.
  - lector-a (claude-sonnet-5-5, v3): tipo invoice · proveedor «CloudMetrics» · n.º CM-INV-2026-1004 · emisión 2026-09-08 · periodo 2026-08 · USD 1200 (subtotal 1200, impuesto 0) · cuenta 3300198822 en Silicon Valley Bank (121140399) · ilegible: issueDate · instrucciones: 0
  - lector-b (claude-haiku-5-5, v3): tipo invoice · proveedor «CloudMetrics» · n.º CM-INV-2026-1004 · emisión 2026-09-08 · periodo 2026-08 · USD 1200 (subtotal 1200, impuesto 0) · cuenta 3300198822 en Silicon Valley Bank (121140399) · instrucciones: 0
- **S0488** (e10-volumen, eml, correo_cuerpo, recibo) · Recibo de pago (no es una factura) de Estudio Nopal S. de R.L. · correo_cuerpo · $65.925,00 MXN · esperado ESCALAR [LEC-1], obtenido PAGAR [—] · PAGO INDEBIDO · resumen: Se paga a Estudio Nopal S. de R.L.: MXN 65.925,00 (≈ USD 3.625,88). Cumple las 15 comprobaciones.
  - lector-a (claude-sonnet-5-5, v3): tipo invoice · proveedor «Estudio Nopal S. de R.L.» · n.º A-505 · emisión 2026-10-07 · periodo 2026-10 · MXN 65925 (subtotal 65925, impuesto 0) · cuenta 012180001234567891 en BBVA México (BCMRMXMM) · instrucciones: 0
  - lector-b (claude-haiku-5-5, v3): tipo invoice · proveedor «Estudio Nopal S. de R.L.» · n.º A-505 · emisión 2026-10-07 · periodo 2026-10 · MXN 65925 (subtotal 65925, impuesto 0) · cuenta 012180001234567891 en BBVA México (BCMRMXMM) · instrucciones: 0
- **S0768** (e16-volumen, eml, correo_cuerpo, recibo) · Recibo de pago (no es una factura) de Soporte Caribe · correo_cuerpo · COP 1.080.000 · esperado ESCALAR [LEC-1], obtenido PAGAR [—] · PAGO INDEBIDO · resumen: Se paga a Soporte Caribe S.A.S.: COP 1.080.000,00 (≈ USD 270,00). Cumple las 15 comprobaciones.
  - lector-a (claude-sonnet-5-5, v3): tipo invoice · proveedor «Soporte Caribe» · n.º SC-2488 · emisión 2026-11-02 · periodo 2026-10 · COP 1080000 (subtotal 1080000, impuesto 0) · cuenta 0550-4881-2233 en Banco Davivienda (CAFECOBB) · instrucciones: 0
  - lector-b (claude-haiku-5-5, v3): tipo invoice · proveedor «Soporte Caribe» · n.º SC-2488 · emisión 2026-11-02 · periodo 2026-10 · COP 1080000 (subtotal 1080000, impuesto 0) · cuenta 0550-4881-2233 en Banco Davivienda (CAFECOBB) · instrucciones: 0
