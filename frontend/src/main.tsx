import { createRoot } from "react-dom/client";

import { bootstrap } from "@/bootstrap";
import "@/styles/globals.css";
import "@/styles/print.css";

const element = document.getElementById("root");
if (element) {
  bootstrap(createRoot(element), import.meta.env);
}
