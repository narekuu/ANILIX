/* ANILIX navigation: visible, deliberate handoff on browsers with or without View Transitions. */
(() => {
 "use strict";
 const reducedMotion=window.matchMedia("(prefers-reduced-motion: reduce)");
 const markReady=()=>requestAnimationFrame(()=>requestAnimationFrame(()=>document.documentElement.classList.add("is-ready")));
 if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",markReady,{once:true});
 else markReady();
 let navigationStarted=false;
 document.addEventListener("click",event=>{
  const target=event.target instanceof Element?event.target:null;
  const link=target&&target.closest("a[href]");
  if(!link||event.defaultPrevented)return;
  if(event.button!==0||event.metaKey||event.ctrlKey||event.shiftKey||event.altKey||
     link.target==="_blank"||link.hasAttribute("download")||
     link.hasAttribute("data-no-transition")||reducedMotion.matches)return;
  let destination;
  try{destination=new URL(link.href,location.href);}catch{return;}
  if(destination.origin!==location.origin)return;
  const sameDocument=destination.pathname===location.pathname&&destination.search===location.search;
  if(sameDocument){
   if(destination.hash===location.hash){event.preventDefault();return;}
   return;
  }
  if(navigationStarted)return;
  event.preventDefault();
  navigationStarted=true;
  document.documentElement.classList.add("is-leaving");
  // Short exit handoff so the current page visibly eases away before navigation.
  window.setTimeout(()=>{location.assign(destination.href);},320);
 });
 window.addEventListener("pageshow",()=>{navigationStarted=false;});
})();