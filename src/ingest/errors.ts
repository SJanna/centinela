/**
 * Error de entrada: el archivo no se puede convertir en un documento normalizado.
 * El mensaje está en español y se puede mostrar tal cual al usuario.
 */
export type IngestErrorCode =
  /** Archivo de 0 bytes o sin texto. */
  | "empty"
  /** Supera el tamaño máximo. */
  | "too_large"
  /** Formato que no se sabe leer. */
  | "unsupported"
  /** PDF protegido con contraseña. */
  | "encrypted"
  /** Archivo dañado o incompleto. */
  | "corrupt"
  /** PDF con más páginas de las que admite el modelo. */
  | "too_many_pages";

export class IngestError extends Error {
  readonly code: IngestErrorCode;

  constructor(message: string, code: IngestErrorCode = "unsupported") {
    super(message);
    this.name = "IngestError";
    this.code = code;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export const SUPPORTED_HINT =
  "Sube la factura como PDF, imagen (PNG, JPG, WEBP o GIF), correo (.eml) o texto (.txt).";

/** IngestError("Formato no soportado: …"). */
export function unsupported(description: string, hint: string = SUPPORTED_HINT): IngestError {
  return new IngestError(`Formato no soportado: ${description}. ${hint}`, "unsupported");
}
