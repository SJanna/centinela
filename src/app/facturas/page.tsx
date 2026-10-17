import { redirect } from "next/navigation";

/** /facturas no tiene listado propio: el listado de decisiones vive en el registro. */
export default function InvoicesIndexPage() {
  redirect("/registro");
}
