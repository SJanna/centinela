/**
 * Armazón de Centinela, parte segura para cliente y servidor.
 *
 * Solo servidor (importan src/store), se importan por su ruta:
 *   - `AppShell`, `ShellFooter` → "@/components/shell/app-shell" (va en el layout raíz)
 *   - `Header` → "@/components/shell/header"
 *   - `getShellStatus`, `resolveReadingMode` → "@/components/shell/status"
 */
export { ReadingModeChip, AgentChip } from "./chips";
export { HeaderActions, HeaderCrumb, SectionCrumb, CrumbSeparator } from "./header-slots";
export { PageHeader } from "./page-header";
export { Sidebar, Wordmark } from "./sidebar";
export { ShellFrame, ShellProviders } from "./shell-frame";
export {
  NAV_ITEMS,
  BARE_ROUTES,
  HEADER_ACTIONS_ID,
  HEADER_CRUMBS_ID,
  isActivePath,
  isBareRoute,
  sectionFor,
  type NavItem,
  type ReadingMode,
} from "./config";
export type { ShellStatus } from "./status";
