/**
 * Chat exportado al estilo WhatsApp (Android):
 *   14/10/2026, 10:02 - Nombre: mensaje
 * Los mensajes de varias líneas continúan en las líneas siguientes sin prefijo.
 */
import type { ChatMessage } from "../spec";

export function buildChat(messages: ChatMessage[]): string {
  const lines: string[] = [];
  for (const m of messages) {
    const [first, ...rest] = m.text.split("\n");
    const prefix = `${m.date}, ${m.time} - `;
    lines.push(m.sender ? `${prefix}${m.sender}: ${first}` : `${prefix}${first}`);
    lines.push(...rest);
  }
  return `${lines.join("\n")}\n`;
}
