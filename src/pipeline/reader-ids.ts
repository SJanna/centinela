/**
 * Identificadores de los lectores. Forman parte de la clave de caché de lecturas (junto con la
 * huella del archivo, el modelo y la versión del prompt): la aplicación y el banco de pruebas usan
 * los mismos para compartir lecturas guardadas. No cambiarlos a la ligera.
 */
export const PRIMARY_READER_ID = "lector-a";
export const SECONDARY_READER_ID = "lector-b";
