import { createRoot } from "react-dom/client";
import App from "./App";
import "@xyflow/react/dist/style.css";
import "./index.css";
import "./styles/globals.css";
import "./styles/theme-overrides.css";
import { ClerkProvider } from "@clerk/clerk-react";
import { BrowserRouter } from "react-router-dom";

const publishableKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;
if (!publishableKey) {
	throw new Error("Missing VITE_CLERK_PUBLISHABLE_KEY");
}

createRoot(document.getElementById("root")!).render(
	<ClerkProvider publishableKey={publishableKey}>
		<BrowserRouter>
			<App />
		</BrowserRouter>
	</ClerkProvider>
);
