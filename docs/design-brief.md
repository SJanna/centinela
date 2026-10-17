# Brief de diseño: agente que paga facturas (demo para el reto Blinka × 30X)

## 1. Qué les gusta

**Verificado** (sale del CSS, los tokens y las capturas):
- **Modo y color.** blinka.co y app.blinka.co solo tienen modo claro. Fondo papel `#F7F7F4` con grano, tinta `#1C253A` y un único acento cobalto `#2A4BD0`, usado en botones en píldora.
- **Tipografía.** Inter con títulos a peso **450** (nunca bold) y tracking de −0.035 a −0.047em. Antetítulos de 11px en mayúsculas.
- **Montos.** Usan `tabular-nums`, con los centavos al ~70% del tamaño y en gris.
- **Tarjetas.** Tarjetas tipo "hoja" con sombras largas y difusas, de desplazamiento negativo. Radios de 12 a 20px.
- **Sistema de la app.** La app usa un sistema estilo shadcn llamado "beacon", con estados success, warning, danger e info en fondos lavados. Es lo que el jurado ve a diario.
- **Arte.** Una cinta generativa de líneas finas y un globo de puntos que dibuja un arco hacia el país elegido.
- **Patrones.** Acordeones con separadores de 1px y notas legales con superíndices ¹²³.
- **Copy.** Seco, con frases cortas que terminan en punto. Sin emojis ni exclamaciones. CTAs con → o ↗.
- **30X / HackRadar.** Fondo oscuro, lima `#E8FFB7` y una palabra en Playfair italic.

**Inferido:**
- **Sobriedad.** Prefieren lo institucional y sobrio a lo llamativo. La marca pasó de plantillas genéricas (2024) a un sistema propio muy cuidado (2026).
- **IA explicable.** Su producto anterior de deuda inmobiliaria (CRE) marcaba riesgos, emparejaba prestamistas y puntuaba cada operación. Eso sugiere que valoran la IA explicable: el protagonista debe ser el "por qué", no un chat.
- **Encaje sin copia.** Si el panel parece parte de su back office pero con marca propia, se leerá como encaje de producto y no como copia.

## 2. Dirección visual

- **Base.** Un back office editorial en modo claro, construido sobre el sistema "beacon" de la app de Blinka: papel cálido, un único cobalto y cifras grandes y finas.
- **Decisiones.** Cada decisión se lee como una línea de un estado de cuenta: monto, estado en fondo lavado y una frase con superíndices que remiten a las reglas.
- **Único momento oscuro.** El razonamiento del agente va en vidrio oscuro, para que "pensar" se vea distinto de "registrar".
- **Marca propia.** El prototipo lleva un wordmark tipográfico propio, sin logo ni nombre de Blinka.
- **Guiño a 30X.** El lima solo aparece en el chip "AI agent" y en el pie "Hecho en HackRadar 30X".

## 3. Tokens

**Modo:** solo claro, sin selector de tema. Blinka no tiene modo oscuro en su web pública, y así ahorramos tiempo.

```css
@theme {
  --color-paper:#F7F7F4; --color-bed:#F4F6F7;
  --color-surface-0:#FDFDFD; --color-surface-1:#F7F7F7;
  --color-surface-2:#F0F2F4; --color-surface-3:#E9ECF2;
  --color-seam:#E4E6EF;  /* bordes */   --color-line:#DEDFDC; /* separadores sobre papel */
  --color-ink:#191C1F; --color-ink-2:#3A444C; --color-ink-3:#8D969E; --color-faint:#C9C9CD;
  --color-navy:#1C253A; /* títulos */   --color-muted:#656975;
  --color-accent:#2A4BD0; --color-accent-hover:#2342BD;
  --color-accent-wash:#ECEFF9; --color-lavender:#B9C8FF;
  --color-night:#111720; --color-lime:#E8FFB7; /* solo dos usos */
  --font-sans:var(--font-inter); --font-mono:var(--font-geist-mono);
  --ease-out:cubic-bezier(.32,.72,0,1);
}
```

**Colores de estado**

| Estado | Texto | Fondo (wash) | Punto | Etiqueta |
|---|---|---|---|---|
| PAGAR | `#007456` | `#DFF3EE` | `#00A87E` | "Pagada." |
| FRENAR | `#BC303C` | `#FAEAEB` | `#E23B4A` | "Frenada." |
| ESCALAR | `#9D5201` | `#FBEFE1` | `#EC7E01` | "Escalada." |
| Procesando | `#3162C2` | `#E9EEF9` | `#376CD5` | "Revisando…" |
| Instrucción sospechosa | `#8A1C24` | marcador `#FFF1B8` | subrayado ondulado `#E23B4A`; badge sólido `#B3413B` con texto blanco | "Instrucción sospechosa" |

**Tipografía** (con `next/font/google`):
- **Inter variable.** No fijar `weight`, para conservar el eje variable y poder usar 450.
- **Geist Mono 400/500.** Para IDs, cuentas (`•••• 4821`), códigos de regla y el razonamiento.
- **Playfair Display italic.** Solo en una palabra del estado vacío inicial.

| Rol | Tamaño / interlineado | Peso | Tracking |
|---|---|---|---|
| Display | 44/1.08 | 450 | −0.045em |
| H1 | 30/1.15 | 450 | −0.035em |
| H2 | 20/1.25 | 450 | −0.02em |
| Cuerpo | 14/1.55 | 400 | 0 |
| Secundario | 13/1.5, en `ink-2` | 400 | 0 |
| Antetítulo | 11, mayúsculas, en `muted` | 500 | +0.1em |
| Monto KPI | 32, con centavos a 22 en `ink-3` y `tabular-nums` | 450 | −0.045em |

**Radios:** 6 en chips de riel, 12 en filas e inputs, 16 en tarjetas secundarias, 20 en paneles y 999 en botones y chips. Nunca más de 20.

**Sombras:**
- **sheet:** `0 2px 3px #1C253A05, 0 22px 55px -28px #3948613B`, con borde de 1px `#FFF` y fondo `linear-gradient(120deg,#FFF,#FAFBFC)`.
- **pop:** `0 2px 6px -2px #1116221A, 0 28px 64px -16px #11162242`.
- **modal:** `inset 0 0 0 1px #E4E6EF, 0 26px 64px -16px #1116224D`.
- **Vidrio oscuro:** `rgba(15,20,28,.84)`, `blur(28px) saturate(.45)` y borde `rgba(183,195,211,.19)`.

**Espaciado:**
- Base de 4px.
- Sidebar de 240px y header de 64px.
- Margen lateral de página de 32px y padding de tarjeta de 20 a 24px.
- Separaciones de 16 o 24px y un ancho máximo de 1280px.

## 4. Componentes

- **Sidebar y header**
  - **Sidebar.** Va sobre el papel, con un borde de 1px en `line`. Lleva un wordmark propio en Inter 500 con un punto cobalto.
  - **Ítems.** 13px/450 en `ink-2`, con iconos lucide de 16px y trazo 1.5. El activo lleva fondo `surface-0` y radio 12.
  - **Header.** Fijo, con `rgba(247,247,244,.9)` y `blur(14px)`. Contiene el breadcrumb, la cuenta "USD •••• 4821" en mono, el chip lima "AI agent" con un punto que respira y el botón píldora cobalto "Subir facturas ↗".
- **KPIs**
  - **Fondo restante.** Una hoja grande que ocupa 2 columnas, apoyada sobre un "estudio" de degradado mate (`linear-gradient(130deg,#E4E8E7,#E5E8EF 80%,#DCE1E9)`) con la cinta generativa asomando detrás. Muestra el monto grande y una barra de consumo del presupuesto con la marca del umbral.
  - **Pagado, Frenado y Escalado.** Cada tarjeta lleva antetítulo, monto, una línea tipo "12 facturas" y su punto de estado.
  - **Autonomía.** Un porcentaje grande con una barra segmentada en los tres colores de estado.
- **Tablero de facturas**
  - **Columnas.** Pagar, Frenar y Escalar. Cada cabecera muestra el punto, el conteo y el total en mono.
  - **Tarjeta de factura.** Radio 12, fondo `surface-0` y borde `seam`. Contiene:
    - avatar con iniciales de 32px;
    - proveedor en 14/500;
    - ID en mono de 12px;
    - monto con los centavos atenuados;
    - chip de riel con bandera SVG circular (SPEI · MX);
    - una línea de motivo con superíndices ("Monto sobre el límite²").
  - **Vista lista.** Se puede alternar con una lista de filas de 64px. La fila activa lleva fondo `#F5F7FC` y borde `#E0E6F0`.
- **Chip de decisión.** Píldora de 24px de alto, en 12/500, con fondo lavado, punto de 6px y texto en el color del estado.
- **Detalle (dos columnas, 55/45)**
  - **Izquierda.** La factura como una hoja blanca con sombra `sheet`. Los campos extraídos se subrayan en cobalto al pasar el cursor.
  - **Cabecera derecha.** Chip grande, monto, confianza y una frase de "Por qué" con superíndices ¹²³ enlazados a las reglas.
  - **Comprobaciones.** Una por fila, en este formato:
    - círculo de 20px con ✓ `#00A87E`, ✗ `#E23B4A` o ! `#EC7E01`;
    - título en 14/500;
    - explicación en 13px;
    - código de regla `R-03` en mono, a la derecha.
  - **Razonamiento del agente.** Debajo de las comprobaciones, un panel plegable de vidrio oscuro con texto mono de 12.5px en `#E9EDF1`.
  - **Acciones.** "Aprobar pago →" en cobalto; "Escalar" y "Rechazar" como botones fantasma.
  - **Opcional.** Un mapa de puntos con un arco USD → MXN.
- **Texto sospechoso**
  - **En la hoja.** El fragmento inyectado lleva fondo marcador `#FFF1B8`, subrayado ondulado `#E23B4A` y una bandera en el margen.
  - **Callout al pasar el cursor.** "Intenta cambiar la cuenta destino. El agente la ignoró."
  - **Avisos.** Una barra fina en color danger arriba del detalle, y en las comprobaciones una ✗ "Instrucción embebida detectada".
- **Editor de reglas**
  - **Estructura.** Un acordeón con separadores de 1px y el número de cada regla en mono.
  - **Reglas.** Se escriben en lenguaje natural, con parámetros en píldoras editables: "Pagar sin aprobación si el monto es menor a [$5,000] y el proveedor está [verificado]".
  - **Controles.** Interruptor en cobalto. La acción elegida va con fondo `#F3F5FD`, borde `accent` y check circular relleno.
  - **Pie.** "Afecta a 7 facturas este mes."
- **Proveedores**
  - **Tabla.** Sin filas alternadas de color, con filas de 56px y separador `seam`.
  - **Columnas.** Proveedor con bandera, riel, cuenta en mono, verificación, facturas, total (alineado a la derecha) y última actividad.
  - **Alerta.** Un chip warning "Cuenta cambió hace 2 días".
- **Subida**
  - **Zona de arrastre.** Borde punteado de 1.5px en `faint`, radio 20 y fondo `surface-1`. Al arrastrar encima, el borde pasa a cobalto y el fondo a `accent-wash`.
  - **Progreso.** Cada archivo se convierte en una fila con los pasos "Leyendo → Extrayendo → Reglas → Decisión" y una barra de 2px.
- **Estados vacíos**
  - **Formato.** Líneas finas en `line` o `lavender`, una frase con punto ("Sin facturas por revisar.") y un CTA en píldora.
  - **Primer uso.** "Tu agente *paga*. Tú decides.", con "paga" en Playfair italic.

## 5. Microinteracciones y momentos "wow"

1. **Las facturas caen en su columna.** Con un `layoutId` compartido de framer-motion, la tarjeta pasa de la fila de subida a su columna. Spring de 380/32 y escalonado de 250ms. El conteo y el total de la columna suben con animación.
2. **Escaneo.** Una línea cobalto en degradado recorre la miniatura de la factura mientras aparecen las comprobaciones, con escalonado de 120ms y los iconos dibujándose con `pathLength`.
3. **Marcador.** El resaltado sospechoso se pinta de izquierda a derecha (`background-size` de 0 a 100% en 400ms). Después, el chip pasa de "Revisando…" a "Frenada." con un fundido cruzado.
4. **Hover bidireccional.** Al pasar el cursor por una comprobación se ilumina el campo en la hoja, y al revés.
5. **KPIs.** Los contadores arrancan en 0 (800ms, `cubic-bezier(.23,1,.32,1)`) y los segmentos de autonomía crecen.
6. **Cinta generativa.** Unos 80 paths senoidales con trazo de `lavender` a `accent` al 35%, a la deriva en ciclos de 24s.
7. **Toast.** Con sombra `pop`: "Pagada. $4,250.00 a Andina Logística SAS vía SPEI."
8. **Ritmo general.** Todas las transiciones entre 150 y 180ms con `--ease-out`, respetando `prefers-reduced-motion`.

## 6. Qué evitar

- **Color y estilo.** Nada de semáforo saturado, degradados violeta-rosa ni neón. El vidrio, solo en su panel.
- **Copy.** Sin emojis (tampoco banderas emoji) y sin exclamaciones.
- **Forma.** Nada de títulos en bold 700, sombras duras, radios de más de 20 ni el aspecto por defecto de shadcn.
- **Marca.** No usar el logo ni el nombre de Blinka como marca del prototipo.
- **Acentos.** El lima, solo en sus dos usos. Playfair, solo en su palabra.
- **Pantalla principal.** No debe ser un chat.
- **Datos.** Nada de Lorem ipsum: usar proveedores LatAm creíbles, montos en USD reales y rieles reales.
- **Tema.** No implementar modo oscuro completo ni selector de tema.