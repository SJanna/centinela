# Lo que necesita intervención del equipo

En orden de prioridad.

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
   - Una sola cifra de autonomía: «24 de 41 resueltas solas, todas correctas; las demás escaladas a propósito». Hoy conviven 100 % (reporte), 58,5 % (set) y 52 % (pantalla).
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

## Riesgos conocidos (decisiones conscientes, documentadas)

- **Límite mensual y fondo entre instancias de Vercel.** Los duplicados están protegidos en la base con índices únicos. El límite del mes y el fondo dependen de un candado por proceso: dos personas subiendo a la vez en dos instancias distintas podrían, en teoría, pasarse del límite. La interfaz sube de a una factura. Ver [ARCHITECTURE.md](ARCHITECTURE.md#pago-doble-entre-instancias).
- **«Reiniciar demo» borra el registro.** Es una función de demo. Después de reiniciar, la misma factura se puede volver a pagar.
- **Autonomía en el escenario base: 52 %.** Es baja a propósito: 11 de las 23 facturas son trampas que deben escalarse. El escenario «reservado» y facturas normales adicionales la suben. Si quieren que el video muestre más autonomía, agreguen casos normales al set.
- **Texto extraído de títulos con letras espaciadas** sale unido («TOTALAPAGAR») en la pestaña «Texto extraído». No afecta decisiones.
