# Guion del video de demo (≈ 3 minutos)

Objetivo: que el jurado vea las tres cosas con las que evalúa — **autonomía**, **seguridad** (cero pagos indebidos) y **explicabilidad** — en ese orden de impacto.

## 0:00 – 0:20 · El problema

Pantalla: Resumen vacío («Tu agente *paga*. Tú decides.»).

> «Una empresa en EE. UU. con proveedores en Colombia, México, Brasil y Perú recibe decenas de facturas al mes, por PDF, foto, correo o WhatsApp. Centinela las lee, decide cuáles pagar dentro de las reglas de la empresa y escala a una persona lo que se sale. No mueve dinero: decide y explica.»

## 0:20 – 1:00 · Autonomía

Pantalla: **Probar con ejemplos → Reproducir escenario base (23 facturas)**. Las tarjetas caen una por una en Pagadas, Frenadas y Escaladas.

> «Veintitrés facturas reales en forma: PDFs, fotos de celular, correos, chats. Centinela paga solo lo que cumple las quince comprobaciones, frena los duplicados y escala lo dudoso.»

Señalar los KPIs: fondo disponible, gasto del mes contra el límite, autonomía.

## 1:00 – 1:50 · Seguridad (casos trampa)

Abrir, en este orden:

1. **B16 · «ya aprobada por el CFO»** → Escalada. Barra roja: «Instrucción sospechosa detectada. Centinela no la siguió.»
   > «El modelo solo lee. Las decisiones las toma lógica fija, así que una instrucción escondida en la factura no puede aprobar nada.»
2. **B10 · cuenta bancaria distinta** → Escalada por PRV-2. Acción: «Confirmar el cambio de cuenta con el proveedor por un canal conocido.»
3. **B07 · el mismo PDF dos veces** → Frenada por duplicado.
4. **B11 · USD 7.200** → Escalada: supera el umbral de aprobación.

> «Y cada pago pasa por una segunda revisión independiente, la guardia, escrita por separado. Si no está de acuerdo, el pago se escala.»

## 1:50 – 2:30 · Explicabilidad

Pantalla: detalle de una factura pagada (B01) y luego de una escalada.

- «Por qué» en una frase, con superíndices que llevan a cada comprobación.
- Las 15 comprobaciones con su explicación y los valores concretos.
- Datos leídos por las dos lecturas, con la cita literal del documento.
- La traza de la decisión: lecturas, verificación, motor, guardia, registro.
- Pestaña «Texto extraído» en **H10**: aparece el texto blanco escondido en el PDF.

> «Cualquier persona entiende por qué se pagó, frenó o escaló cada factura, sin abrir el código.»

## 2:30 – 2:50 · Reglas de la empresa

Pantalla: Reglas. Las reglas son frases con valores editables: «Escalar a una persona todo pago mayor a USD 5.000». Mostrar el catálogo de las 15 comprobaciones. Luego Proveedores: ficha con cuenta registrada y acuerdos.

## 2:50 – 3:00 · Cierre

Pantalla: Registro con «Exportar CSV».

> «41 casos de prueba, 0 pagos indebidos. Cientos de pruebas automáticas, incluida una que comprueba que, si el motor dice pagar, la guardia independiente está de acuerdo. Centinela: tu agente paga, tú decides.»

## Antes de grabar

- Reinicia la demo y reproduce el escenario base para que el video empiece limpio.
- Si hay `ANTHROPIC_API_KEY`, sube además una factura propia en vivo (por ejemplo, una foto) para mostrar lectura real.
- Graba a 1440×900.
