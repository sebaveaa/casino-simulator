import type { RouteObject } from "react-router";
import { LobbyPage } from "../pages/LobbyPage";
import { LoginPage } from "../pages/LoginPage";
import { NotFoundPage } from "../pages/NotFoundPage";
import { RacesPage } from "../pages/RacesPage";
import { RegisterPage } from "../pages/RegisterPage";
import { RoulettePage } from "../pages/RoulettePage";
import { WalletPage } from "../pages/WalletPage";
import { RequireSession } from "./RequireSession";
import { Shell } from "./Shell";

/** Route table of the app; tests feed it to `createMemoryRouter`. */
export const routes: RouteObject[] = [
  {
    path: "/",
    element: <Shell />,
    children: [
      { index: true, element: <LobbyPage /> },
      { path: "login", element: <LoginPage /> },
      { path: "register", element: <RegisterPage /> },
      {
        element: <RequireSession />,
        children: [
          { path: "wallet", element: <WalletPage /> },
          { path: "games/roulette", element: <RoulettePage /> },
          { path: "games/races", element: <RacesPage /> },
        ],
      },
      { path: "*", element: <NotFoundPage /> },
    ],
  },
];
