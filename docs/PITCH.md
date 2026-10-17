# Pitch

## 60 segundos

> «Las empresas de EE. UU. que pagan a proveedores en Latinoamérica reciben facturas por PDF, foto, correo y WhatsApp. Una cuenta en dólares resuelve cómo pagarles. Falta responder si cada factura se debe pagar.
>
> Centinela es un agente que responde eso. Lee cada factura dos veces con Claude, y cada dato trae su cita. Después aplica la política de la empresa: quince comprobaciones en código fijo. Compara la factura con lo acordado, con lo ya pagado y con la cuenta registrada. Una guardia escrita aparte revisa otra vez cada decisión de pagar. Todo queda en un registro que no se modifica, con el porqué en frases. Lo que no cuadra va a una persona, con la acción sugerida.
>
> El modelo lee; no decide. Por eso una factura, por convincente que sea, no puede convencerlo de pagar algo que la política no permite.
>
> Con Claude real, en 41 facturas de prueba: 40 correctas y ningún pago indebido. Unos dos centavos por factura. Centinela no mueve dinero: entrega una decisión con su porqué.»

## Frases clave

- «El modelo lee; la política de la empresa decide.»
- «Una cuenta en dólares resuelve cómo pagar. Centinela responde si se debe pagar.»
- «No prometemos leer perfecto: prometemos que un error de lectura no se convierte en un pago.»
- «Ante la duda, no paga: pregunta.»

## Cifras (las únicas que se dicen)

Con Claude real, 41 facturas de prueba, 17 de octubre ([eval/reports/live.md](../eval/reports/live.md)):

- 40 de 41 correctas (IC 95 %: 87–99,9 %).
- 0 pagos indebidos: de las 23 que no debían pagarse, no pagó ninguna. Con 23 casos y 95 % de confianza, la tasa real podría llegar a ~13 % (regla de tres: 3 ÷ 23).
- 13 de 13 en el set reservado. No es a ciegas: varias pruebas automáticas también usan esos casos.
- Decidió sola 23 de 41 (todas correctas) y escaló 18: 17 a propósito y 1 de más.
- USD 0,84 por las 41 (unos 2 centavos por factura).
- Más de 1.100 pruebas automáticas.

## Qué se puede decir y qué no

| Sí | No |
|---|---|
| «Facturas de prueba realistas de una empresa ficticia» | «Facturas reales», «clientes reales» |
| «Dos lecturas con dos modelos de Claude» | «Dos modelos independientes» |
| «Si detecta una instrucción escondida, escala; si no la detecta, no puede saltarse la política» | «Inmune a prompt injection» |
| «Set reservado para medir» | «Set a ciegas», «nunca se usó para ajustar nada» |
| «0 pagos indebidos en 23 casos» | «100 % preciso», «cero riesgo», «nunca se equivoca» |
| «La cuenta no es la registrada», «beneficiario permitido» | «Detecta fraude» |
| «Las etiquetas las redactó Claude como borrador; falta revisarlas» | «Las etiquetas las fijaron personas» |
| «Compara con la ficha del proveedor» | «Verificado ante la DIAN o el SAT» |
| «Entrega una decisión con su porqué» | «Paga facturas», «mueve dinero», «integrado con Blinka» |
| «Decidió sola 23 de 41» | Cualquier porcentaje de autonomía |

## Preguntas probables

**¿Esto es un agente o un motor de reglas?**
Un agente. Percibe con Claude, decide con la política, se revisa, registra y pide permiso. El motor de reglas es su política: la parte que no improvisa. En pagos, eso es lo que da confianza.

**¿Qué pasa si la IA lee mal?**
Puede pasar. Por eso lee dos veces y cada dato trae su cita. Si las lecturas no coinciden, si las sumas no cuadran o si un dato leído no aparece en el texto del documento (cuando lo trae; en una foto no se puede), escala. Para que un error termine en pago, las dos lecturas tendrían que equivocarse igual y aun así cuadrar con el acuerdo, con lo ya pagado y con la cuenta registrada.

**¿Cómo encaja con Blinka?**
En Blinka, un beneficiario nuevo queda pendiente hasta que una persona lo aprueba. Su MCP, en acceso anticipado, redacta borradores de transferencias; no las ejecuta. Ninguno de los dos revisa si la factura corresponde a una obligación real. Esa es la capa de Centinela. No hay integración con Blinka: la salida es una decisión con su porqué.

**¿Por qué escaló B05?**
Era un cobro correcto por chat, USD 2.800. Una lectura incluyó la letra del tipo de comprobante en el número («E 0003-00000871») y la otra no. Al no coincidir, escaló. Costó una revisión, no un pago. Se puede corregir aclarándolo en el prompt; todavía no está hecho.

**¿Cuánto cuesta?**
Leer: USD 0,84 por las 41 facturas, unos 2 centavos cada una. Decidir, revisar y registrar no usa modelo. El despliegue cabe en los planes gratuitos de Vercel y Neon.

**¿Qué falta?**
Cerrar el ciclo de aprobación humana: Aprobar y Rechazar, con nombre y motivo, como registro nuevo. Destino por riel (CLABE, Pix, CBU, ABA…) en vez de un número genérico. Dígitos de control por riel. Reglas dinámicas que solo restringen. Revisión humana de las etiquetas. Detalle en [PENDIENTES.md](PENDIENTES.md).
