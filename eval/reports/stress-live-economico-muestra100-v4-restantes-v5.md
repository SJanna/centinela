# Banco de pruebas · set de estrés

- Fecha: 2026-10-18T07:22:05.204Z
- Lector: en vivo (API de Anthropic, con caché)
- Modelos: claude-haiku-5-5 · versión del prompt: v5 + v5b
- Perfil de lectura: economico · lector-a: claude-haiku-5-5 (prompt v5) · lector-b: claude-haiku-5-5 (prompt v5b)
- Casos: 23 (muestra estratificada por trampa y formato, semilla 17) · split: all · escenarios en paralelo: 4
- Procesados solo como historial (no cuentan): 498 (con lectura simulada)
- Intervalos: Clopper-Pearson al 95 % entre corchetes. La etiqueta de cada factura sale de su receta (dataset/stress/plan.ts), no del motor.

## Resumen

| Métrica | Valor |
|---|---:|
| Aciertos | 23/23 · 100,0 % [85,2–100,0] |
| Pagos indebidos (sobre las que no se debían pagar) | 0/23 · 0,0 % [0,0–14,8] |
| Escaladas de más (sobre PAGAR/FRENAR esperados) | 0/2 · 0,0 % [0,0–84,2] |
| Frenos de más (sobre las que no debían frenarse) | 0/21 · 0,0 % [0,0–16,1] |
| Autonomía (PAGAR/FRENAR resueltos sin escalar) | 2/2 · 100,0 % [15,8–100,0] |
| Tokens (entrada / salida) | 329046 / 72393 |
| Costo estimado | USD 0.0691 (USD 0.00300 por factura) |

## Matriz de confusión (filas: esperado; columnas: obtenido)

| Esperado | PAGAR | FRENAR | ESCALAR | ERROR |
|---|---:|---:|---:|---:|
| PAGAR | 0 | 0 | 0 | 0 |
| FRENAR | 0 | 2 | 0 | 0 |
| ESCALAR | 0 | 0 | 21 | 0 |

## Por trampa (una factura con varias trampas cuenta en cada una)

| Grupo | Casos | Aciertos | Pagos indebidos | Escaladas de más | Frenos de más | Autonomía | Costo (USD) |
|---|---:|---:|---:|---:|---:|---:|---:|
| Nombre parecido a uno registrado (`proveedor_parecido`) | 4 | 4/4 · 100,0 % [39,8–100,0] | 0/4 · 0,0 % [0,0–60,2] | — | 0/4 · 0,0 % [0,0–60,2] | — | 0.0130 |
| Sobre el umbral (`sobre_umbral`) | 4 | 4/4 · 100,0 % [39,8–100,0] | 0/4 · 0,0 % [0,0–60,2] | — | 0/4 · 0,0 % [0,0–60,2] | — | 0.0118 |
| Proveedor no registrado (`proveedor_no_registrado`) | 3 | 3/3 · 100,0 % [29,2–100,0] | 0/3 · 0,0 % [0,0–70,8] | — | 0/3 · 0,0 % [0,0–70,8] | — | 0.0087 |
| Periodo fuera de la vigencia (`periodo_fuera_vigencia`) | 2 | 2/2 · 100,0 % [15,8–100,0] | 0/2 · 0,0 % [0,0–84,2] | — | 0/2 · 0,0 % [0,0–84,2] | — | 0.0057 |
| Periodo futuro (`periodo_futuro`) | 2 | 2/2 · 100,0 % [15,8–100,0] | 0/2 · 0,0 % [0,0–84,2] | — | 0/2 · 0,0 % [0,0–84,2] | — | 0.0051 |
| Recibo (no es factura) (`recibo`) | 2 | 2/2 · 100,0 % [15,8–100,0] | 0/2 · 0,0 % [0,0–84,2] | 0/1 · 0,0 % [0,0–97,5] | 0/1 · 0,0 % [0,0–97,5] | 1/1 · 100,0 % [2,5–100,0] | 0.0067 |
| Sin datos bancarios (`sin_datos_bancarios`) | 2 | 2/2 · 100,0 % [15,8–100,0] | 0/2 · 0,0 % [0,0–84,2] | — | 0/2 · 0,0 % [0,0–84,2] | — | 0.0051 |
| Total ilegible en foto (`total_borroso`) | 2 | 2/2 · 100,0 % [15,8–100,0] | 0/2 · 0,0 % [0,0–84,2] | — | 0/2 · 0,0 % [0,0–84,2] | — | 0.0076 |
| Foto de una factura ya pagada (`duplicado_foto`) | 1 | 1/1 · 100,0 % [2,5–100,0] | 0/1 · 0,0 % [0,0–97,5] | 0/1 · 0,0 % [0,0–97,5] | — | 1/1 · 100,0 % [2,5–100,0] | 0.0026 |
| Mismo número en otro formato (`duplicado_numero`) | 1 | 1/1 · 100,0 % [2,5–100,0] | 0/1 · 0,0 % [0,0–97,5] | 0/1 · 0,0 % [0,0–97,5] | — | 1/1 · 100,0 % [2,5–100,0] | 0.0035 |
| Mismo periodo con otro número (`duplicado_periodo`) | 1 | 1/1 · 100,0 % [2,5–100,0] | 0/1 · 0,0 % [0,0–97,5] | 0/1 · 0,0 % [0,0–97,5] | — | 1/1 · 100,0 % [2,5–100,0] | 0.0035 |
| Límite del mes superado (`limite_mes`) | 1 | 1/1 · 100,0 % [2,5–100,0] | 0/1 · 0,0 % [0,0–97,5] | — | 0/1 · 0,0 % [0,0–97,5] | — | 0.0030 |
| Otra moneda (`otra_moneda`) | 1 | 1/1 · 100,0 % [2,5–100,0] | 0/1 · 0,0 % [0,0–97,5] | — | 0/1 · 0,0 % [0,0–97,5] | — | 0.0029 |
| Tarifa distinta (`tarifa_distinta`) | 1 | 1/1 · 100,0 % [2,5–100,0] | 0/1 · 0,0 % [0,0–97,5] | — | 0/1 · 0,0 % [0,0–97,5] | — | 0.0027 |

## Por formato

| Grupo | Casos | Aciertos | Pagos indebidos | Escaladas de más | Frenos de más | Autonomía | Costo (USD) |
|---|---:|---:|---:|---:|---:|---:|---:|
| jpg | 8 | 8/8 · 100,0 % [63,1–100,0] | 0/8 · 0,0 % [0,0–36,9] | 0/1 · 0,0 % [0,0–97,5] | 0/7 · 0,0 % [0,0–41,0] | 1/1 · 100,0 % [2,5–100,0] | 0.0257 |
| pdf | 6 | 6/6 · 100,0 % [54,1–100,0] | 0/6 · 0,0 % [0,0–45,9] | 0/1 · 0,0 % [0,0–97,5] | 0/5 · 0,0 % [0,0–52,2] | 1/1 · 100,0 % [2,5–100,0] | 0.0171 |
| eml | 4 | 4/4 · 100,0 % [39,8–100,0] | 0/4 · 0,0 % [0,0–60,2] | — | 0/4 · 0,0 % [0,0–60,2] | — | 0.0115 |
| txt | 4 | 4/4 · 100,0 % [39,8–100,0] | 0/4 · 0,0 % [0,0–60,2] | — | 0/4 · 0,0 % [0,0–60,2] | — | 0.0117 |
| png | 1 | 1/1 · 100,0 % [2,5–100,0] | 0/1 · 0,0 % [0,0–97,5] | — | 0/1 · 0,0 % [0,0–97,5] | — | 0.0032 |

## Por presentación

| Grupo | Casos | Aciertos | Pagos indebidos | Escaladas de más | Frenos de más | Autonomía | Costo (USD) |
|---|---:|---:|---:|---:|---:|---:|---:|
| saas | 6 | 6/6 · 100,0 % [54,1–100,0] | 0/6 · 0,0 % [0,0–45,9] | — | 0/6 · 0,0 % [0,0–45,9] | — | 0.0193 |
| latam | 5 | 5/5 · 100,0 % [47,8–100,0] | 0/5 · 0,0 % [0,0–52,2] | — | 0/5 · 0,0 % [0,0–52,2] | — | 0.0147 |
| chat | 4 | 4/4 · 100,0 % [39,8–100,0] | 0/4 · 0,0 % [0,0–60,2] | — | 0/4 · 0,0 % [0,0–60,2] | — | 0.0117 |
| correo_cuerpo | 2 | 2/2 · 100,0 % [15,8–100,0] | 0/2 · 0,0 % [0,0–84,2] | — | 0/2 · 0,0 % [0,0–84,2] | — | 0.0056 |
| nota_servico | 2 | 2/2 · 100,0 % [15,8–100,0] | 0/2 · 0,0 % [0,0–84,2] | 0/1 · 0,0 % [0,0–97,5] | 0/1 · 0,0 % [0,0–97,5] | 1/1 · 100,0 % [2,5–100,0] | 0.0060 |
| correo+adjunto_nota_servico | 1 | 1/1 · 100,0 % [2,5–100,0] | 0/1 · 0,0 % [0,0–97,5] | — | 0/1 · 0,0 % [0,0–97,5] | — | 0.0027 |
| correo+adjunto_saas | 1 | 1/1 · 100,0 % [2,5–100,0] | 0/1 · 0,0 % [0,0–97,5] | — | 0/1 · 0,0 % [0,0–97,5] | — | 0.0033 |
| cuenta_cobro | 1 | 1/1 · 100,0 % [2,5–100,0] | 0/1 · 0,0 % [0,0–97,5] | — | 0/1 · 0,0 % [0,0–97,5] | — | 0.0032 |
| foto_latam | 1 | 1/1 · 100,0 % [2,5–100,0] | 0/1 · 0,0 % [0,0–97,5] | 0/1 · 0,0 % [0,0–97,5] | — | 1/1 · 100,0 % [2,5–100,0] | 0.0026 |

## Por idioma

| Grupo | Casos | Aciertos | Pagos indebidos | Escaladas de más | Frenos de más | Autonomía | Costo (USD) |
|---|---:|---:|---:|---:|---:|---:|---:|
| es | 13 | 13/13 · 100,0 % [75,3–100,0] | 0/13 · 0,0 % [0,0–24,7] | 0/1 · 0,0 % [0,0–97,5] | 0/12 · 0,0 % [0,0–26,5] | 1/1 · 100,0 % [2,5–100,0] | 0.0381 |
| en | 7 | 7/7 · 100,0 % [59,0–100,0] | 0/7 · 0,0 % [0,0–41,0] | — | 0/7 · 0,0 % [0,0–41,0] | — | 0.0220 |
| pt | 3 | 3/3 · 100,0 % [29,2–100,0] | 0/3 · 0,0 % [0,0–70,8] | 0/1 · 0,0 % [0,0–97,5] | 0/2 · 0,0 % [0,0–84,2] | 1/1 · 100,0 % [2,5–100,0] | 0.0090 |

## Por dificultad

| Grupo | Casos | Aciertos | Pagos indebidos | Escaladas de más | Frenos de más | Autonomía | Costo (USD) |
|---|---:|---:|---:|---:|---:|---:|---:|
| media | 13 | 13/13 · 100,0 % [75,3–100,0] | 0/13 · 0,0 % [0,0–24,7] | 0/2 · 0,0 % [0,0–84,2] | 0/11 · 0,0 % [0,0–28,5] | 2/2 · 100,0 % [15,8–100,0] | 0.0400 |
| alta | 5 | 5/5 · 100,0 % [47,8–100,0] | 0/5 · 0,0 % [0,0–52,2] | — | 0/5 · 0,0 % [0,0–52,2] | — | 0.0151 |
| baja | 5 | 5/5 · 100,0 % [47,8–100,0] | 0/5 · 0,0 % [0,0–52,2] | — | 0/5 · 0,0 % [0,0–52,2] | — | 0.0140 |

## Por decisión esperada

| Grupo | Casos | Aciertos | Pagos indebidos | Escaladas de más | Frenos de más | Autonomía | Costo (USD) |
|---|---:|---:|---:|---:|---:|---:|---:|
| ESCALAR | 21 | 21/21 · 100,0 % [83,9–100,0] | 0/21 · 0,0 % [0,0–16,1] | — | 0/21 · 0,0 % [0,0–16,1] | — | 0.0630 |
| FRENAR | 2 | 2/2 · 100,0 % [15,8–100,0] | 0/2 · 0,0 % [0,0–84,2] | 0/2 · 0,0 % [0,0–84,2] | — | 2/2 · 100,0 % [15,8–100,0] | 0.0061 |

## Por tipo de escenario

| Grupo | Casos | Aciertos | Pagos indebidos | Escaladas de más | Frenos de más | Autonomía | Costo (USD) |
|---|---:|---:|---:|---:|---:|---:|---:|
| volumen | 12 | 12/12 · 100,0 % [73,5–100,0] | 0/12 · 0,0 % [0,0–26,5] | 0/2 · 0,0 % [0,0–84,2] | 0/10 · 0,0 % [0,0–30,8] | 2/2 · 100,0 % [15,8–100,0] | 0.0361 |
| limite-bajo | 4 | 4/4 · 100,0 % [39,8–100,0] | 0/4 · 0,0 % [0,0–60,2] | — | 0/4 · 0,0 % [0,0–60,2] | — | 0.0114 |
| tolerancia-2 | 3 | 3/3 · 100,0 % [29,2–100,0] | 0/3 · 0,0 % [0,0–70,8] | — | 0/3 · 0,0 % [0,0–70,8] | — | 0.0103 |
| fondo-bajo | 2 | 2/2 · 100,0 % [15,8–100,0] | 0/2 · 0,0 % [0,0–84,2] | — | 0/2 · 0,0 % [0,0–84,2] | — | 0.0058 |
| tolerancia-0 | 1 | 1/1 · 100,0 % [2,5–100,0] | 0/1 · 0,0 % [0,0–97,5] | — | 0/1 · 0,0 % [0,0–97,5] | — | 0.0029 |
| umbral-bajo | 1 | 1/1 · 100,0 % [2,5–100,0] | 0/1 · 0,0 % [0,0–97,5] | — | 0/1 · 0,0 % [0,0–97,5] | — | 0.0026 |

## Consumo por modelo

Precios usados (USD por millón de tokens, entrada / salida): claude-sonnet-5-5 2 / 10 · claude-haiku-5-5 0.1 / 0.5.

| Modelo | Tokens de entrada | Tokens de salida | Costo estimado |
|---|---:|---:|---:|
| claude-haiku-5-5 | 329046 | 72393 | USD 0.0691 |

| Lector | Modelo · prompt | Tokens de entrada | Tokens de salida | Costo estimado |
|---|---|---:|---:|---:|
| lector-a | claude-haiku-5-5 · v5 | 159762 | 31415 | USD 0.0317 |
| lector-b | claude-haiku-5-5 · v5b | 169284 | 40978 | USD 0.0374 |

## Fallos por tipo

Ninguno.

## Detalle de fallos

Ninguno.
