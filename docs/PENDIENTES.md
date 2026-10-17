# Lo que necesita intervención del equipo

En orden de prioridad.

## 1. Clave de Anthropic y evaluación con lectura real

Todo lo medido hasta ahora usa **lectura simulada**: prueba la lógica de decisión, no la calidad de lectura de los modelos. Sin clave no se pudo correr la lectura real.

1. Crea `.env.local` con `ANTHROPIC_API_KEY=...`.
2. Ejecuta `npm run eval:live` (costo estimado: menos de USD 2; las lecturas quedan en `dataset/reading-cache/`).
3. Revisa `eval/reports/latest.md`:
   - **Pagos indebidos** debe ser 0. Si no lo es, es el problema número uno.
   - **Escaladas de más**: casos que debían pagarse o frenarse y se escalaron. La verificación de citas es estricta a propósito. Si escala demasiado, el ajuste está en `src/extract/assess.ts` y el prompt en `src/extract/prompt.ts` (sube `PROMPT_VERSION` al cambiarlo).
4. Haz commit de `dataset/reading-cache/` para que la CI pueda correr `npm run eval:cache` sin costo.

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

## Riesgos conocidos (decisiones conscientes, documentadas)

- **Límite mensual y fondo entre instancias de Vercel.** Los duplicados están protegidos en la base con índices únicos. El límite del mes y el fondo dependen de un candado por proceso: dos personas subiendo a la vez en dos instancias distintas podrían, en teoría, pasarse del límite. La interfaz sube de a una factura. Ver [ARCHITECTURE.md](ARCHITECTURE.md#pago-doble-entre-instancias).
- **«Reiniciar demo» borra el registro.** Es una función de demo. Después de reiniciar, la misma factura se puede volver a pagar.
- **Autonomía en el escenario base: 52 %.** Es baja a propósito: 11 de las 23 facturas son trampas que deben escalarse. El escenario «reservado» y facturas normales adicionales la suben. Si quieren que el video muestre más autonomía, agreguen casos normales al set.
- **Texto extraído de títulos con letras espaciadas** sale unido («TOTALAPAGAR») en la pestaña «Texto extraído». No afecta decisiones.
