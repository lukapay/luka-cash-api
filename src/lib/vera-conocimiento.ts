import { LEVELS, textoPartes } from "./niveles";
import { preguntasVera } from "./vera";

/** Conocimiento de Luka Cash que se envía al servicio de Vera. Sin porcentajes de cargo. */
export function conocimientoVera(): string {
  const niveles = LEVELS.map(
    (l, i) =>
      `- Nivel ${i + 1}, ${l.name}: monto de referencia $${l.amount.toLocaleString("es-VE")}; ${textoPartes(i + 1)}; ${l.perk}.`,
  ).join("\n");
  const faq = preguntasVera.map((q) => `- ${q.p} ${q.r}`).join("\n");
  const texto = `# Luka Cash
Financiamiento B2B en Venezuela para empresas que compran a sus proveedores. Habla en español de Venezuela. Nunca digas "interés": di "cargo financiero". Nunca inventes montos, fechas ni datos de la cuenta del cliente. El cliente ya está afiliado: no le pidas datos de contacto.

## Aprobación
Precalificado no es aprobado; cada solicitud está sujeta a aprobación.

## Niveles (cimas)
Los montos son de referencia y dependen de la evaluación.
${niveles}

## Paga después
Pago único de la factura completa a 30, 45 o 60 días.

## Cuotas
Las cuotas suman el monto de la factura. La primera se paga hoy y las demás cada 30 días. El cargo financiero se paga aparte, el día del financiamiento.

## Preguntas frecuentes
${faq}

## Pantallas de la app
- Inicio: saludo, pagar una factura, hacer un pedido, próximos pagos y proveedores.
- Pagos: cuotas pendientes agrupadas por mes, para pagarlas.
- Pagos realizados: historial de cuotas pagadas.
- Pedidos: pedidos en curso y anteriores; botón para hacer uno nuevo.
- Proveedores: proveedores afiliados de la empresa, con sus facturas y financiamientos.
- Empresa: datos de la empresa, usuarios, documentos, seguridad, métodos de pago y ayuda.
- Documentos: requisitos de la empresa para completar la cuenta.
- Niveles: cimas, beneficios y cómo subir de nivel.

## Contactos
- Soporte: support@lukapay.io
- Ventas: ventas@somosluka.com
`;
  return texto.slice(0, 12000);
}
