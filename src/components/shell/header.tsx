import { Suspense } from "react";
import { Avatar } from "@/components/ui/avatar";
import { Skeleton } from "@/components/ui/skeleton";
import { AgentChip, ReadingModeChip } from "./chips";
import { HEADER_ACTIONS_ID, HEADER_CRUMBS_ID } from "./config";
import { SectionCrumb } from "./header-slots";
import { getShellStatus } from "./status";

async function CompanyCrumb() {
  const { companyName } = await getShellStatus();
  return (
    <span className="flex min-w-0 items-center gap-2">
      <Avatar name={companyName} size={24} />
      <span className="truncate font-medium text-navy">{companyName}</span>
    </span>
  );
}

async function ReadingModeSlot() {
  const { readingMode } = await getShellStatus();
  return <ReadingModeChip mode={readingMode} />;
}

/** Header fijo de 64px con blur: ruta, modo de lectura, chip del agente y hueco para acciones. */
export function Header() {
  return (
    <header className="sticky top-0 z-30 h-16 shrink-0 border-b border-line/80 bg-[rgb(247_247_244/0.9)] backdrop-blur-[14px] backdrop-saturate-150">
      <div className="mx-auto flex h-full max-w-[1280px] items-center gap-4 px-8">
        <nav aria-label="Ruta" className="flex min-w-0 items-center gap-2 text-small">
          <Suspense
            fallback={
              <span className="flex items-center gap-2">
                <Skeleton className="size-6" />
                <Skeleton shape="text" className="w-28" />
              </span>
            }
          >
            <CompanyCrumb />
          </Suspense>
          <SectionCrumb />
          <span id={HEADER_CRUMBS_ID} className="contents" />
        </nav>

        <div className="ml-auto flex shrink-0 items-center gap-2">
          <Suspense fallback={<Skeleton shape="pill" className="h-7 w-32" />}>
            <ReadingModeSlot />
          </Suspense>
          <AgentChip />
          <div
            id={HEADER_ACTIONS_ID}
            className="ml-1 flex items-center gap-2 border-l border-line pl-3 empty:hidden"
          />
        </div>
      </div>
    </header>
  );
}
