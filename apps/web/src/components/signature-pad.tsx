"use client";

import { buttonClass, ghostClass, inputClass } from "@/components/ui";
import { useRef } from "react";

export function SignaturePad() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const hiddenRef = useRef<HTMLInputElement>(null);
  const drawing = useRef(false);

  function point(event: React.PointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((event.clientX - rect.left) / rect.width) * canvas.width,
      y: ((event.clientY - rect.top) / rect.height) * canvas.height,
    };
  }

  function start(event: React.PointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current!;
    canvas.setPointerCapture(event.pointerId);
    drawing.current = true;
    const ctx = canvas.getContext("2d")!;
    const p = point(event);
    ctx.strokeStyle = "#1c1915";
    ctx.lineWidth = 3;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
  }

  function move(event: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawing.current) return;
    const ctx = canvasRef.current!.getContext("2d")!;
    const p = point(event);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
  }

  function end() {
    drawing.current = false;
    if (hiddenRef.current && canvasRef.current) hiddenRef.current.value = canvasRef.current.toDataURL("image/png");
  }

  function clear() {
    const canvas = canvasRef.current!;
    canvas.getContext("2d")!.clearRect(0, 0, canvas.width, canvas.height);
    if (hiddenRef.current) hiddenRef.current.value = "";
  }

  return (
    <div className="space-y-3">
      <label className="block space-y-1 text-sm">
        <span className="font-semibold">Signed by</span>
        <input className={inputClass} name="signedByName" required placeholder="Customer name" />
      </label>
      <canvas
        ref={canvasRef}
        width={640}
        height={200}
        className="h-40 w-full touch-none rounded-md border border-line bg-white"
        onPointerDown={start}
        onPointerMove={move}
        onPointerUp={end}
        onPointerLeave={end}
      />
      <input ref={hiddenRef} type="hidden" name="signaturePng" />
      <div className="flex gap-2">
        <button className={buttonClass} type="submit">
          Save signature
        </button>
        <button className={ghostClass} type="button" onClick={clear}>
          Clear
        </button>
      </div>
    </div>
  );
}
