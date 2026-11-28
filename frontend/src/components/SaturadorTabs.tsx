import { useEffect, useState } from "react";
import { usePersistentState } from "../store/persistentState";
import SaturadorPanel from "./SaturadorPanel";
import TrafficGenPanel from "./TrafficGenPanel";

type Props = Parameters<typeof SaturadorPanel>[0];

/** En escritorio: «Por puerto» (estilo Ostinato, bidireccional) y «Internet / RPV» (el agente ICMP de siempre). En la web solo el segundo. */
export default function SaturadorTabs(props: Props) {
  const [desktop, setDesktop] = useState(false);
  const [tab, setTab] = usePersistentState<"puerto" | "icmp">("saturador.tab", "puerto");
  const [tgRun, setTgRun] = useState(false);
  useEffect(() => {
    fetch("/api/local/info").then((r) => r.json()).then((d) => setDesktop(!!d?.desktop)).catch(() => setDesktop(false));
  }, []);
  if (!desktop) return <SaturadorPanel {...props} />;
  const t = tab === "icmp" ? "icmp" : "puerto";
  return (
    <div className="space-y-2">
      <div className="flex gap-1 text-sm">
        {([["puerto", "Por puerto (bidireccional)"], ["icmp", "Internet / RPV"]] as const).map(([k, l]) => (
          <button key={k} onClick={() => setTab(k)} className={`rounded px-3 py-1 ${t === k ? "bg-brand-600 text-white" : "bg-slate-100 dark:bg-slate-800"}`}>{l}</button>
        ))}
      </div>
      <div className={t === "puerto" ? "" : "hidden"}><TrafficGenPanel onRunning={(r) => { setTgRun(r); if (t === "puerto") props.onRunning?.(r); }} /></div>
      <div className={t === "icmp" ? "" : "hidden"}><SaturadorPanel {...props} onRunning={(r) => props.onRunning?.(r || tgRun)} /></div>
    </div>
  );
}
