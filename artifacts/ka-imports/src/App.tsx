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
import { reportClientError } from "@/lib/client-error-reporting";
import Home from "@/pages/Home";
import CategoryPage from "@/pages/CategoryPage";
import OffersPage from "@/pages/OffersPage";
import SellerPage from "@/pages/SellerPage";
import Admin from "@/pages/Admin";

// ---------------------------------------------------------------------------
// React Error Boundary — prevents blank white page on uncaught render errors
// ---------------------------------------------------------------------------
class AppErrorBoundary extends Component<
  { children: ReactNode; locationKey?: string },
  { hasError: boolean; locationKey?: string }
> {
  constructor(props: { children: ReactNode; locationKey?: string }) {
    super(props);
    this.state = { hasError: false, locationKey: props.locationKey };
  }
  static getDerivedStateFromError() {
    return { hasError: true };
  }
  static getDerivedStateFromProps(
    props: { children: ReactNode; locationKey?: string },
    state: { hasError: boolean; locationKey?: string }
  ) {
    if (state.hasError && props.locationKey !== state.locationKey) {
      return { hasError: false, locationKey: props.locationKey };
    }
    return { locationKey: props.locationKey };
  }
  componentDidCatch(error: Error, info: { componentStack: string }) {
    const message = error?.message ?? "";
    const isChunkLoadError = /ChunkLoadError|Loading chunk [\d]+ failed|Failed to fetch dynamically imported module|Importing a module script failed/i.test(message);

    reportClientError({
      type: "error_boundary",
      message: message || "error_boundary_unknown",
      stack: error?.stack,
      source: "AppErrorBoundary.componentDidCatch",
      componentStack: info?.componentStack,
      metadata: {
        chunkLoadError: isChunkLoadError,
      },
    });

    if (isChunkLoadError) {
      try {
        const reloadFlag = "ka_chunk_reload_once";
        const alreadyReloaded = sessionStorage.getItem(reloadFlag) === "1";
        if (!alreadyReloaded) {
          sessionStorage.setItem(reloadFlag, "1");
          window.location.reload();
          return;
        }
      } catch {
        // Ignore storage access errors and fall back to error UI.
      }
    } else {
      try {
        sessionStorage.removeItem("ka_chunk_reload_once");
      } catch {
        // Ignore storage access errors.
      }
    }

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

const Checkout            = lazy(() => import("@/pages/Checkout"));
const PixPayment          = lazy(() => import("@/pages/PixPayment"));
const Success             = lazy(() => import("@/pages/Success"));
const AdminLogin          = lazy(() => import("@/pages/AdminLogin"));
const CustomerLogin       = lazy(() => import("@/pages/CustomerLogin"));
const CustomerOrders      = lazy(() => import("@/pages/CustomerOrders"));
const PaymentLink         = lazy(() => import("@/pages/PaymentLink"));
const ProductDetail       = lazy(() => import("@/pages/ProductDetail"));
const SellerCheckoutPage  = lazy(() => import("@/pages/SellerCheckoutPage"));
const KYCPolicy           = lazy(() => import("@/pages/KYCPolicy"));
const KYCSubmit           = lazy(() => import("@/pages/KYCSubmit"));
const Support             = lazy(() => import("@/pages/Support"));
const RaffleList          = lazy(() => import("@/pages/RaffleList"));
const RaffleDetail        = lazy(() => import("@/pages/RaffleDetail"));
const RafflePix           = lazy(() => import("@/pages/RafflePix"));
const RaffleConsulta      = lazy(() => import("@/pages/RaffleConsulta"));
const NotFound            = lazy(() => import("@/pages/not-found"));
const WhatsAppGroup2      = lazy(() => import("@/pages/WhatsAppGroup2"));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: (failureCount, error: any) => {
        // Don't retry on 4xx errors, only on network errors and 5xx
        if (error?.status >= 400 && error?.status < 500) return false;
        return failureCount < 3;
      },
      refetchOnWindowFocus: false,
      staleTime: 60 * 1000, // 1 minute - keep data fresh but reduce requests
      gcTime: 5 * 60 * 1000, // 5 minutes - keep cached data longer
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
        <Route path="/ofertas"          component={OffersPage} />
        <Route path="/categoria/:categoryName" component={CategoryPage} />
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
        <Route path="/suporte"          component={Support} />
        <Route path="/rifas/consulta"   component={RaffleConsulta} />
        <Route path="/rifas/pix/:id"    component={RafflePix} />
        <Route path="/rifas/:id"        component={RaffleDetail} />
        <Route path="/rifas"            component={RaffleList} />
          <Route path="/grupo2"           component={WhatsAppGroup2} />
        <Route path="/:seller/produto/:id" component={ProductDetail} />
        <Route path="/produto/:id"      component={ProductDetail} />
        <Route path="/:seller/checkout" component={SellerCheckoutPage} />
        <Route path="/:seller/ofertas"  component={OffersPage} />
        <Route path="/:seller/categoria/:categoryName" component={CategoryPage} />
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
    <AppErrorBoundary locationKey={location}>
      <SitePasswordGate>
        <Router />
      </SitePasswordGate>
      {!isAdmin && <SocialProofWidget />}
    </AppErrorBoundary>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <AppInner />
        </WouterRouter>
        <Toaster position="top-center" richColors theme="light" />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
