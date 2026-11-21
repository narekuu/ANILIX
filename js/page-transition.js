/* ANILIX SPA tab router — BLIYO-inspired soft navigation for the five primary tabs. */
(() => {
 "use strict";
 if(window.__ANILIX_SPA_ROUTER__)return;
 window.__ANILIX_SPA_ROUTER__=true;
 const ROUTES=new Map([
  ["/","home"],["/index.html","home"],
  ["/jadwal.html","schedule"],["/public/jadwal.html","schedule"],
  ["/favorit.html","favorites"],["/public/favorit.html","favorites"],
  ["/riwayat.html","history"],["/public/riwayat.html","history"],
  ["/profile.html","profile"],["/public/profile.html","profile"]
 ]);
 const GLOBAL_STYLES=new Set(["/css/page-transition.css","/css/skeleton-loading.css","/components/navigation/navigation.css"]);
 let navigating=false;
 document.head.querySelectorAll("style").forEach(node=>node.dataset.anilixPageStyle="true");
 document.head.querySelectorAll('link[rel="stylesheet"]').forEach(node=>{
  if(!GLOBAL_STYLES.has(new URL(node.href,location.href).pathname))node.dataset.anilixPageLink="true";
 });
 function routeFor(url){return ROUTES.get(new URL(url,location.href).pathname)||null}
 function updateNavigation(url){
  const key=routeFor(url);
  document.querySelectorAll("#anilixBottomNav a.nav-item").forEach(link=>{
   const active=routeFor(link.href)===key;
   link.classList.toggle("active",active);
   if(active)link.setAttribute("aria-current","page");else link.removeAttribute("aria-current");
  });
 }
 const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
 function replacePageStyles(parsed,baseURL){
  document.querySelectorAll("[data-anilix-page-style],[data-anilix-page-link]").forEach(node=>node.remove());
  parsed.head.querySelectorAll('link[rel="stylesheet"]').forEach(source=>{
   const url=new URL(source.getAttribute("href"),baseURL);
   if(GLOBAL_STYLES.has(url.pathname))return;
   const link=document.createElement("link");
   link.rel="stylesheet";link.href=url.href;link.dataset.anilixPageLink="true";
   document.head.appendChild(link);
  });
  parsed.head.querySelectorAll("style").forEach(source=>{
   const style=document.createElement("style");
   style.textContent=source.textContent;style.dataset.anilixPageStyle="true";
   document.head.appendChild(style);
  });
 }
 async function renderURL(url,{push=true}={}){
  const destination=new URL(url,location.href),targetRoute=routeFor(destination);
  if(!targetRoute)return false;
  if(destination.pathname===location.pathname&&destination.search===location.search)return true;
  if(navigating)return true;
  navigating=true;
  try{
   const response=await fetch(destination.href,{credentials:"same-origin",cache:"no-cache"});
   if(!response.ok)throw new Error("HTTP "+response.status);
   const parsed=new DOMParser().parseFromString(await response.text(),"text/html");
   if(!parsed.body?.children.length)throw new Error("Halaman tujuan kosong");
   const scripts=[...parsed.body.querySelectorAll("script:not([src])")]
    .map(script=>script.textContent)
    .filter(code=>code.trim()&&!/document\.documentElement\.classList\.add\(["']is-entering/.test(code));
   document.body.classList.remove("page-enter");
   document.body.classList.add("page-exit");
   await wait(140);
   replacePageStyles(parsed,destination.href);
   document.title=parsed.title||"ANILIX";
   const incomingTheme=parsed.querySelector('meta[name="theme-color"]');
   const currentTheme=document.querySelector('meta[name="theme-color"]');
   if(incomingTheme&&currentTheme)currentTheme.content=incomingTheme.content;
   document.body.className=parsed.body.className||"";
   document.body.innerHTML=parsed.body.innerHTML;
   document.body.classList.add("page-enter");
   if(push)history.pushState({anilixSPA:true},"",destination.pathname+destination.search+destination.hash);
   updateNavigation(destination.href);
   window.scrollTo(0,0);
   // Block scope prevents const/let redeclaration when returning to a tab.
   for(const code of scripts){
    const script=document.createElement("script");
    script.textContent="{\n"+code+"\nif(typeof createPosterPlaceholder==='function')window.createPosterPlaceholder=createPosterPlaceholder;\n}";
    document.body.appendChild(script);script.remove();
   }
   window.dispatchEvent(new CustomEvent("anilix:pagechange",{detail:{page:targetRoute,url:destination.href}}));
   return true;
  }catch(error){
   console.error("[ANILIX SPA]",error);
   if(push)location.assign(destination.href);
   return false;
  }finally{navigating=false}
 }
 document.addEventListener("click",event=>{
  if(event.defaultPrevented||event.button!==0||event.metaKey||event.ctrlKey||event.shiftKey||event.altKey)return;
  const element=event.target instanceof Element?event.target:null;
  const link=element?.closest("a[href]");
  if(!link||link.target==="_blank"||link.hasAttribute("download")||link.hasAttribute("data-no-transition"))return;
  const destination=new URL(link.href,location.href);
  if(destination.origin!==location.origin||!routeFor(destination))return;
  event.preventDefault();renderURL(destination.href,{push:true});
 },true);
 window.addEventListener("popstate",()=>{if(routeFor(location.href))renderURL(location.href,{push:false})});
 updateNavigation(location.href);
})();