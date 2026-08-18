import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import "@/index.css"
import { Privacy } from "@/pages/privacy"

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Privacy />
  </StrictMode>
)
