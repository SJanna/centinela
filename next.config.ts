import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // PGlite (base local) y unpdf/mailparser usan APIs de Node: no se empaquetan.
  serverExternalPackages: ["@electric-sql/pglite", "unpdf", "mailparser", "sharp", "pdfkit"],
  // El modo de lectura simulada y las facturas de ejemplo leen dataset/ en tiempo de ejecución.
  outputFileTracingIncludes: {
    "/api/**/*": ["./dataset/generated/**/*", "./dataset/company.json", "./dataset/casos.csv", "./dataset/scenarios.json"],
    "/**/*": ["./dataset/generated/manifest.json", "./dataset/company.json"],
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
