import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

// Recover automatically when a newly deployed version invalidates cached chunks.
window.addEventListener("vite:preloadError", (event) => {
	event.preventDefault();
	window.location.reload();
});

createRoot(document.getElementById("root")!).render(<App />);
