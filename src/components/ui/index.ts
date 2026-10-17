/**
 * Componentes base de Centinela. Guía viva en /dev/ui.
 * Son de servidor salvo los marcados (cliente): CheckIcon, CountUp, DropZone, Ribbon, Toast.
 */
export { cn } from "./cn";
export { TONE, DECISION_LABEL, DECISION_GROUP_LABEL, type DecisionStatus, type Tone } from "./tones";

export { Button, type ButtonProps, type ButtonVariant, type ButtonSize, type ButtonArrow } from "./button";
export { Sheet, Card, Studio, SheetHeader, Divider } from "./sheet";
export { Eyebrow, Mono, maskAccount } from "./typography";
export { Money, Percent, moneyParts, formatMoneyText, MONEY_SIZE, type MoneyParts, type MoneySize, type MoneyDisplay } from "./money";
export { StatusDot, DecisionChip, Badge, SuspiciousBadge, SuspiciousText } from "./status";
export { KpiCard } from "./kpi-card";
export { SegmentedBar, UsageBar, type Segment } from "./bars";
export { CountryFlag, CountryChip, COUNTRY_NAME } from "./country-flag";
export { Avatar, initialsOf } from "./avatar";
export { EmptyState } from "./empty-state";
export { Superscript, Footnotes, footnoteId } from "./superscript";
export { Tooltip } from "./tooltip";
export { Skeleton, SkeletonText } from "./skeleton";

// Cliente
export { CheckIcon, checkIconStatus, type CheckIconStatus } from "./check-icon";
export { CountUp, CountUpMoney } from "./count-up";
export { DropZone } from "./drop-zone";
export { Ribbon } from "./ribbon";
export { ToastProvider, useToast, type ToastOptions, type ToastTone } from "./toast";
