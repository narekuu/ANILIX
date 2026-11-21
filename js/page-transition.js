/* ANILIX navigation controller.
   Supported browsers animate cross-document navigation natively.
   Fallback browsers navigate immediately: no artificial loading delay. */
(() => {
 "use strict";
 const reducedMotion=window.matchMedia("(prefers-reduced-motion: reduce)");
 let navigationStarted=false;
 document.addEventListener("click",event=>{
  const target=event.target instanceof Element?event.target:null;
  const link=target&&target.closest("a[href]");
  if(!link||event.defaultPrevented)return;
  if(event.button!==0||event.metaKey||event.ctrlKey||event.shiftKey||event.altKey||
     link.target==="_blank"||link.hasAttribute("download")||link.hasAttribute("data-no-transition"))return;
  let destination;
  try{destination=new URL(link.href,location.href);}catch{return;}
  if(destination.origin!==location.origin)return;
  const sameDocument=destination.pathname===location.pathname&&destination.search===location.search;
  if(sameDocument&&destination.hash===location.hash){event.preventDefault();return;}
  if(sameDocument||navigationStarted||reducedMotion.matches)return;
  // Do not preventDefault or delay navigation; CSS View Transitions handles the handoff.
  navigationStarted=true;
 });
 window.addEventListener("pageshow",()=>{navigationStarted=false;});
})();