# Pitch

El guion del video de 3 minutos está en [GUION-VIDEO.md](GUION-VIDEO.md). Aquí: la versión de 60 segundos, las cifras que se pueden decir y las preguntas probables del jurado.

## 60 segundos

Misma línea que el video: primero su problema, después lo que gana, y la técnica solo como prueba.

> «Si llevas las finanzas de una startup en Estados Unidos con proveedores en Latinoamérica, las facturas te llegan por PDF, correo, foto de WhatsApp o chat. Y con cada una, la misma duda: ¿esta ya la pagué? ¿Por qué me cambiaron la cuenta? ¿Esto es lo que acordamos? Pagar es fácil. Saber qué pagar, no.
>
> Centinela revisa cada factura por ti y te dice qué hacer: pagarla, frenarla o pasártela con una pregunta concreta y su porqué. Lo normal se resuelve solo; tú solo miras lo dudoso.
>
> ¿Por qué confiar? La IA solo lee, dos veces y citando el documento; decide la política de tu empresa, escrita en código, y otra revisión independiente vuelve a mirar cada aprobación.
>
> Lo medimos con Claude real, en facturas de prueba realistas: cuarenta y una de cuarenta y una correctas, y veinticuatro resueltas solas. En otras cien, noventa y ocho, y las dos que falló las mandó a revisar. De cuarenta y dos intentos de engañarlo, no pagó ninguno. Menos de un centavo por factura. Centinela no mueve dinero. Ante la duda, no paga: te pregunta.»

## Frases clave

- «Pagar es fácil. Saber qué pagar, no.»
- «Lo normal se resuelve solo; tú solo miras lo dudoso.»
- «Ante la duda, no paga: te pregunta.»
- «El modelo lee; la política de la empresa decide.»
- «No prometemos leer perfecto: prometemos que un error de lectura no se convierte en un pago.»

## Cifras (las únicas que se dicen)

Con Claude real, perfil por defecto (Haiku 5.5 dos veces, prompts `v6`/`v6b`), 18 de octubre de 2026. Reportes: [live-economico-v6.md](../eval/reports/live-economico-v6.md), [stress-live-economico-muestra100-v6.md](../eval/reports/stress-live-economico-muestra100-v6.md) y [REDTEAM.md](REDTEAM.md).

- **41 de 41 correctas** (IC 95 %: 91–100 %, Clopper-Pearson).
- **13 de 13 en el set reservado.** No es a ciegas: varias pruebas automáticas también usan esos casos.
- **24 de 41 resueltas solas**, todas correctas: pagó o frenó sola las 24 que debía decidir sola. Escaló las 17 que piden una persona, ninguna de más.
- **98 de 100 en una muestra del set de estrés**: 0 pagos indebidos en 68 trampas. Las 2 fallas fueron escaladas de más.
- **0 de 42 ataques del equipo rojo pagados.**
- **0 pagos indebidos en todas esas corridas.** Con 23 + 68 trampas, eso no prueba que la tasa sea cero: con 95 % de confianza, la real podría llegar a ~3 % (regla de tres: 3 ÷ 91).
- **Unos USD 0,003 por factura** (USD 0,11 las 41). En voz: «menos de un centavo por factura».
- **2.207 pruebas automáticas.**

## Qué se puede decir y qué no

| Sí | No |
|---|---|
| «Facturas de prueba realistas de una empresa ficticia» | «Facturas reales», «clientes reales» |
| «Dos lecturas de Claude, con instrucciones distintas» | «Dos modelos independientes» |
| «Si detecta una instrucción escondida, escala; si no la detecta, no puede saltarse la política» | «Inmune a prompt injection» |
| «Set reservado para medir» | «Set a ciegas», «nunca se usó para ajustar nada» |
| «Ningún pago indebido en nuestras pruebas» | «100 % preciso», «cero riesgo», «nunca se equivoca» |
| «Las dos que falló las mandó a revisar» | «No falla» |
| «La cuenta no es la registrada», «beneficiario permitido» | «Detecta fraude» |
| «Las etiquetas las redactó Claude como borrador; falta revisarlas» | «Las etiquetas las fijaron personas» |
| «Compara con la ficha del proveedor» | «Verificado ante la DIAN o el SAT» |
| «Te dice qué pagar y por qué», «entrega una decisión con su porqué» | «Paga facturas», «mueve dinero», «integrado con Blinka» |
| «Veinticuatro de cuarenta y una se resolvieron solas» | Cualquier porcentaje de autonomía |

## Preguntas probables

**¿Esto es un agente o un motor de reglas?**
Un agente. Percibe con Claude, decide con la política, se revisa, registra y pide permiso. El motor de reglas es su política: la parte que no improvisa. En pagos, eso es lo que da confianza.

**¿Qué pasa si la IA lee mal?**
Puede pasar. Por eso lee dos veces y cada dato trae su cita. Si las lecturas no coinciden, si las sumas no cuadran o si un dato leído no aparece en el texto del documento (cuando lo trae; en una foto no se puede), escala. Para que un error termine en pago, las dos lecturas tendrían que equivocarse igual y aun así cuadrar con el acuerdo, con lo ya pagado y con la cuenta registrada.

**¿Cuáles fueron las dos fallas de la muestra de 100?**
Dos escaladas de más: una foto donde las dos lecturas no coinciden y una cuenta de cobro sin horas legibles. Costaron una revisión, no un pago.

**¿Y una foto borrosa?**
No adivina el monto. Si el total no se lee con claridad, escala a una persona. En la demo es B17: «No se leen con claridad: total».

**¿Qué ataques probaron?**
42: instrucciones escondidas, engaño visual, lógica de pagos y documentos que no son un cobro. Con el código final no se pagó ninguno. Siete lograron un pago en alguna versión anterior: entre ellos, una factura dirigida a otra empresa, una proforma y una foto con marca de agua «BORRADOR». Quedaron cerrados en código sin IA, con prueba. Detalle en [REDTEAM.md](REDTEAM.md).

**¿Cómo encaja con Blinka?**
En Blinka, un beneficiario nuevo queda pendiente hasta que una persona lo aprueba. Su MCP, en acceso anticipado, redacta borradores de transferencias; no las ejecuta. Ninguno de los dos revisa si la factura corresponde a una obligación real. Esa es la capa de Centinela. No hay integración con Blinka: la salida es una decisión con su porqué.

**¿Cuánto cuesta?**
Leer: unos USD 0,003 por factura con el perfil por defecto (USD 0,11 las 41). Con el perfil `calidad` (Sonnet 5.5 + Haiku 5.5), unos USD 0,84 las 41. Decidir, revisar y registrar no usa modelo. El despliegue cabe en los planes gratuitos de Vercel y Neon.

**¿Qué falta?**
Cerrar el ciclo de aprobación humana: Aprobar y Rechazar, con nombre y motivo, como registro nuevo. Destino por riel (CLABE, Pix, CBU, ABA…) en vez de un número genérico. Dígitos de control por riel. Reglas dinámicas que solo restringen. Revisión humana de las etiquetas. Detalle en [PENDIENTES.md](PENDIENTES.md).
