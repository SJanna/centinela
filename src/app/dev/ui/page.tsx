import type { Metadata } from "next";
import type { ReactNode } from "react";
import { FileUp, ShieldCheck, TriangleAlert } from "lucide-react";
import { PageHeader } from "@/components/shell";
import {
  Avatar,
  Badge,
  Button,
  Card,
  CheckIcon,
  CountUp,
  CountUpMoney,
  CountryChip,
  CountryFlag,
  COUNTRY_NAME,
  DecisionChip,
  EmptyState,
  Eyebrow,
  Footnotes,
  KpiCard,
  Mono,
  Money,
  Percent,
  Ribbon,
  SegmentedBar,
  Sheet,
  SheetHeader,
  Skeleton,
  SkeletonText,
  StatusDot,
  Studio,
  Superscript,
  SuspiciousBadge,
  SuspiciousText,
  Tooltip,
  UsageBar,
  maskAccount,
  type DecisionStatus,
} from "@/components/ui";
import { CheckListDemo, DropZoneDemo, ToastDemo } from "@/components/ui/dev/style-guide-demos";

export const metadata: Metadata = {
  title: "Guía de estilo · Centinela",
  robots: { index: false },
};

// ───────────────────────── Datos de ejemplo (Andes Labs Inc., dataset/company.json) ─────────────────────────

const VENDORS = [
  { name: "Camila Restrepo Dev S.A.S.", country: "CO", currency: "COP", account: "4512-0098-7731", agreement: "Desarrollo backend, fijo mensual", amount: 12_000_000, status: "PAGAR" },
  { name: "Estudio Nopal S. de R.L.", country: "MX", currency: "MXN", account: "012180001234567891", agreement: "Diseño de producto, 900 MXN/h", amount: 118_800, status: "ESCALAR" },
  { name: "Testa Qualidade Ltda", country: "BR", currency: "BRL", account: "0341-45678-9", agreement: "QA manual y automatizado", amount: 9_500, status: "FRENAR" },
  { name: "CloudMetrics Inc.", country: "US", currency: "USD", account: "3300198822", agreement: "Suscripción SaaS, plan Team", amount: 1_200, status: "PAGAR" },
  { name: "Inca Contenidos S.A.C.", country: "PE", currency: "PEN", account: "191-2345678-0-12", agreement: "Marketing de contenidos", amount: 6_000, status: "PROCESANDO" },
  { name: "Pampa Ops SRL", country: "AR", currency: "USD", account: "0070999030004123456789", agreement: "DevOps gestionado, en dólares", amount: 2_800, status: "PAGAR" },
  { name: "Datos del Sur SpA", country: "CL", currency: "USD", account: "00-123-45678-09", agreement: "Analítica de datos, 60 USD/h", amount: 4_860, status: "PAGAR" },
] as const satisfies readonly {
  name: string;
  country: string;
  currency: string;
  account: string;
  agreement: string;
  amount: number;
  status: DecisionStatus;
}[];

const SWATCHES: { group: string; items: { name: string; value: string; className: string; dark?: boolean }[] }[] = [
  {
    group: "Superficies",
    items: [
      { name: "paper", value: "#F7F7F4", className: "bg-paper" },
      { name: "bed", value: "#F4F6F7", className: "bg-bed" },
      { name: "surface-0", value: "#FDFDFD", className: "bg-surface-0" },
      { name: "surface-1", value: "#F7F7F7", className: "bg-surface-1" },
      { name: "surface-2", value: "#F0F2F4", className: "bg-surface-2" },
      { name: "surface-3", value: "#E9ECF2", className: "bg-surface-3" },
      { name: "seam", value: "#E4E6EF", className: "bg-seam" },
      { name: "line", value: "#DEDFDC", className: "bg-line" },
    ],
  },
  {
    group: "Tinta",
    items: [
      { name: "navy", value: "#1C253A", className: "bg-navy", dark: true },
      { name: "ink", value: "#191C1F", className: "bg-ink", dark: true },
      { name: "ink-2", value: "#3A444C", className: "bg-ink-2", dark: true },
      { name: "muted", value: "#656975", className: "bg-muted", dark: true },
      { name: "ink-3", value: "#8D969E", className: "bg-ink-3", dark: true },
      { name: "faint", value: "#C9C9CD", className: "bg-faint" },
    ],
  },
  {
    group: "Acento y especiales",
    items: [
      { name: "accent", value: "#2A4BD0", className: "bg-accent", dark: true },
      { name: "accent-hover", value: "#2342BD", className: "bg-accent-hover", dark: true },
      { name: "accent-wash", value: "#ECEFF9", className: "bg-accent-wash" },
      { name: "lavender", value: "#B9C8FF", className: "bg-lavender" },
      { name: "night", value: "#111720", className: "bg-night", dark: true },
      { name: "lime", value: "#E8FFB7", className: "bg-lime" },
    ],
  },
];

const STATUS_SWATCHES: { status: DecisionStatus | "SOSPECHOSO"; label: string; text: string; wash: string; mark: string }[] = [
  { status: "PAGAR", label: "Pagar", text: "#007456", wash: "#DFF3EE", mark: "#00A87E" },
  { status: "FRENAR", label: "Frenar", text: "#BC303C", wash: "#FAEAEB", mark: "#E23B4A" },
  { status: "ESCALAR", label: "Escalar", text: "#9D5201", wash: "#FBEFE1", mark: "#EC7E01" },
  { status: "PROCESANDO", label: "Revisando", text: "#3162C2", wash: "#E9EEF9", mark: "#376CD5" },
  { status: "SOSPECHOSO", label: "Sospechoso", text: "#8A1C24", wash: "#FFF1B8", mark: "#B3413B" },
];

const TYPE_SCALE: { name: string; spec: string; sample: ReactNode; className: string }[] = [
  { name: "Display", spec: "44/1.08 · 450 · −0.045em", className: "text-display text-navy", sample: "Tu agente decide." },
  { name: "H1", spec: "30/1.15 · 450 · −0.035em", className: "text-h1 text-navy", sample: "Registro de decisiones." },
  { name: "H2", spec: "20/1.25 · 450 · −0.02em", className: "text-h2 text-navy", sample: "Comprobaciones" },
  { name: "H3", spec: "15/1.4 · 500 · −0.01em", className: "text-h3 text-navy", sample: "Estudio Nopal S. de R.L." },
  { name: "Cuerpo", spec: "14/1.55 · 400", className: "text-body text-ink", sample: "El monto está dentro de lo pactado, con una tolerancia de ±1 %." },
  { name: "Secundario", spec: "13/1.5 · 400 · ink-2", className: "text-small text-ink-2", sample: "Recibida por correo el 16 de octubre a las 10:04." },
  { name: "Antetítulo", spec: "11 · 500 · +0.1em · muted", className: "eyebrow", sample: "Fondo disponible" },
  { name: "Mono", spec: "Geist Mono · 12.5", className: "font-mono text-[12.5px] text-ink-2", sample: "NOP-0311 · •••• 7891 · LIM-1" },
];

// ───────────────────────── Piezas de la página ─────────────────────────

const SECTIONS = [
  ["color", "Color"],
  ["tipografia", "Tipografía"],
  ["botones", "Botones"],
  ["superficies", "Superficies"],
  ["montos", "Montos"],
  ["estados", "Estados"],
  ["indicadores", "Indicadores"],
  ["proveedores", "Proveedores"],
  ["comprobaciones", "Comprobaciones"],
  ["notas", "Notas y ayudas"],
  ["carga", "Carga y avisos"],
  ["subida", "Subida"],
  ["vacios", "Estados vacíos"],
  ["traza", "Traza"],
] as const;

function Section({ id, title, description, children }: { id: string; title: string; description?: ReactNode; children: ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="scroll-mt-24 border-t border-line pt-10 pb-14">
      <div className="mb-6 grid gap-1 lg:grid-cols-[220px_1fr] lg:gap-8">
        <h2 id={`${id}-title`} className="text-h2">
          {title}
        </h2>
        {description ? <p className="max-w-[64ch] text-small text-ink-2">{description}</p> : null}
      </div>
      {children}
    </section>
  );
}

function Swatch({ name, value, className, dark }: { name: string; value: string; className: string; dark?: boolean }) {
  return (
    <div className="space-y-2">
      <div className={`h-14 rounded-row ring-1 ring-[#1c253a14] ring-inset ${className}`}>
        <span className="sr-only">{dark ? "Color oscuro" : "Color claro"}</span>
      </div>
      <div>
        <p className="text-caption font-medium text-navy">{name}</p>
        <Mono className="text-[11.5px] text-ink-3">{value}</Mono>
      </div>
    </div>
  );
}

// ───────────────────────── Página ─────────────────────────

export default function StyleGuidePage() {
  return (
    <>
      <PageHeader
        eyebrow="Sistema visual"
        title="Guía de estilo."
        description="Tokens y componentes de Centinela con datos de Andes Labs Inc. Papel cálido, tinta navy y un solo acento cobalto. Solo modo claro."
        actions={
          <Button href="/" variant="secondary" size="sm" arrow="next">
            Volver al resumen
          </Button>
        }
      />

      <nav aria-label="Secciones de la guía" className="mb-10 flex flex-wrap gap-1.5">
        {SECTIONS.map(([id, label]) => (
          <a
            key={id}
            href={`#${id}`}
            className="rounded-pill bg-surface-0/70 px-3 py-1 text-caption font-medium text-ink-2 ring-1 ring-seam ring-inset transition-colors duration-150 hover:bg-surface-0 hover:text-navy"
          >
            {label}
          </a>
        ))}
      </nav>

      {/* ── Color ── */}
      <Section
        id="color"
        title="Color"
        description="El papel lleva un grano muy suave. El cobalto es el único acento: botones, enlaces y la selección. El lima solo aparece en el chip del agente y en el pie."
      >
        <div className="space-y-8">
          {SWATCHES.map((group) => (
            <div key={group.group}>
              <Eyebrow className="mb-3">{group.group}</Eyebrow>
              <div className="grid grid-cols-3 gap-4 md:grid-cols-6 xl:grid-cols-8">
                {group.items.map((s) => (
                  <Swatch key={s.name} {...s} />
                ))}
              </div>
            </div>
          ))}
          <div>
            <Eyebrow className="mb-3">Estados de decisión</Eyebrow>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
              {STATUS_SWATCHES.map((s) => (
                <Card key={s.status} padding="sm" className="space-y-3">
                  <div className="flex items-center justify-between">
                    {s.status === "SOSPECHOSO" ? <SuspiciousBadge>Sospechosa</SuspiciousBadge> : <DecisionChip status={s.status} />}
                  </div>
                  <dl className="grid grid-cols-[auto_1fr] items-center gap-x-3 gap-y-1.5 text-caption">
                    {(
                      [
                        ["Texto", s.text],
                        ["Fondo", s.wash],
                        ["Marca", s.mark],
                      ] as const
                    ).map(([k, v]) => (
                      <div key={k} className="contents">
                        <dt className="flex items-center gap-2 text-muted">
                          <span aria-hidden className="size-3 rounded-[4px] ring-1 ring-[#1c253a14] ring-inset" style={{ background: v }} />
                          {k}
                        </dt>
                        <dd>
                          <Mono className="text-ink-2">{v}</Mono>
                        </dd>
                      </div>
                    ))}
                  </dl>
                </Card>
              ))}
            </div>
          </div>
        </div>
      </Section>

      {/* ── Tipografía ── */}
      <Section
        id="tipografia"
        title="Tipografía"
        description="Inter variable con títulos a peso 450 y tracking negativo; nunca bold. Geist Mono para IDs, cuentas y códigos de regla. Playfair italic solo en una palabra del primer uso."
      >
        <Sheet padding="none" as="div">
          <dl className="divide-y divide-seam">
            {TYPE_SCALE.map((t) => (
              <div key={t.name} className="grid items-baseline gap-2 px-6 py-5 md:grid-cols-[200px_1fr]">
                <dt>
                  <p className="text-small font-medium text-navy">{t.name}</p>
                  <Mono className="text-[11.5px] text-ink-3">{t.spec}</Mono>
                </dt>
                <dd className={t.className}>{t.sample}</dd>
              </div>
            ))}
            <div className="grid items-baseline gap-2 px-6 py-5 md:grid-cols-[200px_1fr]">
              <dt>
                <p className="text-small font-medium text-navy">Monto KPI</p>
                <Mono className="text-[11.5px] text-ink-3">32 · 450 · centavos 22</Mono>
              </dt>
              <dd className="text-navy">
                <Money amount={21580.5} size="kpi" display="symbol" />
              </dd>
            </div>
            <div className="grid items-baseline gap-2 px-6 py-5 md:grid-cols-[200px_1fr]">
              <dt>
                <p className="text-small font-medium text-navy">Primer uso</p>
                <Mono className="text-[11.5px] text-ink-3">Playfair Display italic</Mono>
              </dt>
              <dd className="text-h1 text-navy">
                Tu agente <em className="font-serif text-[1.1em] font-normal tracking-[-0.025em] italic">paga</em>. Tú decides.
              </dd>
            </div>
          </dl>
        </Sheet>
      </Section>

      {/* ── Botones ── */}
      <Section
        id="botones"
        title="Botones"
        description="Píldoras. El primario es cobalto y hay uno por vista. → avanza dentro de la app; ↗ abre o sube algo."
      >
        <Card padding="lg" className="space-y-6">
          <div className="flex flex-wrap items-center gap-3">
            <Button arrow="external">Subir facturas</Button>
            <Button arrow="next">Ver decisión</Button>
            <Button variant="secondary" icon={<FileUp />}>
              Exportar CSV
            </Button>
            <Button variant="ghost">Cancelar</Button>
            <Button disabled arrow="next">
              Deshabilitado
            </Button>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" arrow="external">
              Subir facturas
            </Button>
            <Button size="sm" variant="secondary" arrow="next">
              Ver registro
            </Button>
            <Button size="sm" variant="ghost">
              Restablecer
            </Button>
          </div>
        </Card>
      </Section>

      {/* ── Superficies ── */}
      <Section
        id="superficies"
        title="Superficies"
        description="La hoja (radio 20, borde blanco, sombra larga) para lo principal; la tarjeta (radio 16, borde seam) para lo secundario; el estudio mate para apoyar una hoja."
      >
        <div className="grid gap-6 lg:grid-cols-3">
          <Sheet>
            <SheetHeader eyebrow="Hoja" title="Factura NOP-0311" description="Sombra sheet: 0 22px 55px −28px." />
          </Sheet>
          <Card padding="lg">
            <SheetHeader eyebrow="Tarjeta" title="Estudio Nopal" description="Superficie 0 con borde seam." level={3} />
          </Card>
          <Studio className="grid min-h-[160px] place-items-center p-6">
            <Sheet padding="md" className="w-full max-w-[240px]">
              <Eyebrow>Estudio</Eyebrow>
              <p className="mt-1 text-small text-ink-2">Degradado mate detrás de una hoja.</p>
            </Sheet>
          </Studio>
        </div>
      </Section>

      {/* ── Montos ── */}
      <Section
        id="montos"
        title="Montos"
        description="Cifras tabulares en formato es-CO con los centavos atenuados. La moneda va como código; en KPIs en USD, con símbolo."
      >
        <div className="grid gap-6 lg:grid-cols-[1fr_1fr]">
          <Card padding="none">
            <ul className="divide-y divide-seam">
              {VENDORS.slice(0, 5).map((v) => (
                <li key={v.name} className="flex items-center justify-between gap-4 px-5 py-3.5">
                  <span className="truncate text-small text-ink-2">{v.name}</span>
                  <Money amount={v.amount} currency={v.currency} />
                </li>
              ))}
              <li className="flex items-center justify-between gap-4 px-5 py-3.5">
                <span className="text-small text-ink-2">Sin decimales (CLP)</span>
                <Money amount={1_250_000} currency="CLP" />
              </li>
              <li className="flex items-center justify-between gap-4 px-5 py-3.5">
                <span className="text-small text-ink-2">Monto no leído</span>
                <Money amount={null} />
              </li>
            </ul>
          </Card>
          <Card padding="none">
            <dl className="divide-y divide-seam">
              {(
                [
                  ["display", "44", <Money key="d" amount={184418.6} size="display" display="symbol" />],
                  ["kpi", "32", <Money key="k" amount={21580.5} size="kpi" display="symbol" />],
                  ["xl", "24", <Money key="x" amount={118800} currency="MXN" size="xl" />],
                  ["lg", "17", <Money key="l" amount={25000} size="lg" signDisplay="always" />],
                  ["md", "14", <Money key="m" amount={-128} />],
                  ["kpi · Percent", "32", <Percent key="p" value={0.75} size="kpi" />],
                ] as const
              ).map(([name, px, sample]) => (
                <div key={name} className="flex items-baseline justify-between gap-4 px-5 py-3.5">
                  <dt className="text-small text-ink-2">
                    {name} <Mono className="text-ink-3">{px}px</Mono>
                  </dt>
                  <dd className="text-navy">{sample}</dd>
                </div>
              ))}
            </dl>
          </Card>
        </div>
      </Section>

      {/* ── Estados ── */}
      <Section
        id="estados"
        title="Estados"
        description="Cada decisión se lee en una píldora lavada con punto. Escalar no tiene botones: queda pendiente de una persona con la acción sugerida."
      >
        <div className="grid gap-6 lg:grid-cols-2">
          <Card padding="lg" className="space-y-5">
            <div className="flex flex-wrap items-center gap-2">
              <DecisionChip status="PAGAR" />
              <DecisionChip status="FRENAR" />
              <DecisionChip status="ESCALAR" />
              <DecisionChip status="PROCESANDO" />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <DecisionChip status="PAGAR" size="lg" />
              <DecisionChip status="FRENAR" size="lg" />
              <DecisionChip status="ESCALAR" size="lg" />
              <DecisionChip status="PROCESANDO" size="lg" />
            </div>
            <div className="flex flex-wrap items-center gap-4 text-small text-ink-2">
              {(["PAGAR", "FRENAR", "ESCALAR", "PROCESANDO", "NEUTRAL"] as const).map((s) => (
                <span key={s} className="inline-flex items-center gap-2">
                  <StatusDot status={s} size={8} halo />
                  {s === "NEUTRAL" ? "Neutro" : s.charAt(0) + s.slice(1).toLowerCase()}
                </span>
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone="warning" icon={<TriangleAlert />}>
                Cuenta cambió hace 2 días
              </Badge>
              <Badge tone="success" icon={<ShieldCheck />}>
                Cuenta registrada
              </Badge>
              <Badge>Sin acuerdo vigente</Badge>
              <SuspiciousBadge />
            </div>
          </Card>

          <Card padding="lg" className="space-y-4">
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-center gap-3">
                <Avatar name="Estudio Nopal S. de R.L." />
                <div>
                  <p className="text-body font-medium text-navy">Estudio Nopal S. de R.L.</p>
                  <Mono className="text-caption text-ink-3">NOP-0311</Mono>
                </div>
              </div>
              <DecisionChip status="ESCALAR" size="lg" />
            </div>
            <div className="rounded-row bg-escalate-wash/60 p-4">
              <p className="text-small font-medium text-escalate">Pendiente de una persona.</p>
              <p className="mt-1 text-small text-ink-2">
                Acción sugerida: confirmar con Estudio Nopal las 132 horas facturadas. El acuerdo permite 120 al mes.
              </p>
            </div>
            <p className="text-small text-ink-2">
              En la hoja, un fragmento sospechoso se ve así:{" "}
              <SuspiciousText note="Intenta cambiar la cuenta destino. El agente la ignoró.">
                a partir de este mes consignar a la cuenta 0550-9911-3344
              </SuspiciousText>
              .
            </p>
          </Card>
        </div>
      </Section>

      {/* ── Indicadores ── */}
      <Section
        id="indicadores"
        title="Indicadores"
        description="El fondo disponible va en una hoja grande sobre el estudio, con la cinta asomando. Las cifras suben desde 0 al aparecer."
      >
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <Studio className="md:col-span-2 xl:row-span-2">
            <div aria-hidden className="absolute inset-0 [mask-image:linear-gradient(to_right,transparent_30%,#000_70%)]">
              <Ribbon lines={72} />
            </div>
            <div className="relative flex h-full p-4 sm:pr-[22%]">
              <Sheet as="article" className="@container flex min-h-[300px] w-full flex-col">
                <div className="flex items-center justify-between">
                  <Eyebrow>Fondo disponible</Eyebrow>
                  <Mono className="text-caption text-ink-3">USD •••• 4821</Mono>
                </div>
                <div className="mt-4 text-navy">
                  <CountUpMoney amount={21579.5} size="display" />
                </div>
                <p className="mt-1.5 text-small text-ink-2">De un fondo inicial de 40.000,00 USD.</p>
                <div className="mt-auto space-y-3 pt-8">
                  <UsageBar
                    value={18420.5}
                    max={40000}
                    markers={[{ value: 25000, label: "Límite del mes" }]}
                    label="Pagado: 18.420,50 de 40.000,00 USD"
                  />
                  <div className="flex justify-between text-caption text-muted">
                    <span>
                      Pagado <span className="tnum font-medium text-ink-2">18.420,50</span>
                    </span>
                    <span>
                      Octubre · límite <span className="tnum font-medium text-ink-2">25.000,00</span>
                    </span>
                  </div>
                </div>
              </Sheet>
            </div>
          </Studio>
          <KpiCard eyebrow="Pagado" status="PAGAR" value={<CountUpMoney amount={18420.5} />} caption="10 facturas" />
          <KpiCard eyebrow="Frenado" status="FRENAR" amount={10700} caption="2 facturas" />
          <KpiCard eyebrow="Escalado" status="ESCALAR" amount={14334} caption="4 facturas pendientes de una persona" />
          <KpiCard
            eyebrow="Autonomía"
            value={<CountUp value={0.75} percent />}
            caption="Resueltas sin una persona"
            footer={
              <SegmentedBar
                label="10 pagadas, 2 frenadas y 4 escaladas"
                segments={[
                  { key: "PAGAR", value: 10, tone: "PAGAR", label: "Pagadas" },
                  { key: "FRENAR", value: 2, tone: "FRENAR", label: "Frenadas" },
                  { key: "ESCALAR", value: 4, tone: "ESCALAR", label: "Escaladas" },
                ]}
              />
            }
          />
        </div>
        <Card padding="md" className="mt-4">
          <SegmentedBar
            legend
            height={8}
            label="Decisiones del mes"
            segments={[
              { key: "PAGAR", value: 10, tone: "PAGAR", label: "Pagadas" },
              { key: "FRENAR", value: 2, tone: "FRENAR", label: "Frenadas" },
              { key: "ESCALAR", value: 4, tone: "ESCALAR", label: "Escaladas" },
              { key: "PROCESANDO", value: 1, tone: "PROCESANDO", label: "Revisando" },
            ]}
          />
        </Card>
      </Section>

      {/* ── Proveedores ── */}
      <Section
        id="proveedores"
        title="Proveedores"
        description="País con bandera circular dibujada a mano y moneda. Avatar con iniciales. Cuentas enmascaradas en mono."
      >
        <div className="mb-6 flex flex-wrap items-center gap-5">
          {[...Object.keys(COUNTRY_NAME), "EC"].map((code) => (
            <span key={code} className="inline-flex items-center gap-2 text-small text-ink-2">
              <CountryFlag country={code} size={20} />
              {COUNTRY_NAME[code] ?? `Otro (${code})`}
            </span>
          ))}
        </div>
        <Card padding="none" className="overflow-x-auto">
          <table className="w-full min-w-[820px] text-left text-small">
            <thead>
              <tr className="text-caption text-muted">
                <th className="px-5 py-3 font-medium">Proveedor</th>
                <th className="px-3 py-3 font-medium">País y moneda</th>
                <th className="px-3 py-3 font-medium">Cuenta</th>
                <th className="px-3 py-3 font-medium">Acuerdo</th>
                <th className="px-3 py-3 text-right font-medium">Última factura</th>
                <th className="px-5 py-3 font-medium">Decisión</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-seam border-t border-seam">
              {VENDORS.map((v) => (
                <tr key={v.name} className="h-14 transition-colors duration-150 hover:bg-row-active">
                  <td className="px-5">
                    <span className="flex items-center gap-3">
                      <Avatar name={v.name} />
                      <span className="font-medium whitespace-nowrap text-navy">{v.name}</span>
                    </span>
                  </td>
                  <td className="px-3">
                    <CountryChip country={v.country} currency={v.currency} />
                  </td>
                  <td className="px-3">
                    <Mono className="text-ink-2" title="Cuenta registrada">
                      {maskAccount(v.account)}
                    </Mono>
                  </td>
                  <td className="max-w-[240px] truncate px-3 text-ink-2">{v.agreement}</td>
                  <td className="px-3 text-right">
                    <Money amount={v.amount} currency={v.currency} />
                  </td>
                  <td className="px-5">
                    <DecisionChip status={v.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </Section>

      {/* ── Comprobaciones ── */}
      <Section
        id="comprobaciones"
        title="Comprobaciones"
        description="Una por fila: círculo de 20px con ✓, ✗ o !, título, explicación con valores concretos y el código de la regla. El trazo se dibuja al aparecer, escalonado 120 ms."
      >
        <div className="grid gap-6 lg:grid-cols-[1fr_280px]">
          <CheckListDemo />
          <Card padding="md" className="h-fit space-y-3">
            <Eyebrow>Iconos</Eyebrow>
            <ul className="space-y-2.5 text-small text-ink-2">
              <li className="flex items-center gap-3">
                <CheckIcon status="pass" animate={false} /> Cumple
              </li>
              <li className="flex items-center gap-3">
                <CheckIcon status="fail" animate={false} /> Frena el pago
              </li>
              <li className="flex items-center gap-3">
                <CheckIcon status="warn" animate={false} /> Pide a una persona
              </li>
              <li className="flex items-center gap-3">
                <CheckIcon status="pending" animate={false} /> Aún sin resultado
              </li>
            </ul>
          </Card>
        </div>
      </Section>

      {/* ── Notas y ayudas ── */}
      <Section
        id="notas"
        title="Notas y ayudas"
        description="El porqué cita las reglas con superíndices que llevan a la nota. Los tooltips son solo CSS y explican sin interrumpir."
      >
        <div className="grid gap-6 lg:grid-cols-2">
          <Sheet>
            <Eyebrow>Por qué</Eyebrow>
            <p className="mt-2 text-h2 text-navy">
              Escalada porque el monto supera el umbral de aprobación
              <Superscript n={1} /> y las horas exceden el máximo del acuerdo
              <Superscript n={2} />.
            </p>
            <p className="mt-3 text-small text-ink-2">Lecturas: 2 de 2 coinciden.</p>
            <Footnotes
              className="mt-6 border-t border-seam pt-4"
              items={[
                { n: 1, content: <>LIM-1 · Umbral de aprobación: 5.000,00 USD. Esta factura: 6.534,00 USD.</> },
                { n: 2, content: <>ACU-3 · Estudio Nopal: hasta 120 h al mes a 900,00 MXN la hora. Factura 132 h.</> },
              ]}
            />
          </Sheet>
          <Card padding="lg" className="space-y-4">
            <Eyebrow>Tooltips</Eyebrow>
            <div className="flex flex-wrap items-center gap-3">
              <Tooltip content="Tasa fija de la empresa: 1 MXN = 0,055 USD.">
                <span tabIndex={0} className="cursor-help border-b border-dashed border-faint text-small text-ink-2">
                  118.800,00 MXN ≈ 6.534,00 USD
                </span>
              </Tooltip>
              <Tooltip content="Por encima de este monto decide una persona." side="bottom">
                <Button size="sm" variant="secondary">
                  Umbral de aprobación
                </Button>
              </Tooltip>
            </div>
          </Card>
        </div>
      </Section>

      {/* ── Carga y avisos ── */}
      <Section
        id="carga"
        title="Carga y avisos"
        description="Bloques de carga con brillo lento. Los avisos aparecen abajo a la derecha con sombra pop y se cierran solos."
      >
        <div className="grid gap-6 lg:grid-cols-2">
          <Card padding="none">
            <ul className="divide-y divide-seam">
              {[0, 1, 2].map((i) => (
                <li key={i} className="flex h-16 items-center gap-3 px-5">
                  <Skeleton className="size-8" />
                  <div className="flex-1 space-y-2">
                    <Skeleton shape="text" className="w-40" />
                    <Skeleton shape="text" className="w-24" />
                  </div>
                  <Skeleton shape="pill" className="h-6 w-20" />
                </li>
              ))}
            </ul>
            <div className="border-t border-seam p-5">
              <SkeletonText lines={3} />
            </div>
          </Card>
          <Card padding="lg" className="space-y-4">
            <Eyebrow>Avisos</Eyebrow>
            <p className="text-small text-ink-2">Frases cortas. Primero el estado, después el detalle.</p>
            <ToastDemo />
          </Card>
        </div>
      </Section>

      {/* ── Subida ── */}
      <Section
        id="subida"
        title="Subida"
        description="Zona de arrastre sin lógica de subida: entrega los archivos por onFiles. Borde punteado de 1.5px; al arrastrar, cobalto y fondo lavado."
      >
        <DropZoneDemo />
      </Section>

      {/* ── Estados vacíos ── */}
      <Section
        id="vacios"
        title="Estados vacíos"
        description="Líneas finas, una frase con punto y un CTA. El primer uso lleva la cinta y la única palabra en Playfair."
      >
        <div className="space-y-6">
          <Card padding="none">
            <EmptyState
              title="Sin facturas por revisar."
              description="Cuando subas una factura, la decisión aparece aquí con su porqué."
              action={
                <Button size="sm" arrow="external">
                  Subir facturas
                </Button>
              }
            />
          </Card>
          <EmptyState
            variant="first-use"
            eyebrow="Primer uso"
            description="Sube una factura. Centinela la lee dos veces, revisa 15 comprobaciones y decide si pagar, frenar o escalar."
            action={
              <>
                <Button arrow="external">Subir facturas</Button>
                <Button variant="ghost" href="/reglas">
                  Ver las reglas
                </Button>
              </>
            }
          />
          <Studio className="h-48">
            <Ribbon opacity={0.45} />
          </Studio>
        </div>
      </Section>

      {/* ── Traza ── */}
      <Section
        id="traza"
        title="Traza de la decisión"
        description="El único momento oscuro. Muestra los pasos deterministas que llevaron a la decisión; no es texto de un modelo."
      >
        <Studio className="p-6">
          <div className="glass-night max-w-[640px] rounded-panel p-5">
            <div className="flex items-center justify-between">
              <p className="text-caption font-medium tracking-[0.1em] text-night-muted uppercase">Traza de la decisión</p>
              <Mono className="text-caption text-night-muted">15 comprobaciones</Mono>
            </div>
            <ol className="mt-4 space-y-1.5 font-mono text-[12.5px] leading-[1.6] text-night-text">
              <li>
                <span className="text-night-muted">01</span> Lecturas: 2 de 2 coinciden en 5 datos críticos.
              </li>
              <li>
                <span className="text-night-muted">02</span> Proveedor v-nopal · cuenta registrada •••• 7891.
              </li>
              <li>
                <span className="text-night-muted">03</span> ACU-3 no cumple: 132 h &gt; 120 h → ESCALAR.
              </li>
              <li>
                <span className="text-night-muted">04</span> LIM-1 no cumple: 6.534,00 &gt; 5.000,00 USD → ESCALAR.
              </li>
              <li>
                <span className="text-night-muted">05</span> Ninguna FRENAR. Resultado: ESCALAR.
              </li>
            </ol>
          </div>
        </Studio>
      </Section>
    </>
  );
}
