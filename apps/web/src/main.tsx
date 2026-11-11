import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import Portal from "./features/access/Portal";
import "./style.css";
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Portal />
  </StrictMode>,
);
