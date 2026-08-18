import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import "@/index.css"
import { Daemon } from "@/pages/daemon"

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Daemon />
  </StrictMode>
)
