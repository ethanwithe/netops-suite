import { useEffect, useRef } from "react";

export default function LiveLog({ lines }: { lines: string[] }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (ref.current) ref.current.scrollTop = ref.current.scrollHeight;
  }, [lines]);

  return (
    <div
      ref={ref}
      className="bg-slate-900 text-slate-200 rounded-lg p-3 font-mono text-xs h-56 overflow-y-auto whitespace-pre-wrap"
    >
      {lines.length === 0 ? (
        <span className="text-slate-500">Esperando ejecución...</span>
      ) : (
        lines.map((l, i) => <div key={i}>{l}</div>)
      )}
    </div>
  );
}
