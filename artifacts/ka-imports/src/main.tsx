import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import { installGlobalErrorReporting } from "@/lib/client-error-reporting";
import { shouldShowMaintenancePage } from "@/lib/maintenance";

function renderBootstrapFallback(): void {
	const root = document.getElementById("root");
	if (!root) return;

	root.replaceChildren();

	const wrapper = document.createElement("div");
	wrapper.style.minHeight = "100vh";
	wrapper.style.display = "flex";
	wrapper.style.alignItems = "center";
	wrapper.style.justifyContent = "center";
	wrapper.style.padding = "24px";
	wrapper.style.background = "#f8fafc";
	wrapper.style.fontFamily = "system-ui,-apple-system,Segoe UI,Roboto,sans-serif";

	const card = document.createElement("div");
	card.style.maxWidth = "420px";
	card.style.textAlign = "center";
	card.style.background = "#fff";
	card.style.border = "1px solid #e2e8f0";
	card.style.borderRadius = "16px";
	card.style.padding = "24px";
	card.style.boxShadow = "0 8px 24px rgba(15,23,42,.08)";

	const title = document.createElement("h1");
	title.textContent = "Nao foi possivel carregar a pagina";
	title.style.margin = "0 0 8px 0";
	title.style.fontSize = "20px";
	title.style.color = "#0f172a";

	const message = document.createElement("p");
	message.textContent = "O aplicativo encontrou um erro de inicializacao. Tente recarregar.";
	message.style.margin = "0 0 16px 0";
	message.style.color = "#475569";
	message.style.fontSize = "14px";

	const button = document.createElement("button");
	button.id = "ka-reload-btn";
	button.textContent = "Recarregar";
	button.style.border = "0";
	button.style.borderRadius = "10px";
	button.style.background = "#0f172a";
	button.style.color = "#fff";
	button.style.padding = "10px 16px";
	button.style.fontWeight = "600";
	button.style.cursor = "pointer";
	button.addEventListener("click", () => window.location.reload());

	card.append(title, message, button);
	wrapper.appendChild(card);
	root.appendChild(wrapper);

}

// Recover automatically when a newly deployed version invalidates cached chunks.
window.addEventListener("vite:preloadError", (event) => {
	event.preventDefault();
	window.location.reload();
});

window.addEventListener("error", () => {
	const root = document.getElementById("root");
	if (root && root.childElementCount === 0) {
		renderBootstrapFallback();
	}
});

if (!shouldShowMaintenancePage()) {
	installGlobalErrorReporting();
}

try {
	createRoot(document.getElementById("root")!).render(<App />);
} catch {
	renderBootstrapFallback();
}
