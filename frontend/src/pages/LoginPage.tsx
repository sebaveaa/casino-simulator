import { AuthForm } from "./AuthForm";

/** Login screen: email and password, then back to the page that asked for a session. */
export function LoginPage() {
  return <AuthForm mode="login" />;
}
