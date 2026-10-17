# Fundadores de Blinka, sus productos anteriores y el estilo visual de cada uno

## 1. Resultado principal

No encontré otras empresas ni productos con nombre distinto de "Blinka". Lo que construyeron antes son versiones anteriores de la misma marca y empresa (Blinka Tech Corp, `blinka.co`), con pivotes sucesivos. Portafolio cuenta que pasaron por la aceleradora Pygma "con otro negocio", pero no dice cuál. En prensa, LinkedIn, YC y la búsqueda web no aparece ninguna empresa previa con otro nombre. Recuperé las versiones antiguas de `blinka.co` en Wayback Machine.

**Fundadores (solo lo que hace falta para ubicar los productos):**
- **Juan Pablo Linares Uscher**, cofundador y CEO. Lleva lo comercial, lo jurídico y el negocio.
- **Sebastián Linares Uscher**, cofundador. Latam Fintech y Portafolio lo presentan como CPO y La República como CTO. Es el perfil técnico y de producto.
- No aparecen otros cofundadores. El equipo tiene unas 7 personas, entre ellas 3 ingenieros de la Universidad de los Andes.
- **Recorrido:** Pygma en abril de 2024 (su primer inversor institucional), luego Antler en Nueva York y ahora YC Fall 2026.
- **Pivotes que cuenta la prensa:** primero automatización de créditos hipotecarios en EE. UU., luego agentes de IA que reemplazan al bróker de deuda inmobiliaria comercial (CRE), y desde 2026 banca para empresas.

## 2. Productos y estilo visual de cada etapa

### A. Blinka v1, "Lending Infrastructure" (marzo a septiembre de 2024)
- **URL:** `blinka.co`, versión archivada (Wix en marzo de 2024, Webflow en septiembre de 2024).
- **Qué hacía:** infraestructura de crédito de punta a punta para que una empresa preste a sus clientes: alta de clientes, seguimiento de solicitudes y créditos, y cobranza. La versión de septiembre de 2024 decía "Easily automate lending lines using no-code and AI".
- **Estilo:** plantillas genéricas, modo claro.
  - Marzo de 2024 (Wix): violeta `#6141FF`, azul marino `#16163F`, lavanda `#C6BBFF`, tipografía Work Sans.
  - Septiembre de 2024 (Webflow): azul `#0050BD`, tinta `#1F2C3D`, fondo `#F2F3F7`, Open Sans, un degradado radial violeta (`#4A3AFF` a `#DFDCFF`).
  - El copy era genérico de SaaS ("lending, simpler", "Make it simple, Make it yours").
- **Nota:** en junio de 2024 el dominio mostraba una página de GoDaddy que decía "Chic Fashion for You". Parece un relleno de plantilla y no un producto, así que lo descarto.

### B. Blinka v2, "AI-Powered CRE Lending & Deal Structuring Platform" (julio de 2025 a febrero de 2026)
- **URL:** `blinka.co/landing` y `/landing/tools-for-lenders` (archivadas), y también `/.well-known/llm.txt`.
- **Qué hacía:** un bróker de deuda inmobiliaria comercial con IA. El prestatario sube rent roll, T-12 y el resumen del negocio. El sistema arma la suscripción sola, marca riesgos y elige los 2 a 4 prestamistas más adecuados.
  - Promesas: un paquete listo para prestamistas en menos de 72 horas y cotizaciones en menos de 24 horas.
  - Componentes que describían: "AI Orchestrator & Insight Engine", "<200ms lender matching", un "AI SDR agent" y un tablero de negocios en tiempo real con probabilidad de cierre.
  - Comisión fija de 0,75% en lugar del 1-2% que cobra un bróker.
  - Su frase: "Blinka replaces brokers with software".
- **Estilo:**
  - Next.js + Tailwind, fuente Geist, fondo gris claro `#F6F6F7`.
  - El copy es agresivo y de tesis: "CRE Debt is Broken", "Zero automation, zero data", métricas grandes como "80% lender match rate vs. ~5%".
  - El render archivado no carga, así que no pude verlo en pantalla.
- **Relevancia para nosotros:** muy alta. Ya construyeron agentes de IA que toman decisiones financieras explicables (riesgos marcados, asignación de prestamistas, puntuación). Es el mismo modelo mental que nuestro agente de pagar, frenar o escalar.

### C. Blinka v2.5, "AI Banking For Real Estate Portfolios" (enero de 2026)
- **URL:** `blinka.co/banking` (archivada).
- **Qué hacía:** cuentas bancarias por entidad o propiedad para inversionistas inmobiliarios. Su frase: "make managing 100 properties feel like managing only one". Entidades, cuentas, impuestos y pagos en un solo espacio de trabajo, con un formulario de lista de espera.
- **Estilo:**
  - Modo oscuro (casi negro) con titular de dos líneas y la segunda en azul degradado ("AI Banking For / Real Estate Portfolios").
  - Botones de lista de espera en forma de píldora azul.
  - Una captura del dashboard dentro de un marco redondeado oscuro.
  - Tailwind con shadcn/Radix, fuentes DM Sans, Geist e Inter.
  - Color principal en CSS: violeta `#573BFF`. Usa desenfoques grandes (`blur-3xl`, halos difusos).

### D. Blinka actual, "The banking platform for global companies" (2026, YC F26)
- **URL:** `https://blinka.co`, con versión para agentes en `https://blinka.co/index.md`.
- **Qué hace:** cuentas USD con datos de ruteo de EE. UU., tarjetas Visa Infinite, tesorería (DSHXX/MULSX) y pagos globales. Los rieles son ACH, wire, SWIFT, SEPA, Bre-B/PSE, Pix, SPEI y USDC.
  - Tiene un módulo "Your financial back office": facturación, proveedores, contabilidad con automatizaciones, e integraciones con QuickBooks y Stripe.
  - Para nuestra demo, este "back office" es justo donde encaja un agente que paga facturas.
- **Estilo (lo saqué del CSS y de capturas):**
  - **Modo:** solo claro. No hay `prefers-color-scheme`. El fondo es papel cálido `#F7F7F4`, con clase `grain-paper` (textura de grano).
  - **Paleta:**
    - Tinta `#1C253A` (texto), gris secundario `#656975`, líneas `#DEDFDC`.
    - Acento cobalto `#2A4BD0` en los botones principales en píldora.
    - Azul lavanda suave `#B9C8FF`, oscuro `#111720` para la tarjeta negra.
    - Logo: `#04243C` con teal `#2B9CAE`.
    - Degradados muy sutiles en verde salvia y gris, por ejemplo `linear-gradient(128deg,#eaf0ea,#e0e9e4,#cbdad3)`, más radiales blancos difusos.
  - **Tipografía:**
    - Inter (alojada como "Blinka Inter"), con pesos finos y medios (400, 450, 500). No usa negritas pesadas.
    - Tracking negativo en titulares (de -0.035em a -0.055em). Titulares de unos 28-37px, con mucho texto chico de 10-15px.
    - Geist Mono para cifras y códigos.
    - Etiquetas pequeñas en mayúsculas espaciadas (+0.1em), como "BANKING, WITHOUT BORDERS".
  - **Arte:**
    - En el hero, un listón 3D torcido hecho de líneas finas grises, tipo arte generativo de alambre.
    - Globo y mapa de LatAm en semitono de puntos.
    - No hay ilustraciones caricaturescas ni fotos.
  - **Componentes:**
    - Tarjetas de producto flotantes con sombras suaves en varias capas, por ejemplo `0 2px 3px #1c253a05, 0 22px 55px -28px #39486133`.
    - Radios de 12-20px.
    - Saldos grandes con los centavos más pequeños y en gris ("$184,418.60").
    - Filas de actividad del tipo "Northstar Group · Incoming wire · Completed · +$25,000.00", con badges de estado.
    - Banderas por país, logos de rieles (Bre-B, SEPA, Pix), selector de fondos con check azul.
    - Acordeón (+/−) en back office y un carrusel de logos de clientes que se desliza.
  - **Copy:** en inglés, sobrio, corto y con punto final ("Global payments.", "Your financial back office."), con una línea emocional por bloque.

## 3. Anexo: 30X (anfitrión del hackathon)
- **Quién es:** `https://30x.com`, escuela de negocios y educación ejecutiva para LatAm. El cofundador y CEO es Andrés Bilbao, cofundador de Rappi.
- **Relación con Blinka:** Juan Pablo Linares compartió un post de Bilbao sobre los cierres de cuentas de fundadores LatAm en Mercury, y Blinka lo usó para lanzar su producto.
- **Estilo de 30x.com:**
  - Hero negro con un mapa de LatAm hecho de puntos.
  - Acento verde lima `#E9FF7B` en palabras clave del titular y en botones píldora.
  - Inter Display en peso 600 con tracking muy cerrado (-0.05em).
  - Secciones en tarjetas blancas redondeadas sobre `#FAFAFA`.
- **Estilo de HackRadar 30X** (`hackradar.30x.com`):
  - Fondo nocturno con estrellas y vía láctea.
  - Titular en serif ("Toda la experiencia del hackathon, en un solo lugar.").
  - Tarjeta oscura con botón verde lima pálido.

## 4. Implicaciones para nuestra UI (pagar, frenar o escalar)
- **Seguir el lenguaje actual de Blinka:**
  - Fondo papel `#F7F7F4` con grano, tinta `#1C253A`, acento cobalto `#2A4BD0`.
  - Inter con tracking negativo y Geist Mono para montos.
  - Montos grandes con centavos atenuados.
  - Tarjetas flotantes con sombras en capas, banderas y badges de rieles.
- **Estados de decisión:** usar colores apagados y elegantes en vez de semáforo saturado. Por ejemplo, salvia para "pagar", ámbar suave para "frenar" y cobalto o lavanda `#B9C8FF` para "escalar".
- **Un detalle "wow":** un elemento de arte generativo de líneas finas o un globo de puntos, al estilo de su hero. Opcionalmente, un guiño al lima `#E9FF7B` de 30X en un solo detalle de marca del hackathon.
- **Contar la historia v2 → actual:** mostrar el razonamiento del agente como en su producto CRE (riesgos marcados, coincidencias, puntuación) dentro del "financial back office" de la versión actual.

## Fuentes
- [Latam Fintech: Blinka entra a Y Combinator](https://www.latamfintech.co/articles/fintech-colombiana-blinka-entra-a-y-combinator-con-una-solucion-de-cuentas-en-dolares-para-empresas)
- [Portafolio: hermanos colombianos admitidos en YC](https://www.portafolio.co/negocios/empresas/estos-hermanos-colombianos-admitidos-en-yc-les-abren-cuentas-en-dolares-en-ee-uu-a-empresas-latinas-504122)
- [La República: fintech que procesó más de US$10M](https://www.larepublica.co/finanzas/colombianos-crearon-una-fintech-en-ee-uu-que-ya-proceso-mas-de-us-10-millones-4500136)
- [Ecosistema Startup](https://ecosistemastartup.com/?p=116407)
- [Enter.co](https://www.enter.co/?p=587603)
- [LinkedIn de Blinka](https://www.linkedin.com/company/blinka-tech/)
- [blinka.co](https://blinka.co), [blinka.co/index.md](https://blinka.co/index.md) y su CSS `https://blinka.co/assets/main-CqMgimik.css`
- [Wayback de blinka.co, marzo de 2024 (Wix)](https://web.archive.org/web/20240322182628/https://blinka.co/)
- [Wayback de blinka.co, septiembre de 2024 (Webflow)](https://web.archive.org/web/20240905063749/https://blinka.co/)
- [Wayback de /landing, CRE, julio de 2025](https://web.archive.org/web/20250717112658/https://www.blinka.co/landing)
- [Wayback de llm.txt, CRE, 2025](https://web.archive.org/web/20250717123103/https://www.blinka.co/.well-known/llm.txt)
- [Wayback de /banking, enero de 2026](https://web.archive.org/web/20260108154538/http://blinka.co/banking)
- [30x.com](https://30x.com), [HackRadar 30X](https://hackradar.30x.com)
- [Perfil de Andrés Bilbao (30X)](https://andresospina.co/lideres-tech/andres-bilbao/)