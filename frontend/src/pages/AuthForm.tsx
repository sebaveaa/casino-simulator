import { loginRequestSchema, registerRequestSchema } from "@casino/shared";
import { type FormEvent, useState } from "react";
import { Link, Navigate, useLocation } from "react-router";
import { ApiError, useApi } from "../api";
import { redirectTarget } from "../app/RequireSession";
import { useSession, useSessionStore } from "../session";

type Mode = "login" | "register";

const COPY: Record<
  Mode,
  {
    title: string;
    submit: string;
    pending: string;
    other: string;
    otherLink: string;
    otherTo: string;
  }
> = {
  login: {
    title: "Iniciar sesión",
    submit: "Entrar",
    pending: "Entrando…",
    other: "¿No tiene cuenta?",
    otherLink: "Crear una cuenta",
    otherTo: "/register",
  },
  register: {
    title: "Crear una cuenta",
    submit: "Crear cuenta",
    pending: "Creando cuenta…",
    other: "¿Ya tiene cuenta?",
    otherLink: "Iniciar sesión",
    otherTo: "/login",
  },
};

type FieldErrors = { email?: string; password?: string; confirm?: string };

function validate(
  mode: Mode,
  fields: { email: string; password: string; confirm: string },
): { errors: FieldErrors } | { body: { email: string; password: string } } {
  const schema = mode === "login" ? loginRequestSchema : registerRequestSchema;
  const parsed = schema.safeParse({ email: fields.email, password: fields.password });
  const errors: FieldErrors = {};
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      if (issue.path[0] === "email") errors.email ??= "Ingrese un correo electrónico válido.";
      if (issue.path[0] === "password") {
        errors.password ??=
          mode === "login"
            ? "Ingrese su contraseña."
            : "La contraseña debe tener entre 8 y 72 bytes (los acentos cuentan doble).";
      }
    }
  }
  if (mode === "register" && fields.password !== fields.confirm) {
    errors.confirm = "Las contraseñas no coinciden.";
  }
  if (!parsed.success || Object.keys(errors).length > 0) return { errors };
  return { body: parsed.data };
}

function serverErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.code === "network") return "No hay conexión con el servidor. Intente de nuevo.";
    if (error.code === "conflict") return "Ese correo electrónico ya está registrado.";
    if (error.code === "unauthorized") return "Credenciales inválidas.";
    if (error.code === "invalid_request") return "Los datos ingresados no son válidos.";
  }
  return "Ocurrió un error inesperado. Intente de nuevo.";
}

/** Email and password form shared by the login and register screens. */
export function AuthForm({ mode }: { mode: Mode }) {
  const api = useApi();
  const store = useSessionStore();
  const session = useSession();
  const location = useLocation();
  const copy = COPY[mode];

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  // Signing in (or already being signed in) leaves the screen for the requested page.
  if (session) return <Navigate to={redirectTarget(location.state)} replace />;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (pending) return;
    setFormError(null);
    const result = validate(mode, { email, password, confirm });
    if ("errors" in result) {
      setErrors(result.errors);
      return;
    }
    setErrors({});
    setPending(true);
    try {
      const response =
        mode === "login" ? await api.login(result.body) : await api.register(result.body);
      store.set({ token: response.token, user: response.user });
    } catch (error) {
      setFormError(serverErrorMessage(error));
      setPending(false);
    }
  }

  return (
    <div className="auth">
      <h1>{copy.title}</h1>
      <form className="auth-card" onSubmit={submit} noValidate>
        <label htmlFor="auth-email">Correo electrónico</label>
        <input
          id="auth-email"
          className="wallet-input"
          type="email"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          aria-invalid={errors.email ? true : undefined}
          aria-describedby={errors.email ? "auth-email-error" : undefined}
        />
        {errors.email && (
          <p id="auth-email-error" className="wallet-error">
            {errors.email}
          </p>
        )}

        <label htmlFor="auth-password">Contraseña</label>
        <input
          id="auth-password"
          className="wallet-input"
          type="password"
          autoComplete={mode === "login" ? "current-password" : "new-password"}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          aria-invalid={errors.password ? true : undefined}
          aria-describedby={errors.password ? "auth-password-error" : undefined}
        />
        {errors.password && (
          <p id="auth-password-error" className="wallet-error">
            {errors.password}
          </p>
        )}

        {mode === "register" && (
          <>
            <label htmlFor="auth-confirm">Repetir contraseña</label>
            <input
              id="auth-confirm"
              className="wallet-input"
              type="password"
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              aria-invalid={errors.confirm ? true : undefined}
              aria-describedby={errors.confirm ? "auth-confirm-error" : undefined}
            />
            {errors.confirm && (
              <p id="auth-confirm-error" className="wallet-error">
                {errors.confirm}
              </p>
            )}
          </>
        )}

        <div aria-live="polite" role="alert" className="wallet-status">
          {formError && <p className="wallet-error">{formError}</p>}
        </div>
        <button type="submit" className="button" disabled={pending}>
          {pending ? copy.pending : copy.submit}
        </button>
      </form>
      <p className="auth-switch">
        {copy.other}{" "}
        <Link to={copy.otherTo} state={location.state}>
          {copy.otherLink}
        </Link>
      </p>
    </div>
  );
}
