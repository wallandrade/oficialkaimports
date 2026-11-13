import { useEffect } from "react";

export function StoreConfiguringPage() {
  useEffect(() => {
    document.title = "Loja em configuração";
  }, []);

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "#f7f7f8",
        color: "#1f2933",
        padding: "32px 24px",
        fontFamily: "Inter, system-ui, sans-serif",
      }}
    >
      <div style={{ maxWidth: 420, textAlign: "center" }}>
        <h1 style={{ margin: 0, fontSize: 28, fontWeight: 600, letterSpacing: "-0.02em" }}>
          Loja em configuração
        </h1>
        <p style={{ margin: "12px 0 0", fontSize: 15, lineHeight: 1.5, color: "#52606d" }}>
          Esta loja ainda não está disponível. Volte em breve.
        </p>
      </div>
    </div>
  );
}

export default StoreConfiguringPage;
