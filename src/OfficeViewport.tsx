import { useEffect, useRef, useState, type ReactNode } from "react";
import { clampCameraZoom, zoomAtCursor } from "../shared/office-camera";
import "./OfficeViewport.css";

export function OfficeViewport({children, zoom, onZoomChange, width, height, resetKey, editing = false}: {
  children: ReactNode; zoom: number; onZoomChange: (zoom: number) => void;
  width: number; height: number; resetKey: number; editing?: boolean;
}) {
  const host = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({x:0,y:0});
  const [pan, setPan] = useState({x:0,y:0});
  const latest = useRef({zoom,pan,size,onZoomChange});
  latest.current = {zoom,pan,size,onZoomChange};
  const drag = useRef<{id:number;x:number;y:number;pan:typeof pan;moved:boolean} | undefined>(undefined);
  const suppressClick = useRef(false);
  useEffect(() => { setPan({x:0,y:0}); },[resetKey]);
  useEffect(() => {
    const node = host.current!;
    const observer = new ResizeObserver(() => setSize({x:node.clientWidth,y:node.clientHeight}));
    observer.observe(node);
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      const current = latest.current;
      const next = clampCameraZoom(current.zoom * Math.exp(-event.deltaY * 0.0015));
      const bounds = node.getBoundingClientRect();
      setPan(zoomAtCursor(current.pan,current.zoom,next,{x:event.clientX-bounds.left,y:event.clientY-bounds.top},current.size));
      current.onZoomChange(next);
    };
    node.addEventListener("wheel",wheel,{passive:false});
    return () => {observer.disconnect();node.removeEventListener("wheel",wheel);};
  },[]);
  return <div ref={host} className="office-camera" aria-label="RPG office viewport"
    onPointerDown={event => {
      suppressClick.current = false;
      if(editing || event.button !== 0) return;
      drag.current = {id:event.pointerId,x:event.clientX,y:event.clientY,pan,moved:false};
    }}
    onPointerMove={event => {
      const current = drag.current;
      if(!current || current.id !== event.pointerId) return;
      const x=event.clientX-current.x,y=event.clientY-current.y;
      if(!current.moved && Math.hypot(x,y)<6) return;
      current.moved=true; suppressClick.current=true;
      event.currentTarget.setPointerCapture(event.pointerId);
      setPan({x:current.pan.x+x,y:current.pan.y+y});
    }}
    onPointerUp={event => {if(event.currentTarget.hasPointerCapture(event.pointerId))event.currentTarget.releasePointerCapture(event.pointerId);drag.current=undefined;}}
    onPointerCancel={() => {drag.current=undefined;}}
    onClickCapture={event => {if(suppressClick.current){event.stopPropagation();event.preventDefault();}}}>
    <div className="office-camera-world" style={{width,height,transform:`translate(${(size.x-width*zoom)/2+pan.x}px, ${(size.y-height*zoom)/2+pan.y}px) scale(${zoom})`}}>{children}</div>
  </div>;
}
