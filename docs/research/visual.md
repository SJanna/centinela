# Análisis visual: Blinka, app.blinka.co, 30X y HackRadar

Revisé los cuatro sitios a 1366×860 con capturas, scroll y estilos computados reales. HackRadar está en `hackradar.30x.com`; `hackradar.co` y `hackradar.com` no cargan. No escribí en ningún campo, no envié formularios y no apareció ningún banner de cookies. La única interacción fue un clic en la demo de rutas de pago de blinka.co. La pestaña quedó cerrada y el viewport restablecido.

Las capturas están en `/Users/sjanna/.claude/projects/-Users-sjanna-Library-Application-Support-Claude-scratch-workspaces-4a5d7a1f-aca2-40a3-9a0b-ff8426f31ee9-d822530c-6687-43ff-9d4a-d5020d21dc93-scratch-2026-10-17-bf4090/a3d2a844-ab8b-439c-baf7-79a80cc29c62/tool-results/`:

| Archivo | Contenido |
|---|---|
| `…1792211304049-4aiu02.jpg` | Hero de Blinka |
| `…1792211313931-vahh15.jpg` | Galería de producto |
| `…1792211313931-8m86y7.jpg` | Tarjeta Visa y Treasury |
| `…1792211331473-qfnch7.jpg` | Globo de pagos |
| `…1792211386747-guy80h.jpg` | Globo girado tras clic en México |
| `…1792211331473-ge5vrx.jpg` | Back office |
| `…1792211339546-3rvh4q.jpg` | Sección oscura de formulario |
| `…1792211339546-ez8szo.jpg` | Footer legal |
| `…1792211400219-nztjos.jpg` | Login de app.blinka.co |
| `…1792211442503-0yvfi5.jpg` | Hero de 30X |
| `…1792211454809-2fru58.jpg` | Carrusel de mentores |
| `…1792211466024-my0y0h.jpg` | Tarjeta de métricas |
| `…1792211454809-gf9d57.jpg` | Programas |
| `…1792211474411-zcwrzz.jpg` | Testimonios |
| `…1792211474412-433h20.jpg` | Footer de 30X |
| `…1792211590661-ea31ox.jpg` | Login de HackRadar |

---

## 1. blinka.co (home)

**Layout y densidad**
- Página de unos 5570px, en un contenedor de unos 1200px con márgenes muy generosos. Ritmo editorial y sobrio.
- **Header** fijo de 88px:
  - Sobre fondo claro: `rgba(247,247,244,.93)` con `backdrop-filter: blur(14px)`.
  - Sobre secciones oscuras pasa a `rgba(17,23,32,.94)`.
  - Logo a la izquierda, 4 enlaces al centro (13px/400), "Sign in" y un botón pill "Get started ↗" a la derecha.
- **Secciones, en orden:**
  1. Hero en dos columnas. Texto a la izquierda; a la derecha un SVG de 144 líneas finas con trazo en degradado que forman una cinta torcida azul-gris (840×775). El fondo lleva textura de papel con ruido SVG `feTurbulence` en `::before`.
  2. "Trusted by": marquee de logos en gris (`launch-client-drift`, 45s).
  3. Galería de producto: tres "estudios" de UI flotante sobre fondos de degradado mate.
     - Cuenta USD con saldo y actividad.
     - Tarjeta Visa negra con recibo.
     - Mover a Treasury, con selector de fondos BNY / Morgan Stanley.
  4. "Global payments.": a la izquierda un directorio de rutas con banderas (ACH & Wire, SWIFT, SEPA, PSE, Pix, SPEI…); a la derecha un globo de puntos en canvas que gira al país elegido y dibuja un arco. Lo comprobé con México: "USD → MXN".
  5. "Your financial back office.": acordeón con separadores de 1px (Invoicing / Vendor management / Accounting) y "Works with QuickBooks · stripe".
  6. Bloque oscuro "Tell us about your business." con un panel de vidrio oscuro y opciones tipo radio.
  7. Footer oscuro con notas legales numeradas (¹ ² ³) referenciadas como superíndices en el copy.

**Paleta real** (variables `:root` del sitio)

| Rol | Variable | HEX |
|---|---|---|
| Papel (fondo) | `--launch-paper` | `#F7F7F4` |
| Tinta (texto, H1/H2) | `--launch-ink` | `#1C253A` |
| Acento (CTA) | `--launch-accent` | `#2A4BD0` (hover `#2342BD`) |
| Muted | `--launch-muted` | `#656975` (el color de texto más usado) |
| Línea | `--launch-line` | `#DEDFDC` |

Otros colores:
- Eyebrow `#5C6474`; tinta de los mockups `#191C1F`; saldo `#47525D`; "Completed" en verde `#007456`.
- Sobre oscuro: fondo `#111720` con radial `#232B35 → #171E28 → #111720`; texto `#E9EDF1`, nav `#B2BBC7`, eyebrow `#D0D9E4`, H2 `#F7F7F4`.
- Fondos de los estudios de producto (degradados mate):
  - Cuenta: `radial(at 8% 5%, #F9F9F5) + linear(130deg, #E4E8E7, #E5E8EF 80%, #DCE1E9)`.
  - Tarjeta: `linear(135deg, #E9E9E6, #EEF0F2 60%, #DFE3E6)`.
  - Treasury, con tono verde salvia: `linear(128deg, #EAF0EA 14%, #E0E9E4 63%, #CBDAD3)`.

**Tipografía**
- Fuente "Blinka Inter": Inter variable 100–900 con otro nombre. "Geist Mono Variable" está declarada pero no se carga en la home.
- Rasgo clave: los títulos usan peso **450**, no bold, con tracking muy negativo.

| Elemento | Tamaño / interlineado | Peso | Tracking | Color |
|---|---|---|---|---|
| H1 | 60px / 1.07 | 450 | −2.8px (≈−0.047em) | `#1C253A` |
| H2 | 44–48px / 1.1 | 450 | −1.5 a −1.9px | `#1C253A` |
| H2 sobre oscuro | 60px | 430 | −3.3px | `#F7F7F4` |
| H3 de tarjeta | 28px | 450 | −0.98px | — |
| H3 pequeño | 15px | 450 | −0.3px | — |
| Lead | 15px / 1.65 | — | — | `#656975` |
| Eyebrow (MAYÚSCULAS) | 11px | 500 | 1.1px | `#5C6474` |
| Botón | 14px | 500 | — | — |
| Nav | 13px | 400 | — | — |

- **Montos:** `font-variant-numeric: tabular-nums`, tracking ≈−0.045em, y los **centavos a ~70% del tamaño**. Ejemplos: "$184,418" a 30px con ".60" a 21px; "$25,000" a 49px/500 con ".00" a 33px.

**Radios:** 2px (los más frecuentes), 6px, 12px (filas y opciones), 16px y 20px (tarjetas y paneles), 999px (botones) y 50% (iconos y banderas).

**Sombras:** largas, difusas y con desplazamiento negativo; nunca duras.
- Hoja de cuenta: `0 2px 3px rgba(28,37,58,.02), 0 22px 55px -28px rgba(57,72,97,.23)`, borde 1px `#FFF`, fondo `linear(120deg, #FFF, #FAFBFC)`, radio 20.
- Recibo: `0 1px 3px rgba(38,54,74,.03), 0 18px 40px -20px rgba(38,54,74,.35)`, radio 16, fondo `#FDFDFD`.
- Tarjeta de transferencia: tres capas, `0 1px 2px rgba(28,37,58,.03), 12px 20px 30px -18px rgba(28,37,58,.24), 30px 45px 55px -36px rgba(28,37,58,.27)`.
- Panel de vidrio oscuro: fondo `rgba(15,20,28,.84)`, `backdrop-filter: blur(28px) saturate(.45)`, borde `rgba(183,195,211,.19)`, radio 20, sombra `0 24px 80px -32px rgba(4,14,28,.5)` más un brillo interior de 1px.

**Componentes de UI dentro del marketing** (directamente reutilizables)
- **Fila de actividad destacada:** fondo `#F5F7FC`, borde `#E0E6F0`, radio 12, 76px de alto. Icono de flecha en un cuadrado tenue, título y "Incoming wire • Completed", monto grande a la derecha.
- **Selector de fondo:** seleccionado con fondo `#F3F5FD`, borde 1px `#2A4BD0` y check circular azul relleno; no seleccionado con fondo `#F0F2F4` y radio vacío. Radio 12, 59px de alto.
- **Ruta de pago activa:** fondo `rgba(42,75,208,.047)`, radio 6.
- **Opciones del formulario oscuro:** fondo `rgba(115,130,150,.07)`, borde `rgba(146,159,179,.16)`, radio 12; en hover `.13` y `.3`.

**Microinteracciones**
- Botones con transición de `background` y `box-shadow` en 0.18s.
- Opciones con transición de borde y fondo en 0.16s.
- Globo que rota hacia el destino seleccionado.
- Acordeón con iconos +/−.
- Fondos con deriva lenta: `booking-scene-drift` 32s y `booking-fold-drift` 24s.
- Marquee de logos.

**Tono del copy:** inglés, institucional y seco. Frases cortas que terminan en punto ("Global payments.", "High-yield Treasury.", "Your financial back office."). Sin emojis ni exclamaciones. Notas legales con superíndices numerados. CTAs con flecha → o ↗ ("Talk to our team ↗").

---

## 2. app.blinka.co (solo login)

**Layout**
- Pantalla dividida. A la izquierda, columna de unos 380px con logo, título, campos y CTA. A la derecha, un mapamundi de puntos lavanda-gris (`world-dots.svg`) con máscara `linear-gradient(to right, transparent 0%, #000 28%)`.
- Selector de idioma "EN" en pill, con fondo `#F7F7F7`, 34px de alto.
- Al cargar, hay un fade-in.
- Stack: Tailwind v4 con tokens tipo **shadcn** (`--primary`, `--sidebar-*`, `--card`…). Los tokens `--sidebar-*` indican que la app tiene un shell con barra lateral.

**Tipografía:** Inter Variable.
- H1: 30px / 600 / tracking −0.42px, color `#191C1F`.
- Subtítulo: 13px, `#3A444C`.
- Labels: 13px / 500.
- Body: 14px / 21px, tracking 0.16px.

**Inputs y botón**
- Inputs: 44px de alto, radio 12, sin borde, fondo `rgba(31,31,31,.06)`.
- Botón: pill a todo el ancho, 48px de alto, 15px / 500, fondo `#2A4BD0`, transición de 150ms.

**Design system real de la app ("beacon")** — es la fuente más valiosa para el dashboard.

| Grupo | Valores |
|---|---|
| Tinta | ink `#191C1F`, ink-2 `#3A444C`, ink-3 `#8D969E`, faint `#C9C9CD` |
| Superficies | 0 `#FDFDFD`, 1 `#F7F7F7`, 2 `#F0F2F4`, 3 `#E9ECF2`, 4 / seam (bordes) `#E4E6EF`; bed `#F4F6F7`; control `#EAEBEF` |
| Acento | `#2A4BD0`; accent-wash `#ECEFF9`; brand-navy `#1C253A` |
| Estado: success | texto `#007456`, mark `#00A87E`, wash `#DFF3EE` |
| Estado: warning | texto `#9D5201`, mark `#EC7E01`, wash `#FBEFE1` |
| Estado: danger | texto `#BC303C`, mark `#E23B4A`, wash `#FAEAEB` |
| Estado: info | texto `#3162C2`, mark `#376CD5`, wash `#E9EEF9` |
| Charts | `#A8B6FB`, `#818CF9`, `#6468F0`, `#4F46E5`, `#443BC9`; línea `#2A4BD0`; neutral `#737C84`; pending `#EC7E01` |
| Radios | base .875rem (14px); panel y glass 20px; row 12px; input 12px; pill 9999px |
| Elevaciones | pop: `0 2px 6px -2px #1116221a, 0 28px 64px -16px #11162242`. drop: `0 12px 28px -8px #1116223d`. modal: `inset 0 0 0 1px #E4E6EF, 0 26px 64px -16px #1116224d` |
| Vidrio | fill = `color-mix(#F0F2F4 45%, transparent)`, `blur(16px) saturate(1.7)`, borde `#17203a17`, borde superior `#ffffffeb` |
| Brillo de fondo | `--beacon-field-glow`: radiales `#EEF1FC` (−6%,−14%), `#F0F2FB` (104%,2%) y `#F2F3FA` (52%,118%) |
| Movimiento | `--motion-ease: cubic-bezier(.32,.72,0,1)`; ease-out-strong `cubic-bezier(.23,1,.32,1)`; 150ms |
| Modo oscuro | existe, en oklch: surface-0 `oklch(17.5% .006 265)`, accent `oklch(72% .15 266.9)` |

---

## 3. 30x.com

**Layout:** sitio hecho en Framer, de unos 6350px.
- Header negro con logo "30X" en lima y blanco, nav en Inter 15px/500 blanca, badge "Jobs 3" (número en lima) y botón blanco "Acceso Alumnos".
- **Hero negro:**
  - Pill de fechas con borde lima de 1px, fondo oscuro y texto lima 14px/500 ("CCS · 21-23 oct | Bog…").
  - H1 en tres líneas con la del medio en lima.
  - Subtítulo en blanco al 80%.
  - Dos CTAs: lima y blanco.
  - Mapa de LatAm en puntos gris oscuro a la derecha.
- Debajo:
  - Carrusel de 2 filas con fotos y video de mentores (Rappi, KPMG…) y nombre y cargo sobre la imagen.
  - Tarjeta blanca grande (radio 24, sombra `0 1px 22px rgba(0,0,0,.05)`) con titular a dos tonos, foto y 3 tarjetas de métricas con **contador animado** (+0 → +3,934).
  - Tarjetas de programa negras con foto, degradado inferior y botón blanco.
  - Cuadrícula de mentores a sangre.
  - Testimonios en tarjetas `#0A0A0A` (radio 16).
  - 3 filas de logos en marquee.
  - Footer negro.

**Paleta**

| Rol | HEX |
|---|---|
| Negro | `#000000` / `#0A0A0A` |
| Lima (acento) | `#E9FF7B` |
| Pills lima | `rgba(235,255,108,.10)` con `backdrop-filter: blur(4px)` |
| Fondo de página | `#FAFAFA` |
| Secciones | crema cálida `#F7F5F2` |
| Tarjetas | `#FFFFFF` |
| Texto secundario | `#525252`; gris cálido `#868073`; blanco al 80% sobre oscuro |

**Tipografía:** cargan "Inter Display" (400/500/600), Inter (500/600/700), Inter Variable y Manrope (400/600).

| Elemento | Fuente | Tamaño / interlineado | Peso | Tracking | Color |
|---|---|---|---|---|---|
| H1 | Inter Display | 60px / 1.1 | 600 | −3px (−0.05em) | — |
| H2 | Inter Display | 36px | 600 | −1.44px | negro + 2ª línea gris |
| H3 | Inter Display | 28px | 600 | −1.12px | `#525252` |
| Botones | Inter | 16px | 600 | — | `#0A0A0A` |
| Métricas | Inter | 24px | 600 | −0.72px | — |

**Radios:** 12px domina (más de 200 elementos); 8px en botones; 16, 18 y 24px en tarjetas; 9999px en pills.

**Copy:** español, aspiracional y agresivo. Ejemplos: "construyen ventajas injustas", "quienes construyeron unicornios", "crecer 10, 20, 30X". Mucha prueba social (fundadores, logos de unicornios LatAm).

## 4. hackradar.30x.com (solo login)

**Layout:** Next.js con Tailwind v4, todo oscuro.
- Header centrado: "30X | HACKRADAR" con divisor vertical y la palabra en mayúsculas espaciadas.
- Fondo: foto nocturna (`login-hero.webp`) con cielo estrellado, vía láctea y dunas. Encima, una viñeta radial y un resplandor lima en la base: `radial-gradient(110% 60% at 50% 96%, rgba(232,255,183,.13), transparent 62%)`.
- **H1 en serif:** Playfair Display 40px / 700, tracking −0.8px. Contraste editorial.
- Tarjeta-formulario de 440px: fondo `#16181C`, borde 1px `#2E323B`, radio 8, padding 32. Contiene:
  - Caja de icono de 44px (`#23262E`, icono lima).
  - Eyebrow de paso "PASO 1 DE 2": 11px / 600, mayúsculas, tracking 1.32px, `#A9ABA9E`.
  - Input de 48px: fondo `#0B0B0C`, borde `#2E323B`.
  - Botón lima `#E8FFB7` con texto `#0B0B0C`, 15px / 600, radio 8.
- Footer translúcido `rgba(11,11,11,.7)`.

**Tokens**

| Grupo | Valores |
|---|---|
| Base | black `#0B0B0C`; ink `#0E1013`; ink-2 `#16181C`; graphite `#23262E` |
| Texto | paper `#F6F4F1`; soft `#D5D3CE`; muted `#C4C2C3`; dim `#A9AB9E` |
| Acento | lima `#E8FFB7`, hover crema `#FFF7D5`; soft `#e8ffb71f`; borde de acento `#e8ffb740` |
| Bordes | `#2E323B`; strong `#3A3F4A`; structural `#4A505C` |
| Estado | success `#9FD4AE`; warning `#E9C582`; danger `#F2A19B` / solid `#B3413B` |
| Neutros cálidos | moss `#6E7163`; olive `#82876F`; stone `#55554F` |
| Radio | 8px en todo |
| Sombras | float `0 4px 20px #0006`; soft `0 4px 24px #0000003d` |

---

## Qué imitar en el dashboard del agente de pagos

1. **Usar el sistema "beacon" de la app de Blinka como base.** Es lo que el jurado ve a diario y ya trae nombres estilo shadcn, así que encaja directo en Next + Tailwind:
   - Fondo papel `#F7F7F4`, o `#F4F6F7` con el `field-glow` radial.
   - Superficies `#FDFDFD` y `#F7F7F7`; bordes `#E4E6EF`.
   - Tinta `#191C1F` / `#1C253A`; acento único `#2A4BD0`.
2. **Mapear las decisiones del agente a sus estados reales:**

   | Decisión | Texto | Fondo | Punto |
   |---|---|---|---|
   | Pagar | `#007456` | `#DFF3EE` | `#00A87E` |
   | Frenar | `#BC303C` | `#FAEAEB` | `#E23B4A` |
   | Escalar | `#9D5201` | `#FBEFE1` | `#EC7E01` |
   | Procesando | `#3162C2` | `#E9EEF9` | — |

3. **Tipografía al estilo Blinka:**
   - Inter variable con títulos a **peso 450** y tracking de −0.035 a −0.047em; nada de bold pesado.
   - Eyebrows de 11px / 500 en mayúsculas con tracking 0.1em.
   - Montos con `tabular-nums` y **centavos más pequeños** ($25,000<small>.00</small>).
   - Geist Mono para IDs de factura y cuentas (•••• 4821).
4. **Tarjetas tipo "hoja"** (radio 20, borde 1px blanco, degradado `#FFF → #FAFBFC`, sombra larga negativa) apoyadas sobre paneles de **degradado mate** (los gradientes gris-azul y salvia de arriba) para el hero del dashboard: saldo USD y facturas pendientes.
5. **Copiar componentes concretos:**
   - Fila de factura como `pg-activity-row`: icono en cuadrado tenue, proveedor, "Wire • Completed" y monto grande. La fila activa con fondo `#F5F7FC` y borde `#E0E6F0`.
   - Selección de regla o método de pago como `ts-fund-choice`, con borde acento y check circular.
   - Acordeón con separadores de 1px para las reglas.
   - Botones pill `#2A4BD0` con flecha → o ↗.
   - Header sticky con blur(14px).
6. **El "por qué" del agente:**
   - Que la explicación cite las reglas como **superíndices numerados** (¹ ² ³) que remiten a una lista, igual que las notas legales de Blinka.
   - Opcionalmente, un **panel de vidrio oscuro** (`#0F141C` al 84% + blur 28px + borde `rgba(183,195,211,.19)`) para el razonamiento del agente o el modal de escalamiento. Es el único momento oscuro, como su sección "Tell us about your business."
7. **Toques "wow" sin romper la sobriedad:**
   - Mapa o globo de puntos de LatAm con un arco hacia el país del proveedor (USD → COP / MXN) y chips de riel (ACH, SWIFT, PSE, SPEI, Pix) con banderas.
   - Textura de papel con `feTurbulence`.
   - Contadores animados de KPIs al estilo 30X ("facturas procesadas", "$ ahorrado").
   - Transiciones de 150–180ms con `cubic-bezier(.32,.72,0,1)`.
8. **Guiño a 30X / HackRadar con moderación:** el lima `#E8FFB7` / `#E9FF7B` solo en un chip "AI agent" o en el co-branding del footer. No debe competir con el azul de Blinka.
9. **Qué evitar:** degradados saturados, emojis, exclamaciones, sombras duras y radios mayores de 20px. Para el copy de la UI: inglés o español corto, frases con punto ("Paid.", "On hold.", "Escalated.").

Fuentes de la búsqueda web: no confirmó ninguna relación con 30X; encontré el sitio probando el subdominio. [top.gg HackRadar](https://top.gg/ar/bot/1457695413946814540), [Product Hunt – Hackathon Radar](https://www.producthunt.com/products/hackathon-radar)