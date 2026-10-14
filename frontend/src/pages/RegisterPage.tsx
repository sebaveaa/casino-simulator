import { AuthForm } from "./AuthForm";

/** Sign-up screen: creating the account also starts the session. */
export function RegisterPage() {
  return <AuthForm mode="register" />;
}
