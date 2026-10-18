# Banco de pruebas · Centinela

- Fecha: 2026-10-18T17:16:29.787Z
- Lector: simulado (lectura «perfecta» del manifiesto: prueba la lógica de decisión, no mide la calidad de lectura)
- Casos: todos
- Versión del prompt: v6 · Modelos: simulado

## Resumen

| Métrica | Valor |
|---|---:|
| Aciertos | 138/138 (100,0 %) |
| Pagos indebidos | 0 |
| Escaladas de más | 0 |
| Frenos de más | 0 |
| Autonomía (PAGAR/FRENAR resueltos sin escalar) | 106/106 (100,0 %) |

## Por split

| Grupo | Casos | Aciertos | Pagos indebidos | Escaladas de más | Frenos de más | Autonomía |
|---|---:|---:|---:|---:|---:|---:|
| train | 125 | 125/125 (100,0 %) | 0 | 0 | 0 | 98/98 (100,0 %) |
| holdout | 13 | 13/13 (100,0 %) | 0 | 0 | 0 | 8/8 (100,0 %) |

## Por escenario

| Grupo | Casos | Aciertos | Pagos indebidos | Escaladas de más | Frenos de más | Autonomía |
|---|---:|---:|---:|---:|---:|---:|
| base | 120 | 120/120 (100,0 %) | 0 | 0 | 0 | 94/94 (100,0 %) |
| cierre_mes | 3 | 3/3 (100,0 %) | 0 | 0 | 0 | 2/2 (100,0 %) |
| fondo_bajo | 2 | 2/2 (100,0 %) | 0 | 0 | 0 | 2/2 (100,0 %) |
| reservado | 13 | 13/13 (100,0 %) | 0 | 0 | 0 | 8/8 (100,0 %) |

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
| B17 | base | train | ESCALAR | ESCALAR | LEC-1 | LEC-1, ACU-3 (sin datos), LIM-1 (sin datos), LIM-2 (sin datos), FON-1 (sin datos) | correcto |
| B18 | base | train | ESCALAR | ESCALAR | LEC-3 | LEC-3, ACU-3 | correcto |
| B19 | base | train | PAGAR | PAGAR | — | — | correcto |
| B20 | base | train | PAGAR | PAGAR | — | — | correcto |
| B21 | base | train | PAGAR | PAGAR | — | — | correcto |
| B22 | base | train | ESCALAR | ESCALAR | ACU-1 | ACU-1, DUP-3 (sin datos), ACU-2 (sin datos), ACU-3 (sin datos) | correcto |
| B23 | base | train | ESCALAR | ESCALAR | LEC-1 | LEC-1, LIM-1, PRV-2 (sin datos) | correcto |
| B24 | base | train | PAGAR | PAGAR | — | — | correcto |
| B25 | base | train | PAGAR | PAGAR | — | — | correcto |
| B26 | base | train | PAGAR | PAGAR | — | — | correcto |
| B27 | base | train | PAGAR | PAGAR | — | — | correcto |
| B28 | base | train | PAGAR | PAGAR | — | — | correcto |
| B29 | base | train | ESCALAR | ESCALAR | LEC-1 | LEC-1, PRV-2 (sin datos) | correcto |
| B30 | base | train | PAGAR | PAGAR | — | — | correcto |
| B31 | base | train | PAGAR | PAGAR | — | — | correcto |
| B32 | base | train | PAGAR | PAGAR | — | — | correcto |
| B33 | base | train | PAGAR | PAGAR | — | — | correcto |
| B34 | base | train | PAGAR | PAGAR | — | — | correcto |
| B35 | base | train | PAGAR | PAGAR | — | — | correcto |
| B36 | base | train | PAGAR | PAGAR | — | — | correcto |
| B37 | base | train | PAGAR | PAGAR | — | — | correcto |
| B38 | base | train | PAGAR | PAGAR | — | — | correcto |
| B39 | base | train | PAGAR | PAGAR | — | — | correcto |
| B40 | base | train | PAGAR | PAGAR | — | — | correcto |
| B41 | base | train | PAGAR | PAGAR | — | — | correcto |
| B42 | base | train | PAGAR | PAGAR | — | — | correcto |
| B43 | base | train | PAGAR | PAGAR | — | — | correcto |
| B44 | base | train | PAGAR | PAGAR | — | — | correcto |
| B45 | base | train | PAGAR | PAGAR | — | — | correcto |
| B46 | base | train | PAGAR | PAGAR | — | — | correcto |
| B47 | base | train | PAGAR | PAGAR | — | — | correcto |
| B48 | base | train | ESCALAR | ESCALAR | PRV-2 | LEC-4, PRV-2 | correcto |
| B49 | base | train | PAGAR | PAGAR | — | — | correcto |
| B50 | base | train | PAGAR | PAGAR | — | — | correcto |
| B51 | base | train | PAGAR | PAGAR | — | — | correcto |
| B52 | base | train | PAGAR | PAGAR | — | — | correcto |
| B53 | base | train | PAGAR | PAGAR | — | — | correcto |
| B54 | base | train | PAGAR | PAGAR | — | — | correcto |
| B55 | base | train | PAGAR | PAGAR | — | — | correcto |
| B56 | base | train | PAGAR | PAGAR | — | — | correcto |
| B57 | base | train | PAGAR | PAGAR | — | — | correcto |
| B58 | base | train | PAGAR | PAGAR | — | — | correcto |
| B59 | base | train | PAGAR | PAGAR | — | — | correcto |
| B60 | base | train | PAGAR | PAGAR | — | — | correcto |
| B61 | base | train | PAGAR | PAGAR | — | — | correcto |
| B62 | base | train | PAGAR | PAGAR | — | — | correcto |
| B63 | base | train | PAGAR | PAGAR | — | — | correcto |
| B64 | base | train | PAGAR | PAGAR | — | — | correcto |
| B65 | base | train | PAGAR | PAGAR | — | — | correcto |
| B66 | base | train | PAGAR | PAGAR | — | — | correcto |
| B67 | base | train | PAGAR | PAGAR | — | — | correcto |
| B68 | base | train | PAGAR | PAGAR | — | — | correcto |
| B69 | base | train | PAGAR | PAGAR | — | — | correcto |
| B70 | base | train | PAGAR | PAGAR | — | — | correcto |
| B71 | base | train | PAGAR | PAGAR | — | — | correcto |
| B72 | base | train | PAGAR | PAGAR | — | — | correcto |
| B73 | base | train | PAGAR | PAGAR | — | — | correcto |
| B74 | base | train | PAGAR | PAGAR | — | — | correcto |
| B75 | base | train | PAGAR | PAGAR | — | — | correcto |
| B76 | base | train | FRENAR | FRENAR | DUP-3 | DUP-3 | correcto |
| B77 | base | train | ESCALAR | ESCALAR | LEC-1 | LEC-1, ACU-3, PRV-2 (sin datos) | correcto |
| B78 | base | train | PAGAR | PAGAR | — | — | correcto |
| B79 | base | train | FRENAR | FRENAR | DUP-1 | DUP-1, DUP-2, DUP-3 | correcto |
| B80 | base | train | PAGAR | PAGAR | — | — | correcto |
| B81 | base | train | ESCALAR | ESCALAR | ACU-1 | ACU-1, DUP-3 (sin datos), ACU-2 (sin datos), ACU-3 (sin datos) | correcto |
| B82 | base | train | ESCALAR | ESCALAR | ACU-3 | ACU-3 | correcto |
| B83 | base | train | PAGAR | PAGAR | — | — | correcto |
| B84 | base | train | PAGAR | PAGAR | — | — | correcto |
| B85 | base | train | PAGAR | PAGAR | — | — | correcto |
| B86 | base | train | ESCALAR | ESCALAR | PRV-1 | PRV-1, DUP-2 (sin datos), DUP-3 (sin datos), PRV-2 (sin datos), ACU-1 (sin datos), ACU-2 (sin datos), ACU-3 (sin datos) | correcto |
| B87 | base | train | ESCALAR | ESCALAR | LEC-1 | LEC-1 | correcto |
| B88 | base | train | ESCALAR | ESCALAR | LEC-1 | LEC-1 | correcto |
| B89 | base | train | PAGAR | PAGAR | — | — | correcto |
| B90 | base | train | FRENAR | FRENAR | DUP-2 | DUP-2, DUP-3 | correcto |
| B91 | base | train | ESCALAR | ESCALAR | ACU-1 | ACU-1 | correcto |
| B92 | base | train | PAGAR | PAGAR | — | — | correcto |
| B93 | base | train | PAGAR | PAGAR | — | — | correcto |
| B94 | base | train | FRENAR | FRENAR | DUP-3 | DUP-3 | correcto |
| B95 | base | train | PAGAR | PAGAR | — | — | correcto |
| B96 | base | train | FRENAR | FRENAR | DUP-3 | DUP-3 | correcto |
| B97 | base | train | ESCALAR | ESCALAR | LEC-1 | LEC-1 | correcto |
| B98 | base | train | PAGAR | PAGAR | — | — | correcto |
| B99 | base | train | PAGAR | PAGAR | — | — | correcto |
| B100 | base | train | ESCALAR | ESCALAR | LEC-1 | LEC-1 | correcto |
| B101 | base | train | PAGAR | PAGAR | — | — | correcto |
| B102 | base | train | FRENAR | FRENAR | DUP-2 | DUP-2, DUP-3 | correcto |
| B103 | base | train | ESCALAR | ESCALAR | LEC-1 | LEC-1 | correcto |
| B104 | base | train | PAGAR | PAGAR | — | — | correcto |
| B105 | base | train | FRENAR | FRENAR | DUP-3 | DUP-3 | correcto |
| B106 | base | train | ESCALAR | ESCALAR | ACU-1 | ACU-1, DUP-3 (sin datos), ACU-2 (sin datos), ACU-3 (sin datos) | correcto |
| B107 | base | train | ESCALAR | ESCALAR | ACU-2 | LEC-1, ACU-2 | correcto |
| B108 | base | train | PAGAR | PAGAR | — | — | correcto |
| B109 | base | train | PAGAR | PAGAR | — | — | correcto |
| B110 | base | train | PAGAR | PAGAR | — | — | correcto |
| B111 | base | train | PAGAR | PAGAR | — | — | correcto |
| B112 | base | train | PAGAR | PAGAR | — | — | correcto |
| B113 | base | train | PAGAR | PAGAR | — | — | correcto |
| B114 | base | train | PAGAR | PAGAR | — | — | correcto |
| B115 | base | train | FRENAR | FRENAR | DUP-2 | DUP-2, DUP-3 | correcto |
| B116 | base | train | ESCALAR | ESCALAR | LEC-4 | LEC-4 | correcto |
| B117 | base | train | PAGAR | PAGAR | — | — | correcto |
| B118 | base | train | PAGAR | PAGAR | — | — | correcto |
| B119 | base | train | PAGAR | PAGAR | — | — | correcto |
| B120 | base | train | FRENAR | FRENAR | DUP-1 | DUP-1, DUP-2, DUP-3 | correcto |
| M01 | cierre_mes | train | PAGAR | PAGAR | — | — | correcto |
| M02 | cierre_mes | train | PAGAR | PAGAR | — | — | correcto |
| M03 | cierre_mes | train | ESCALAR | ESCALAR | LIM-2 | LIM-2 | correcto |
| F01 | fondo_bajo | train | PAGAR | PAGAR | — | — | correcto |
| F02 | fondo_bajo | train | FRENAR | FRENAR | FON-1 | FON-1 | correcto |
| H01 | reservado | holdout | PAGAR | PAGAR | — | — | correcto |
| H02 | reservado | holdout | PAGAR | PAGAR | — | — | correcto |
| H03 | reservado | holdout | FRENAR | FRENAR | DUP-2 | DUP-2, DUP-3 | correcto |
| H04 | reservado | holdout | PAGAR | PAGAR | — | — | correcto |
| H05 | reservado | holdout | ESCALAR | ESCALAR | PRV-2 | LEC-4, PRV-2 | correcto |
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
