/* ANILIX SPA tab router — inspired by BLIYO's #view transition flow.
   Only the five primary tabs are soft-navigated. Other routes retain normal navigation. */
(() => {
 "use strict";
 if(window.__ANILIX_SPA_ROUTER__)return;
 window.__ANILIX_SPA_ROUTER__=true;

 const ROUTES=new Map([
  ["/","home"],["/index.html","home"],
  ["/public/jadwal.html","schedule"],
  ["/public/favorit.html","favorites"],
  ["/public/riwayat.html","history"],
  ["/public/profile.html","profile"]
 ]);
 const GLOBAL_STYLES=new Set([
  "/css/page-transition.css",
  "/css/skeleton-loading.css",
  "/components/navigation/navigation.css"
 ]);
 let navigating=false;

 function routeFor(url){
  const path=new URL(url,location.href).pathname;
  return ROUTES.get(path)||null;
 }
 function updateNavigation(path){
  const key=routeFor(path);
  document.querySelectorAll("#anilixBottomNav a.nav-item").forEach(link=>{
   const active=routeFor(link.href)===key;
   link.classList.toggle("active",active);
   if(active)link.setAttribute("aria-current","page");
   else link.removeAttribute("aria-current");
  });
 }
 function wait(ms){return new Promise(resolve=>setTimeout(resolve,ms));}
 function pageStyles(parsed){
  const head=parsed.head;
  const links=[...head.querySelectorAll('link[rel="stylesheet"]')]
   .filter(link=>{
    const url=new URL(link.href,location.href);
    return !GLOBAL_STYLES.has(url.pathname);
   });
  const styles=[...head.querySelectorAll("style")];
  document.querySelectorAll("[data-anilix-page-style]").forEach(node=>node.remove());
  document.querySelectorAll("[data-anilix-page-link]").forEach(node=>node.remove());
  links.forEach(source=>{
   const link=document.createElement("link");
   link.rel="stylesheet";link.href=source.href;
   link.dataset.anilixPageLink="true";
   document.head.appendChild(link);
  });
  styles.forEach(source=>{
   const style=document.createElement("style");
   style.textContent=source.textContent;
   style.dataset.anilixPageStyle="true";
   document.head.appendChild(style);
  });
 }
 async function renderURL(url,{push=true}={}){
  const destination=new URL(url,location.href);
  const targetRoute=routeFor(destination);
  if(!targetRoute)return false;
  if(routeFor(location.href)===targetRoute&&destination.pathname===location.pathname){
   if(push&&destination.href!==location.href)history.pushState({anilixSPA:true}, "",destination.href);
   return true;
  }
  if(navigating)return true;
  navigating=true;
  try{
   const response=await fetch(destination.href,{credentials:"same-origin",cache:"no-cache"});
   if(!response.ok)throw new Error("HTTP "+response.status);
   const html=await response.text();
   const parsed=new DOMParser().parseFromString(html,"text/html");
   const incomingBody=parsed.body;
   if(!incomingBody||!incomingBody.children.length)throw new Error("Halaman tujuan kosong");

   // Keep the current page visible while the next document is fetched.
   document.body.classList.remove("page-enter");
   document.body.classList.add("page-exit");
   await wait(140);

   pageStyles(parsed);
   document.title=parsed.title||"ANILIX";
   const theme=parsed.querySelector('meta[name="theme-color"]');
   const currentTheme=document.querySelector('meta[name="theme-color"]');
   if(theme&&currentTheme)currentTheme.content=theme.content;

   const scripts=[...incomingBody.querySelectorAll("script:not([src])")]
    .map(script=>script.textContent)
    .filter(code=>code.trim()&&!/document\.documentElement\.classList\.add\(["']is-entering/.test(code));

   // Scripts are re-run in a block scope to prevent top-level const/let collisions
   // when the user visits the same tab again.
   document.body.className=incomingBody.className||"";
   document.body.innerHTML=incomingBody.innerHTML;
   document.body.classList.remove("page-exit");
   document.body.classList.add("page-enter");

   if(push)history.pushState({anilixSPA:true}, "",destination.pathname+destination.search+destination.hash);
   updateNavigation(destination.href);
   window.scrollTo({top:0,behavior:"instant"});

   for(const code of scripts){
    const script=document.createElement("script");
    script.textContent="{\n"+code+"\n"+
     "\nif(typeof createPosterPlaceholder==='function') window.createPosterPlaceholder=createPosterPlaceholder;"+
     "\n}";
    document.body.appendChild(script);
    script.remove();
   }
   window.dispatchEvent(new CustomEvent("anilix:pagechange",{detail:{page:targetRoute,url:destination.href}}));
   return true;
  }catch(error){
   console.error("[ANILIX SPA]",error);
   if(push)location.assign(destination.href);
   return false;
  }finally{
   navigating=false;
  }
 }

 document.addEventListener("click",event=>{
  if(event.defaultPrevented||event.button!==0||event.metaKey||event.ctrlKey||event.shiftKey||event.altKey)return;
  const element=event.target instanceof Element?event.target:null;
  const link=element?.closest("a[href]");
  if(!link||link.target==="_blank"||link.hasAttribute("download")||link.hasAttribute("data-no-transition"))return;
  const destination=new URL(link.href,location.href);
  if(destination.origin!==location.origin||!routeFor(destination))return;
  event.preventDefault();
  renderURL(destination.href,{push:true});
 },true);

 window.addEventListener("popstate",()=>{
  const destination=location.href;
  if(routeFor(destination))renderURL(destination,{push:false});
 });
 updateNavigation(location.href);
})();