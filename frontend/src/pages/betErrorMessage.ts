import { ApiError } from "../api";

/** Spanish message for an error from a bet request; shared by the game screens. */
export function betErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.code === "insufficient_funds") return "Saldo insuficiente.";
    if (error.code === "network") return "No hay conexión con el servidor. Intente de nuevo.";
    if (error.code === "unauthorized") return "Inicie sesión para continuar.";
    if (error.code === "invalid_request") return "La apuesta no es válida.";
  }
  return "Ocurrió un error inesperado. Intente de nuevo.";
}
