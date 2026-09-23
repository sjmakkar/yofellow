import { useNet } from "../lib/net";

/** Slim status strip: only shows when something is worth knowing. */
export default function NetBadge() {
  const n = useNet();
  if (n.status === "online" && n.pending === 0 && n.nearby === 0) return null;
  const parts: string[] = [];
  if (n.status === "offline") parts.push("Offline");
  else if (n.status === "weak") parts.push("Weak network, data saver on");
  else parts.push("Online");
  if (n.pending) parts.push(`${n.pending} waiting to send`);
  if (n.nearby) parts.push(`${n.nearby} phone${n.nearby > 1 ? "s" : ""} nearby`);
  return (
    <div className={`netbadge ${n.status}`} role="status">
      <span className="dot" />
      {parts.join(" · ")}
    </div>
  );
}
