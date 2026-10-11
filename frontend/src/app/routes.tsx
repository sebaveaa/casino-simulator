import type { RouteObject } from "react-router";
import { LobbyPage } from "../pages/LobbyPage";
import { LoginPage } from "../pages/LoginPage";
import { NotFoundPage } from "../pages/NotFoundPage";
import { RegisterPage } from "../pages/RegisterPage";
import { RoulettePage } from "../pages/RoulettePage";
import { WalletPage } from "../pages/WalletPage";
import { Shell } from "./Shell";

/** Route table of the app; tests feed it to `createMemoryRouter`. */
export const routes: RouteObject[] = [
  {
    path: "/",
    element: <Shell />,
    children: [
      { index: true, element: <LobbyPage /> },
      { path: "wallet", element: <WalletPage /> },
      { path: "login", element: <LoginPage /> },
      { path: "register", element: <RegisterPage /> },
      { path: "games/roulette", element: <RoulettePage /> },
      { path: "*", element: <NotFoundPage /> },
    ],
  },
];
