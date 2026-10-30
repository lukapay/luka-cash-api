import { describe, expect, it } from "vitest";
import { asuntoCorreo, correoCodigoHtml, correoCodigoTexto } from "../src/mail";

describe("correo del código según el propósito", () => {
  it("entrar: sin cambios", () => {
    expect(asuntoCorreo("12345")).toBe("12345, tu código para entrar a Luka Cash");
    expect(correoCodigoHtml("12345", "Ruben Marina")).toContain("Ruben, este es tu código");
    expect(correoCodigoTexto("12345", "Ruben")).toMatch(/^Ruben, este es tu código de Luka Cash: 12345/);
  });
  it("activar: asunto y título propios, mismo cuerpo", () => {
    expect(asuntoCorreo("12345", "activar")).toBe("12345, tu código para activar Luka Cash");
    const h = correoCodigoHtml("12345", "Ruben", "activar");
    expect(h).toContain("Confirma tu afiliación");
    expect(h).not.toContain("este es tu código");
    expect(h).toContain("Vence en 10 minutos");
    expect(correoCodigoTexto("12345", "Ruben", "activar")).toMatch(/^Confirma tu afiliación a Luka Cash\. Tu código es: 12345/);
  });
});
