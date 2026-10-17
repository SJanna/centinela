# Identidad visual de 30X (30x.com, hackathon.30x.com, HackRadar)

Los valores salen del HTML y CSS reales que descargué con curl, y los comprobé con capturas en el navegador. 30X tiene **dos lenguajes visuales**:
- **30x.com**: hecho en Framer, con un lima saturado.
- **hackathon.30x.com y HackRadar**: hechos en Next.js y Tailwind. Comparten los mismos tokens: un lima pastel, crema y grafito. **Este es el más cercano al jurado y el que conviene imitar.**

## 1. HackRadar (hackradar.30x.com): la plataforma del hackathon
- **Meta y tema:** `<meta name="theme-color" content="#0b0b0c">` y título "HackRadar 30X". El modo oscuro está forzado con `color-scheme: dark`. El cuerpo de la página lleva `data-ui="public-glass-shell"`.
- **Tokens `:root` reales:**
  - Fondos y superficies: `--brand-black:#0b0b0c`, `--brand-ink:#0e1013`, `--brand-ink-2:#16181c` (que es `--surface`) y `--brand-graphite:#23262e` (que es `--surface-raised`).
  - Neutros cálidos: `--brand-stone:#55554f`, `--brand-moss:#6e7163`, `--brand-olive:#82876f`.
  - Acento: `--brand-lime:#e8ffb7`. Es el `--accent`, y el texto sobre él va en `#0b0b0c`.
  - Claros: `--brand-cream:#fff7d5` (es el hover del acento) y `--brand-paper:#f6f4f1` (es `--foreground` y `--on-dark`).
  - Textos: `--brand-text-soft:#d5d3ce`, `--brand-text-muted:#c4c2c3`, `--brand-text-dim:#a9ab9e`.
  - Bordes: `--border:#2e323b`, `--border-strong:#3a3f4a`, `--border-structural:#4a505c`, `--border-accent:#e8ffb740`. El acento suave es `--accent-soft:#e8ffb71f`.
  - Estados: success `#9fd4ae` (soft `#9fd4ae21`), warning `#e9c582` (soft `#e9c58224`), danger `#f2a19b` (soft `#f2a19b24`, sólido `#b3413b`) y cyan `#a9c8de` (soft `#a9c8de21`).
  - Gradientes de marca: `--brand-gradient-dark: linear-gradient(90deg,#0b0b0c 0%,#23262e 45%,#55554f 100%)` y `--brand-gradient-light: linear-gradient(90deg,#e8ffb7 0%,#f6f4f1 55%,#fff7d5 100%)`.
  - Sombras: `--shadow-float: 0 4px 20px #0006` y `--shadow-soft: 0 4px 24px #0000003d`.
  - Radios: `--radius-sm`, `--radius-md` y `--radius-lg` valen todos `8px`.
- **Tipografía:** Inter para el texto (`--font-sans`) y **Playfair Display** para los títulos (`--font-display`), ambas cargadas con next/font.
  - `.hr-hero`: `clamp(3.5rem,8vw,6rem)`, peso 700, tracking -0.02em, interlineado 1.1.
  - `.hr-h1`: `clamp(2.5rem,5vw,4rem)`, peso 700.
  - `.hr-h2`: 2rem, peso 700.
  - `.hr-lead`: 1.25rem, en color muted.
- **Componentes (clases `hr-*`):**
  - `.hr-panel`: fondo `#16181c`, borde 1px `#2e323b`, radio 8px. Al pasar el ratón, el borde cambia a `#4a505c`.
  - `.hr-field` (inputs): al enfocar, borde lima y `box-shadow: 0 0 0 1px #e8ffb740`.
  - `.hr-eyebrow` (antetítulos): 12px, peso 600, mayúsculas, tracking .12em, en color lima.
  - `.hr-pill`: radio 9999px, borde, fondo grafito, padding 6px 14px.
  - `.hr-check-current`: círculo de 28px en lima con texto negro. `.hr-check-done` es grafito con el check en verde success.
  - `.hr-member-row`: filas en forma de tarjeta, con padding 12px 16px.
  - Botón primario: fondo lima con texto `#0b0b0c`, `h-11 px-5 text-[15px] rounded-lg font-semibold`. Al pasar el ratón cambia a crema `#fff7d5`; al pulsar, `active:scale-[0.98]`; desactivado, `opacity-40`.
  - Cabecera: logo 30X, separador vertical de 1px y "HACKRADAR" en 13px semibold, mayúsculas, tracking .18em.
- **Fondo del login:** una foto de cielo estrellado con dunas. Encima lleva tres capas:
  - un velo radial oscuro, `radial-gradient(56% 40% at 50% 50%, rgb(11 11 12/.7), transparent 72%)`;
  - un **resplandor lima abajo**, `radial-gradient(110% 60% at 50% 96%, rgb(232 255 183/.13), transparent 62%)`;
  - un fundido inferior hacia `#0b0b0c`.
- **Logo** (`/brand/30x-logo-accent.svg`): "30" en `#F6F4F1` y la X en lima `#E8FFB7`.

## 2. hackathon.30x.com (la landing del evento)
- **Meta:** `theme-color #0B0B0C`. Usa los mismos tokens con el prefijo `--c-*`: black, ink, graphite, lime, cream y paper.
- **Bordes y superficies translúcidos de color paper:** `--c-surface:#f6f4f10a`, `--c-border:#f6f4f117`, `--c-border-row:#f6f4f114` y `--c-border-strong:#f6f4f138`.
- **Escala de tipos (escritorio):** display 150px, h2 52px, cita 50px, lead 24px, título de tarjeta 20px, cuerpo 15px y eyebrow 11px. El tracking del eyebrow es .22em y el de los títulos -.025em. `--radius-card` vale 20px y `--radius-pill` 999px. La curva de animación es `--ease-out: cubic-bezier(.22,1,.36,1)`.
- **Firma tipográfica:** los h2 van en Inter **peso 400**, con una palabra en **Playfair italic en lima** (`.it.accent`). Ejemplos: "Construye proyectos *reales.*", "Crecimiento en *horas*, no en trimestres." y "Todos empezamos solos frente a una pantalla. *Aquí no.*" Los números grandes van en peso 300 con un halo suave: `text-shadow: 0 0 70px #f6f4f147`.
- **Glass ("liquid glass"):** `backdrop-filter: blur(18px) saturate(190%)`, con fondo `linear-gradient(#ffffff21,#ffffff0a 30%,#ffffff05 55%,#ffffff17)`. El borde es un conic-gradient enmascarado y lleva brillos inset de varias capas. La barra de navegación es una pastilla de 70px de alto. El elemento activo, `.nav-item.on`, tiene un gradiente blanco translúcido con sombras inset.
- **Botón `.cta`:** una pastilla de 62px de alto con un borde conic animado, un brillo lima en movimiento (`@keyframes shim`) y un halo lima difuminado (`breathe`, con `blur(9px)`). La variante `.cta.light` tiene fondo lima y texto negro.
- **Otros elementos:**
  - Tarjetas numeradas 01–04 sobre superficie translúcida, con borde hairline y radio de unos 20px.
  - Filas de agenda separadas por líneas de 1px.
  - FAQ: al abrir un ítem, el borde pasa a lima y el icono a "×" en lima.
  - Marquesina de logos de partners: Lovable, Makers, Wave y otros.
  - Wordmark "HACKATHON" con estética pixel, con `drop-shadow(0 0 34px #f6f4f142)`.
  - Puntos de estado con `box-shadow: 0 0 12px #e8ffb799`.

## 3. 30x.com (la escuela de negocios; Framer)
- **Colores:** fondo `rgb(10,10,10)` (`#0A0A0A`), texto blanco y secundarios en `rgba(255,255,255,.7)` y `.5`. El **acento es un lima más saturado**: `rgb(235,255,111)` (`#EBFF6F`), con token `#e9ff7b`. Las secciones claras usan `#F7F5F2` y `#FAFAFA`, y el gris es `#525252`.
- **Tipografía:** **Inter Display** para los títulos. El h1 mide 3rem, con peso 600, tracking -0.05em, interlineado 1.1 y `tnum`. El h2 mide 1.8rem con peso 600. El cuerpo va en Inter / Inter Variable y Manrope. Predominan los pesos 500 y 600, a 14 y 12px.
- **Botones:** radio de 8px con `corner-shape: superellipse(1.5)`. El primario es lima con texto `#0A0A0A` en peso 600 ("Aplica Ahora"); el secundario es blanco `#FAFAFA` ("Ver Programas").
- **Tarjetas y efectos:**
  - Las tarjetas tienen radios de 12, 18, 20 o 24px.
  - La sombra es casi nula: `0 1px 22px #0000000d`. Hay algo de `backdrop-filter: blur(4px)`.
  - Los únicos gradientes son fundidos a negro.
  - Los títulos aparecen palabra a palabra, con `blur(10px)` y `translateY(10px)`.
- **Hero:** un mapa de Latinoamérica en matriz de puntos y chips de ciudades con fechas, en borde lima ("CCS · 21-23 oct | Bog…").

## 4. Tono del copy
- Español en tú: directo, frases cortas y contrastes binarios.
  - "No te preparamos para el futuro. Te ponemos a construirlo."
  - "Crecimiento en horas, no en trimestres."
  - "Retos de empresas de verdad, resueltos en un fin de semana."
- Vocabulario de constructor y operador: "construir", "operadores", "ventajas injustas", "quienes construyeron unicornios", "demo day frente a quien decide".
- Aspiracional pero sobrio. No usa emojis en la interfaz, y los microtextos de HackRadar son claros y funcionales ("Paso 1 de 2 · Recibe tu código de acceso").

## 5. Recomendación para nuestro front (Next + Tailwind)
- **Base:** usar los tokens de HackRadar tal cual.
  - Fondo `#0b0b0c`; paneles `#16181c` y `#23262e`; bordes `#2e323b`.
  - Texto `#f6f4f1`, con `#a9ab9e` para lo atenuado.
  - Acción principal en lima `#e8ffb7` con texto negro y hover en crema `#fff7d5`.
- **Estados del agente:** PAGAR en success `#9fd4ae`, ESCALAR en warning `#e9c582` y FRENAR en danger `#f2a19b`, cada uno con su versión soft (alfa de ~13%) como fondo de pastilla.
- **Tipos:** Inter para la interfaz y Playfair Display italic en lima para una palabra clave del hero (por ejemplo, "Tu agente *paga*. Tú decides.").
- **Detalles:**
  - Eyebrows en 11–12px, mayúsculas, tracking .12–.22em.
  - Resplandor radial lima en la parte baja del hero.
  - Navegación con glass (blur 18px, saturate 190%).
  - Números grandes en peso 300 con halo suave.
  - Tarjetas de 8px (estilo app) o de 20px (estilo landing), con bordes hairline y sin sombras pesadas.
  - Botón principal en pastilla con un glow lima discreto.
- **Contexto de Blinka:** blinka.co se vio de pasada en el navegador. Es de modo claro, con botones en pastilla azul cobalto y un gráfico de cinta en wireframe. No contrasta mal si usamos 30X como base oscura y Blinka como acento secundario azul. Sus colores exactos no los extraje.

## Fuentes
- [30x.com](https://30x.com) (HTML de Framer)
- [hackathon.30x.com](https://hackathon.30x.com) (HTML y `/_next/static/chunks/208wkx0b283re.css`)
- [hackradar.30x.com/login](https://hackradar.30x.com/login) (HTML, `/_next/static/chunks/2ac5f47-gtdv4.css` y `/brand/30x-logo-accent.svg`)
- Búsquedas de contexto: [Luma GTM Hackathon (30X/Makers)](https://luma.com/mfxcoval) y [Hackathon Radar en Product Hunt](https://www.producthunt.com/products/hackathon-radar). Este último es otro producto, sin relación con HackRadar 30X.

El HTML y el CSS que analicé están en `/private/tmp/claude-501/-Users-sjanna-Library-Application-Support-Claude-scratch-workspaces-4a5d7a1f-aca2-40a3-9a0b-ff8426f31ee9-d822530c-6687-43ff-9d4a-d5020d21dc93-scratch-2026-10-17-bf4090/a3d2a844-ab8b-439c-baf7-79a80cc29c62/scratchpad/30x/`: `index.html`, `hackradar.html`, `hackradar.css`, `hackathon.html`, `hackathon.css` y `logo-accent.svg`.