# Banco de pruebas · set de estrés

- Fecha: 2026-10-17T22:56:07.328Z
- Lector: en vivo (API de Anthropic, con caché)
- Modelos: claude-haiku-5-5 · versión del prompt: v4 + v4b
- Perfil de lectura: economico · lector-a: claude-haiku-5-5 (prompt v4) · lector-b: claude-haiku-5-5 (prompt v4b)
- Casos: 61 (muestra estratificada por trampa y formato, semilla 17) · split: all · escenarios en paralelo: 4
- Procesados solo como historial (no cuentan): 991 (con lectura simulada)
- Intervalos: Clopper-Pearson al 95 % entre corchetes. La etiqueta de cada factura sale de su receta (dataset/stress/plan.ts), no del motor.

## Resumen

| Métrica | Valor |
|---|---:|
| Aciertos | 61/61 · 100,0 % [94,1–100,0] |
| Pagos indebidos (sobre las que no se debían pagar) | 0/61 · 0,0 % [0,0–5,9] |
| Escaladas de más (sobre PAGAR/FRENAR esperados) | 0/9 · 0,0 % [0,0–33,6] |
| Frenos de más (sobre las que no debían frenarse) | 0/52 · 0,0 % [0,0–6,8] |
| Autonomía (PAGAR/FRENAR resueltos sin escalar) | 9/9 · 100,0 % [66,4–100,0] |
| Tokens (entrada / salida) | 879570 / 210822 |
| Costo estimado | USD 0.1934 (USD 0.00317 por factura) |

## Matriz de confusión (filas: esperado; columnas: obtenido)

| Esperado | PAGAR | FRENAR | ESCALAR | ERROR |
|---|---:|---:|---:|---:|
| PAGAR | 0 | 0 | 0 | 0 |
| FRENAR | 0 | 9 | 0 | 0 |
| ESCALAR | 0 | 0 | 52 | 0 |

## Por trampa (una factura con varias trampas cuenta en cada una)

| Grupo | Casos | Aciertos | Pagos indebidos | Escaladas de más | Frenos de más | Autonomía | Costo (USD) |
|---|---:|---:|---:|---:|---:|---:|---:|
| Total ilegible en foto (`total_borroso`) | 34 | 34/34 · 100,0 % [89,7–100,0] | 0/34 · 0,0 % [0,0–10,3] | — | 0/34 · 0,0 % [0,0–10,3] | — | 0.1124 |
| Recibo (no es factura) (`recibo`) | 27 | 27/27 · 100,0 % [87,2–100,0] | 0/27 · 0,0 % [0,0–12,8] | 0/9 · 0,0 % [0,0–33,6] | 0/18 · 0,0 % [0,0–18,5] | 9/9 · 100,0 % [66,4–100,0] | 0.0810 |
| Mismo número en otro formato (`duplicado_numero`) | 9 | 9/9 · 100,0 % [66,4–100,0] | 0/9 · 0,0 % [0,0–33,6] | 0/9 · 0,0 % [0,0–33,6] | — | 9/9 · 100,0 % [66,4–100,0] | 0.0265 |
| Mismo periodo con otro número (`duplicado_periodo`) | 9 | 9/9 · 100,0 % [66,4–100,0] | 0/9 · 0,0 % [0,0–33,6] | 0/9 · 0,0 % [0,0–33,6] | — | 9/9 · 100,0 % [66,4–100,0] | 0.0265 |
| Instrucciones escondidas (`instruccion_escondida`) | 5 | 5/5 · 100,0 % [47,8–100,0] | 0/5 · 0,0 % [0,0–52,2] | — | 0/5 · 0,0 % [0,0–52,2] | — | 0.0160 |
| Sobre el umbral (`sobre_umbral`) | 2 | 2/2 · 100,0 % [15,8–100,0] | 0/2 · 0,0 % [0,0–84,2] | — | 0/2 · 0,0 % [0,0–84,2] | — | 0.0059 |

## Por formato

| Grupo | Casos | Aciertos | Pagos indebidos | Escaladas de más | Frenos de más | Autonomía | Costo (USD) |
|---|---:|---:|---:|---:|---:|---:|---:|
| jpg | 36 | 36/36 · 100,0 % [90,3–100,0] | 0/36 · 0,0 % [0,0–9,7] | — | 0/36 · 0,0 % [0,0–9,7] | — | 0.1194 |
| pdf | 12 | 12/12 · 100,0 % [73,5–100,0] | 0/12 · 0,0 % [0,0–26,5] | 0/6 · 0,0 % [0,0–45,9] | 0/6 · 0,0 % [0,0–45,9] | 6/6 · 100,0 % [54,1–100,0] | 0.0352 |
| eml | 10 | 10/10 · 100,0 % [69,2–100,0] | 0/10 · 0,0 % [0,0–30,8] | 0/3 · 0,0 % [0,0–70,8] | 0/7 · 0,0 % [0,0–41,0] | 3/3 · 100,0 % [29,2–100,0] | 0.0297 |
| png | 3 | 3/3 · 100,0 % [29,2–100,0] | 0/3 · 0,0 % [0,0–70,8] | — | 0/3 · 0,0 % [0,0–70,8] | — | 0.0090 |

## Por presentación

| Grupo | Casos | Aciertos | Pagos indebidos | Escaladas de más | Frenos de más | Autonomía | Costo (USD) |
|---|---:|---:|---:|---:|---:|---:|---:|
| latam | 25 | 25/25 · 100,0 % [86,3–100,0] | 0/25 · 0,0 % [0,0–13,7] | 0/2 · 0,0 % [0,0–84,2] | 0/23 · 0,0 % [0,0–14,8] | 2/2 · 100,0 % [15,8–100,0] | 0.0791 |
| saas | 20 | 20/20 · 100,0 % [83,2–100,0] | 0/20 · 0,0 % [0,0–16,8] | 0/3 · 0,0 % [0,0–70,8] | 0/17 · 0,0 % [0,0–19,5] | 3/3 · 100,0 % [29,2–100,0] | 0.0652 |
| correo_cuerpo | 5 | 5/5 · 100,0 % [47,8–100,0] | 0/5 · 0,0 % [0,0–52,2] | 0/1 · 0,0 % [0,0–97,5] | 0/4 · 0,0 % [0,0–60,2] | 1/1 · 100,0 % [2,5–100,0] | 0.0145 |
| cuenta_cobro | 5 | 5/5 · 100,0 % [47,8–100,0] | 0/5 · 0,0 % [0,0–52,2] | — | 0/5 · 0,0 % [0,0–52,2] | — | 0.0165 |
| correo+adjunto_saas | 3 | 3/3 · 100,0 % [29,2–100,0] | 0/3 · 0,0 % [0,0–70,8] | 0/2 · 0,0 % [0,0–84,2] | 0/1 · 0,0 % [0,0–97,5] | 2/2 · 100,0 % [15,8–100,0] | 0.0093 |
| correo+adjunto_latam | 2 | 2/2 · 100,0 % [15,8–100,0] | 0/2 · 0,0 % [0,0–84,2] | — | 0/2 · 0,0 % [0,0–84,2] | — | 0.0059 |
| nota_servico | 1 | 1/1 · 100,0 % [2,5–100,0] | 0/1 · 0,0 % [0,0–97,5] | 0/1 · 0,0 % [0,0–97,5] | — | 1/1 · 100,0 % [2,5–100,0] | 0.0030 |

## Por idioma

| Grupo | Casos | Aciertos | Pagos indebidos | Escaladas de más | Frenos de más | Autonomía | Costo (USD) |
|---|---:|---:|---:|---:|---:|---:|---:|
| es | 38 | 38/38 · 100,0 % [90,7–100,0] | 0/38 · 0,0 % [0,0–9,3] | 0/4 · 0,0 % [0,0–60,2] | 0/34 · 0,0 % [0,0–10,3] | 4/4 · 100,0 % [39,8–100,0] | 0.1195 |
| en | 22 | 22/22 · 100,0 % [84,6–100,0] | 0/22 · 0,0 % [0,0–15,4] | 0/4 · 0,0 % [0,0–60,2] | 0/18 · 0,0 % [0,0–18,5] | 4/4 · 100,0 % [39,8–100,0] | 0.0709 |
| pt | 1 | 1/1 · 100,0 % [2,5–100,0] | 0/1 · 0,0 % [0,0–97,5] | 0/1 · 0,0 % [0,0–97,5] | — | 1/1 · 100,0 % [2,5–100,0] | 0.0030 |

## Por dificultad

| Grupo | Casos | Aciertos | Pagos indebidos | Escaladas de más | Frenos de más | Autonomía | Costo (USD) |
|---|---:|---:|---:|---:|---:|---:|---:|
| media | 56 | 56/56 · 100,0 % [93,6–100,0] | 0/56 · 0,0 % [0,0–6,4] | 0/9 · 0,0 % [0,0–33,6] | 0/47 · 0,0 % [0,0–7,5] | 9/9 · 100,0 % [66,4–100,0] | 0.1773 |
| alta | 5 | 5/5 · 100,0 % [47,8–100,0] | 0/5 · 0,0 % [0,0–52,2] | — | 0/5 · 0,0 % [0,0–52,2] | — | 0.0161 |

## Por decisión esperada

| Grupo | Casos | Aciertos | Pagos indebidos | Escaladas de más | Frenos de más | Autonomía | Costo (USD) |
|---|---:|---:|---:|---:|---:|---:|---:|
| ESCALAR | 52 | 52/52 · 100,0 % [93,2–100,0] | 0/52 · 0,0 % [0,0–6,8] | — | 0/52 · 0,0 % [0,0–6,8] | — | 0.1669 |
| FRENAR | 9 | 9/9 · 100,0 % [66,4–100,0] | 0/9 · 0,0 % [0,0–33,6] | 0/9 · 0,0 % [0,0–33,6] | — | 9/9 · 100,0 % [66,4–100,0] | 0.0265 |

## Por tipo de escenario

| Grupo | Casos | Aciertos | Pagos indebidos | Escaladas de más | Frenos de más | Autonomía | Costo (USD) |
|---|---:|---:|---:|---:|---:|---:|---:|
| volumen | 44 | 44/44 · 100,0 % [92,0–100,0] | 0/44 · 0,0 % [0,0–8,0] | 0/6 · 0,0 % [0,0–45,9] | 0/38 · 0,0 % [0,0–9,3] | 6/6 · 100,0 % [54,1–100,0] | 0.1396 |
| fondo-bajo | 4 | 4/4 · 100,0 % [39,8–100,0] | 0/4 · 0,0 % [0,0–60,2] | — | 0/4 · 0,0 % [0,0–60,2] | — | 0.0135 |
| limite-bajo | 4 | 4/4 · 100,0 % [39,8–100,0] | 0/4 · 0,0 % [0,0–60,2] | — | 0/4 · 0,0 % [0,0–60,2] | — | 0.0125 |
| tolerancia-0 | 4 | 4/4 · 100,0 % [39,8–100,0] | 0/4 · 0,0 % [0,0–60,2] | 0/3 · 0,0 % [0,0–70,8] | 0/1 · 0,0 % [0,0–97,5] | 3/3 · 100,0 % [29,2–100,0] | 0.0120 |
| umbral-bajo | 3 | 3/3 · 100,0 % [29,2–100,0] | 0/3 · 0,0 % [0,0–70,8] | — | 0/3 · 0,0 % [0,0–70,8] | — | 0.0098 |
| reglas-base | 2 | 2/2 · 100,0 % [15,8–100,0] | 0/2 · 0,0 % [0,0–84,2] | — | 0/2 · 0,0 % [0,0–84,2] | — | 0.0060 |

## Consumo por modelo

Precios usados (USD por millón de tokens, entrada / salida): claude-sonnet-5-5 2 / 10 · claude-haiku-5-5 0.1 / 0.5.

| Modelo | Tokens de entrada | Tokens de salida | Costo estimado |
|---|---:|---:|---:|
| claude-haiku-5-5 | 879570 | 210822 | USD 0.1934 |

| Lector | Modelo · prompt | Tokens de entrada | Tokens de salida | Costo estimado |
|---|---|---:|---:|---:|
| lector-a | claude-haiku-5-5 · v4 | 427158 | 91435 | USD 0.0884 |
| lector-b | claude-haiku-5-5 · v4b | 452412 | 119387 | USD 0.1049 |

## Fallos por tipo

Ninguno.

## Detalle de fallos

Ninguno.
