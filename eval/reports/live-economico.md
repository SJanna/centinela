# Banco de pruebas · Centinela

- Fecha: 2026-10-17T21:45:34.311Z
- Lector: en vivo (API de Anthropic, con la caché de dataset/reading-cache)
- Casos: todos
- Versión del prompt: v3 + v3b · Modelos: claude-haiku-5-5
- Perfil de lectura: economico · lector-a: claude-haiku-5-5 (prompt v3) · lector-b: claude-haiku-5-5 (prompt v3b)

## Resumen

| Métrica | Valor |
|---|---:|
| Aciertos | 41/41 (100,0 %) |
| Pagos indebidos | 0 |
| Escaladas de más | 0 |
| Frenos de más | 0 |
| Autonomía (PAGAR/FRENAR resueltos sin escalar) | 24/24 (100,0 %) |
| Tokens (entrada / salida) | 480434 / 92160 |
| Costo estimado | USD 0.0941 |

## Por split

| Grupo | Casos | Aciertos | Pagos indebidos | Escaladas de más | Frenos de más | Autonomía |
|---|---:|---:|---:|---:|---:|---:|
| train | 28 | 28/28 (100,0 %) | 0 | 0 | 0 | 16/16 (100,0 %) |
| holdout | 13 | 13/13 (100,0 %) | 0 | 0 | 0 | 8/8 (100,0 %) |

## Por escenario

| Grupo | Casos | Aciertos | Pagos indebidos | Escaladas de más | Frenos de más | Autonomía |
|---|---:|---:|---:|---:|---:|---:|
| base | 23 | 23/23 (100,0 %) | 0 | 0 | 0 | 12/12 (100,0 %) |
| cierre_mes | 3 | 3/3 (100,0 %) | 0 | 0 | 0 | 2/2 (100,0 %) |
| fondo_bajo | 2 | 2/2 (100,0 %) | 0 | 0 | 0 | 2/2 (100,0 %) |
| reservado | 13 | 13/13 (100,0 %) | 0 | 0 | 0 | 8/8 (100,0 %) |

## Consumo y costo estimado

Precios usados (USD por millón de tokens, entrada / salida): claude-sonnet-5-5 2 / 10 · claude-haiku-5-5 0.1 / 0.5.

| Modelo | Tokens de entrada | Tokens de salida | Costo estimado |
|---|---:|---:|---:|
| claude-haiku-5-5 | 480434 | 92160 | USD 0.0941 |
| **Total** | 480434 | 92160 | USD 0.0941 |

| Lector | Modelo · prompt | Tokens de entrada | Tokens de salida | Costo estimado |
|---|---|---:|---:|---:|
| lector-a | claude-haiku-5-5 · v3 | 232277 | 44258 | USD 0.0454 |
| lector-b | claude-haiku-5-5 · v3b | 248157 | 47902 | USD 0.0488 |

## Detalle por caso

| Caso | Escenario | Split | Esperado | Obtenido | Códigos esperados | Códigos no superados | Resultado |
|---|---|---|---|---|---|---|---|
| B01 | base | train | PAGAR | PAGAR | — | — | correcto |
| B02 | base | train | PAGAR | PAGAR | — | — | correcto |
| B03 | base | train | PAGAR | PAGAR | — | — | correcto |
| B04 | base | train | PAGAR | PAGAR | — | — | correcto |
| B05 | base | train | PAGAR | PAGAR | — | — | correcto |
| B06 | base | train | FRENAR | FRENAR | DUP-3 | DUP-3 | correcto |
| B07 | base | train | FRENAR | FRENAR | DUP-1 | DUP-1, DUP-2, DUP-3 | correcto |
| B08 | base | train | FRENAR | FRENAR | DUP-2 | DUP-2, DUP-3 | correcto |
| B09 | base | train | ESCALAR | ESCALAR | PRV-1 | PRV-1, DUP-2 (sin datos), DUP-3 (sin datos), PRV-2 (sin datos), ACU-1 (sin datos), ACU-2 (sin datos), ACU-3 (sin datos) | correcto |
| B10 | base | train | ESCALAR | ESCALAR | PRV-2 | PRV-2 | correcto |
| B11 | base | train | ESCALAR | ESCALAR | LIM-1 | LIM-1 | correcto |
| B12 | base | train | ESCALAR | ESCALAR | ACU-3 | ACU-3 | correcto |
| B13 | base | train | ESCALAR | ESCALAR | ACU-3 | ACU-3 | correcto |
| B14 | base | train | ESCALAR | ESCALAR | ACU-2 | ACU-2, ACU-3 (sin datos) | correcto |
| B15 | base | train | PAGAR | PAGAR | — | — | correcto |
| B16 | base | train | ESCALAR | ESCALAR | LEC-4 | LEC-4 | correcto |
| B17 | base | train | ESCALAR | ESCALAR | LEC-1 | LEC-1, LEC-2, ACU-3 (sin datos), LIM-1 (sin datos), LIM-2 (sin datos), FON-1 (sin datos) | correcto |
| B18 | base | train | ESCALAR | ESCALAR | LEC-3 | LEC-3, ACU-3 | correcto |
| B19 | base | train | PAGAR | PAGAR | — | — | correcto |
| B20 | base | train | PAGAR | PAGAR | — | — | correcto |
| B21 | base | train | PAGAR | PAGAR | — | — | correcto |
| B22 | base | train | ESCALAR | ESCALAR | ACU-1 | ACU-1, DUP-3 (sin datos), ACU-2 (sin datos), ACU-3 (sin datos) | correcto |
| B23 | base | train | ESCALAR | ESCALAR | LEC-1 | LEC-1, LIM-1, LIM-2, PRV-2 (sin datos) | correcto |
| M01 | cierre_mes | train | PAGAR | PAGAR | — | — | correcto |
| M02 | cierre_mes | train | PAGAR | PAGAR | — | — | correcto |
| M03 | cierre_mes | train | ESCALAR | ESCALAR | LIM-2 | LIM-2 | correcto |
| F01 | fondo_bajo | train | PAGAR | PAGAR | — | — | correcto |
| F02 | fondo_bajo | train | FRENAR | FRENAR | FON-1 | FON-1 | correcto |
| H01 | reservado | holdout | PAGAR | PAGAR | — | — | correcto |
| H02 | reservado | holdout | PAGAR | PAGAR | — | — | correcto |
| H03 | reservado | holdout | FRENAR | FRENAR | DUP-2 | DUP-2, DUP-3 | correcto |
| H04 | reservado | holdout | PAGAR | PAGAR | — | — | correcto |
| H05 | reservado | holdout | ESCALAR | ESCALAR | PRV-2 | LEC-1, LEC-2, LEC-4, PRV-2 | correcto |
| H06 | reservado | holdout | ESCALAR | ESCALAR | PRV-1 | PRV-1, DUP-2 (sin datos), DUP-3 (sin datos), PRV-2 (sin datos), ACU-1 (sin datos), ACU-2 (sin datos), ACU-3 (sin datos) | correcto |
| H07 | reservado | holdout | ESCALAR | ESCALAR | ACU-3 | ACU-3 | correcto |
| H08 | reservado | holdout | PAGAR | PAGAR | — | — | correcto |
| H09 | reservado | holdout | ESCALAR | ESCALAR | ACU-3 | ACU-3 | correcto |
| H10 | reservado | holdout | ESCALAR | ESCALAR | LEC-4 | LEC-4 | correcto |
| H11 | reservado | holdout | PAGAR | PAGAR | — | — | correcto |
| H12 | reservado | holdout | PAGAR | PAGAR | — | — | correcto |
| H13 | reservado | holdout | FRENAR | FRENAR | DUP-3 | DUP-3 | correcto |

## Fallos

Ninguno.
