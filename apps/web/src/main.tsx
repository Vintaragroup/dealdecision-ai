import { createRoot } from "react-dom/client";
import App from "./App";
import "@xyflow/react/dist/style.css";
import "./index.css";
import "./styles/theme-overrides.css";

createRoot(document.getElementById("root")!).render(<App />);
