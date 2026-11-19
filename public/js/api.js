/* ANILIX SANKA API CLIENT
 * Browser pages call same-origin /api/catalog. Configure SANKA_API_BASE_URL
 * on the server; provider credentials must never be placed in browser code.
 */
(() => {
  "use strict";
  const request = async (path) => {
    const clean = String(path || "").trim();
    if (!clean.startsWith("/anime/") && !clean.startsWith("/episode/")) {
      throw new Error("Rute katalog tidak valid.");
    }
    const response = await fetch(`/api/catalog?path=${encodeURIComponent(clean)}`, {
      credentials: "same-origin", cache: "no-store", headers: { Accept: "application/json" }
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.message || `Sanka API gagal (${response.status}).`);
    return data;
  };
  window.SankaAPI = Object.freeze({
    getCatalog(path) { return request(path); },
    getAnime(id) { return request(`/anime/${encodeURIComponent(id)}`); },
    getEpisode(id) { return request(`/episode/${encodeURIComponent(id)}`); }
  });
})();
