import { ReactNode } from "react";
import { Header } from "./Header";
import { Footer } from "./Footer";
import { CartDrawer } from "../cart/CartDrawer";
import { PharmaAddedNotice } from "../cart/PharmaAddedNotice";

export function AppLayout({ children, minimal = false }: { children: ReactNode; minimal?: boolean }) {
  return (
    <div className="min-h-screen flex flex-col">
      <Header minimal={minimal} />
      <main className="flex-1 flex flex-col">{children}</main>
      <Footer />
      {!minimal && <PharmaAddedNotice />}
      {!minimal && <CartDrawer />}
    </div>
  );
}
