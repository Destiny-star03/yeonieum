import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import InvitationAcceptance from "./features/access/InvitationAcceptance";
import Portal from "./features/access/Portal";
import "./style.css";
function Entry() {
  const readToken = () =>
    new URLSearchParams(location.hash.slice(1)).get("invite");
  const [token, setToken] = useState(readToken);
  useEffect(() => {
    const update = () => setToken(readToken());
    window.addEventListener("hashchange", update);
    return () => window.removeEventListener("hashchange", update);
  }, []);
  return token ? (
    <InvitationAcceptance key={token} token={token} />
  ) : (
    <Portal />
  );
}
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Entry />
  </StrictMode>,
);
