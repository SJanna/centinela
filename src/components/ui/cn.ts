/** Une clases e ignora valores vacíos. No resuelve conflictos: la clase que llega en `className` va al final. */
export function cn(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(" ");
}
