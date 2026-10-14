import { Navigate, Outlet, useLocation } from "react-router";
import { useSession } from "../session";

/** Where to go after logging in, as set by `RequireSession` in the redirect's location state. */
export function redirectTarget(state: unknown): string {
  if (typeof state === "object" && state !== null && "from" in state) {
    const from = state.from;
    // Only in-app paths: a protocol-relative "//host" would leave the site.
    if (typeof from === "string" && from.startsWith("/") && !from.startsWith("//")) return from;
  }
  return "/";
}

/** Layout route for pages that need a session: logged-out visitors go to the login screen. */
export function RequireSession() {
  const session = useSession();
  const location = useLocation();
  if (!session) {
    const from = `${location.pathname}${location.search}`;
    return <Navigate to="/login" replace state={{ from }} />;
  }
  return <Outlet />;
}
