import { lazy, Suspense, Component, ReactNode } from "react";
import { Switch, Route, Router as WouterRouter, useLocation } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useEffect } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import { SitePasswordGate } from "@/components/SitePasswordGate";
import SocialProofWidget from "@/components/SocialProofWidget";
import { captureReferralFromCurrentUrl } from "@/lib/affiliate";

// ---------------------------------------------------------------------------
// React Error Boundary — prevents blank white page on uncaught render errors
// ---------------------------------------------------------------------------
class AppErrorBoundary extends Component<
  { children: ReactNode },
  { hasError: boolean }
> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { hasError: false };
  }
  static getDerivedStateFromError() {
    return { hasError: true };
  }
  componentDidCatch(error: Error, info: { componentStack: string }) {
    console.error("[ErrorBoundary] Uncaught error:", error, info.componentStack);
  }
  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex flex-col items-center justify-center p-6 text-center bg-background">
          <div className="max-w-sm space-y-4">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-red-100 mx-auto">
              <RefreshCw className="w-8 h-8 text-red-600" />
            </div>
            <h2 className="text-xl font-bold text-foreground">Algo deu errado</h2>
            <p className="text-muted-foreground text-sm">
              Ocorreu um erro inesperado. Por favor, recarregue a página e tente novamente.
            </p>
            <button
              onClick={() => window.location.reload()}
              className="w-full px-4 py-3 bg-primary text-primary-foreground rounded-xl font-semibold text-sm"
            >
              Recarregar página
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

const Home                = lazy(() => import("@/pages/Home"));
const Checkout            = lazy(() => import("@/pages/Checkout"));
const PixPayment          = lazy(() => import("@/pages/PixPayment"));
const Success             = lazy(() => import("@/pages/Success"));
const Admin               = lazy(() => import("@/pages/Admin"));
const AdminLogin          = lazy(() => import("@/pages/AdminLogin"));
const CustomerLogin       = lazy(() => import("@/pages/CustomerLogin"));
const CustomerOrders      = lazy(() => import("@/pages/CustomerOrders"));
const PaymentLink         = lazy(() => import("@/pages/PaymentLink"));
const SellerPage          = lazy(() => import("@/pages/SellerPage"));
const ProductDetail       = lazy(() => import("@/pages/ProductDetail"));
const SellerCheckoutPage  = lazy(() => import("@/pages/SellerCheckoutPage"));
const KYCPolicy           = lazy(() => import("@/pages/KYCPolicy"));
const KYCSubmit           = lazy(() => import("@/pages/KYCSubmit"));
const RaffleList          = lazy(() => import("@/pages/RaffleList"));
const RaffleDetail        = lazy(() => import("@/pages/RaffleDetail"));
const RafflePix           = lazy(() => import("@/pages/RafflePix"));
const RaffleConsulta      = lazy(() => import("@/pages/RaffleConsulta"));
const NotFound            = lazy(() => import("@/pages/not-found"));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

function PageLoader() {
  return (
    <div className="flex items-center justify-center min-h-screen">
      <Loader2 className="w-8 h-8 animate-spin text-primary" />
    </div>
  );
}

function ReferralShortLink() {
  const [, setLocation] = useLocation();

  useEffect(() => {
    captureReferralFromCurrentUrl();
    setLocation("/");
  }, [setLocation]);

  return <PageLoader />;
}

function useSiteProtection() {
  useEffect(() => {
    const preventDefault = (e: Event) => e.preventDefault();

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "F12") { e.preventDefault(); return; }
      if (e.ctrlKey && e.shiftKey && ["I", "J", "C", "K"].includes(e.key.toUpperCase())) { e.preventDefault(); return; }
      if (e.ctrlKey && ["U", "S", "P"].includes(e.key.toUpperCase())) { e.preventDefault(); return; }
      if (e.metaKey && e.altKey && ["I", "J"].includes(e.key.toUpperCase())) { e.preventDefault(); return; }
    };

    document.addEventListener("contextmenu", preventDefault);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("contextmenu", preventDefault);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, []);
}

function Router() {
  useSiteProtection();
  return (
    <Suspense fallback={<PageLoader />}>
      <Switch>
        <Route path="/"                 component={Home} />
        <Route path="/checkout"         component={Checkout} />
        <Route path="/pix/:id"          component={PixPayment} />
        <Route path="/success"          component={Success} />
        <Route path="/admin/login"      component={AdminLogin} />
        <Route path="/admin"            component={Admin} />
        <Route path="/login"            component={CustomerLogin} />
        <Route path="/minha-conta/pedidos" component={CustomerOrders} />
        <Route path="/r/:code"          component={ReferralShortLink} />
        <Route path="/pagamento"        component={PaymentLink} />
        <Route path="/payment-link"     component={PaymentLink} />
        <Route path="/kyc"              component={KYCPolicy} />
        <Route path="/kyc/:orderId"     component={KYCSubmit} />
        <Route path="/rifas/consulta"   component={RaffleConsulta} />
        <Route path="/rifas/pix/:id"    component={RafflePix} />
        <Route path="/rifas/:id"        component={RaffleDetail} />
        <Route path="/rifas"            component={RaffleList} />
        <Route path="/:seller/produto/:id" component={ProductDetail} />
        <Route path="/produto/:id"      component={ProductDetail} />
        <Route path="/:seller/checkout" component={SellerCheckoutPage} />
        <Route path="/:seller"          component={SellerPage} />
        <Route component={NotFound} />
      </Switch>
    </Suspense>
  );
}

function AppInner() {
  const [location] = useLocation();
  const isAdmin = location.startsWith("/admin");

  useEffect(() => {
    captureReferralFromCurrentUrl();
  }, [location]);

  return (
    <>
      <SitePasswordGate>
        <Router />
      </SitePasswordGate>
      {!isAdmin && <SocialProofWidget />}
    </>
  );
}

function App() {
  return (
    <AppErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
            <AppInner />
          </WouterRouter>
          <Toaster position="top-center" richColors theme="light" />
        </TooltipProvider>
      </QueryClientProvider>
    </AppErrorBoundary>
  );
}

export default App;
