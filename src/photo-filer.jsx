import React, { useState, useEffect, useRef, useMemo } from "react";

var C = {
  bg: "#080808", surface: "#0f0f0f", card: "#161616", cardAlt: "#1e1e1e",
  border: "#252525", borderHi: "#333333",
  cyan: "#0ea5e9", cyanDim: "rgba(14,165,233,0.08)", cyanMid: "rgba(14,165,233,0.18)",
  green: "#22c55e", greenDim: "rgba(34,197,94,0.12)",
  red: "#f43f5e", redDim: "rgba(244,63,94,0.12)",
  yellow: "#f59e0b", yellowDim: "rgba(245,158,11,0.12)",
  text: "#f0f0f0", soft: "#666666", muted: "#2a2a2a",
};

var FONT_LINK = "https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@300;400;500;600;700&family=IBM+Plex+Mono:wght@400;500&display=swap";

var PHOTO_CATEGORIES = [
  { id: "general", label: "General", icon: "📷" },
  { id: "issue", label: "Issue", icon: "\u26A0\uFE0F" },
  { id: "yearly", label: "Yearly Inspection", icon: "📅" },
  { id: "before-after", label: "Before / After", icon: "🔄", subs: ["Before", "After"] },
  { id: "tower", label: "Tower Condition", icon: "🏭" },
  { id: "work-order", label: "Work Order", icon: "📋" },
  { id: "handoff", label: "Tech Handoff", icon: "🤝", subs: ["Handing Off", "Receiving"] },
];

var DEFAULT_RECEIPT_CATS = ["Fuel", "Hotel", "Food", "Hardware Store", "USPS"];

function todayStr() {
  var d = new Date();
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}

function slugify(s) {
  if (!s) return "";
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function buildFilename(cat, sub, note, idx, total) {
  var parts = [todayStr()];
  if (cat) {
    var cs = slugify(cat);
    if (sub) cs = cs + "-" + slugify(sub);
    parts.push(cs);
  } else {
    parts.push("photo");
  }
  if (note) parts.push(slugify(note));
  if (total > 1) parts.push(String(idx + 1).padStart(2, "0"));
  return parts.join("_") + ".jpg";
}

function buildReceiptFilename(cat, note, idx, total) {
  var parts = [todayStr(), slugify(cat)];
  if (note) parts.push(slugify(note));
  if (total > 1) parts.push(String(idx + 1).padStart(2, "0"));
  return parts.join("_") + ".jpg";
}

function loadData(key, fb) {
  try { var s = localStorage.getItem(key); if (s) return JSON.parse(s); } catch (e) {}
  return fb;
}
function saveData(key, val) {
  try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) {}
}

var GAPI_LOADED = false;
var GTOKEN = null;

function getClientId() {
  if (typeof window !== "undefined" && window.GOOGLE_CLIENT_ID) return window.GOOGLE_CLIENT_ID;
  return "";
}

function loadGapi(cb) {
  if (GAPI_LOADED) { cb(); return; }
  var cid = getClientId();
  if (!cid) { cb("no_client_id"); return; }
  var sc = document.createElement("script");
  sc.src = "https://apis.google.com/js/api.js";
  sc.onload = function () {
    window.gapi.load("client:auth2", function () {
      window.gapi.client.init({ clientId: cid, scope: "https://www.googleapis.com/auth/drive.file", discoveryDocs: ["https://www.googleapis.com/discovery/v1/apis/drive/v3/rest"] })
        .then(function () { GAPI_LOADED = true; cb(); })
        .catch(function (err) { cb(err); });
    });
  };
  sc.onerror = function () { cb("script_error"); };
  document.body.appendChild(sc);
}

function gSignIn(cb) {
  if (!GAPI_LOADED) { loadGapi(function (e) { if (e) { cb(e); return; } gSignIn(cb); }); return; }
  var ai = window.gapi.auth2.getAuthInstance();
  if (ai.isSignedIn.get()) { GTOKEN = ai.currentUser.get().getAuthResponse().access_token; cb(null); }
  else { ai.signIn().then(function () { GTOKEN = ai.currentUser.get().getAuthResponse().access_token; cb(null); }).catch(function (e) { cb(e); }); }
}

function findOrMakeFolder(pid, name, cb) {
  var q = "mimeType='application/vnd.google-apps.folder' and name='" + name.replace(/'/g, "\\'") + "' and trashed=false";
  if (pid) q += " and '" + pid + "' in parents";
  window.gapi.client.drive.files.list({ q: q, fields: "files(id,name,webViewLink)", spaces: "drive" })
    .then(function (r) {
      var f = r.result.files;
      if (f && f.length > 0) { cb(null, f[0].id, f[0].webViewLink); }
      else {
        var m = { name: name, mimeType: "application/vnd.google-apps.folder" };
        if (pid) m.parents = [pid];
        window.gapi.client.drive.files.create({ resource: m, fields: "id,webViewLink" })
          .then(function (r2) { cb(null, r2.result.id, r2.result.webViewLink); })
          .catch(function (e) { cb(e); });
      }
    }).catch(function (e) { cb(e); });
}

function ensurePath(parts, cb) {
  var cp = null, ll = null, i = 0;
  function nx() {
    if (i >= parts.length) { cb(null, cp, ll); return; }
    findOrMakeFolder(cp, parts[i], function (e, id, lk) {
      if (e) { cb(e); return; }
      cp = id; ll = lk; i++; nx();
    });
  }
  nx();
}

function uploadFile(fid, fname, blob, cb) {
  var meta = { name: fname, mimeType: blob.type || "image/jpeg", parents: [fid] };
  var fd = new FormData();
  fd.append("metadata", new Blob([JSON.stringify(meta)], { type: "application/json" }));
  fd.append("file", blob);
  fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name", {
    method: "POST", headers: { Authorization: "Bearer " + GTOKEN }, body: fd,
  }).then(function (r) { return r.json(); })
    .then(function (d) { if (d.error) cb(d.error); else cb(null, d); })
    .catch(function (e) { cb(e); });
}

var CSS = "\
@import url('" + FONT_LINK + "');\
*{margin:0;padding:0;box-sizing:border-box;-webkit-tap-highlight-color:transparent}\
body{background:" + C.bg + ";color:" + C.text + ";font-family:'IBM Plex Sans',sans-serif;overflow-x:hidden}\
.pf-app{min-height:100vh;min-height:100dvh;display:flex;flex-direction:column;max-width:480px;margin:0 auto;padding-bottom:80px}\
.pf-header{display:flex;align-items:center;justify-content:space-between;padding:16px 16px 12px;border-bottom:1px solid " + C.border + "}\
.pf-logo{font-family:'IBM Plex Mono',monospace;font-size:15px;font-weight:500;color:" + C.cyan + ";letter-spacing:.5px}\
.pf-logo span{color:" + C.soft + ";font-weight:400}\
.pf-hdr-r{display:flex;align-items:center;gap:8px}\
.pf-ibtn{background:none;border:1px solid " + C.border + ";color:" + C.soft + ";width:36px;height:36px;border-radius:8px;display:flex;align-items:center;justify-content:center;font-size:16px;cursor:pointer}\
.pf-ibtn:active{background:" + C.cyanDim + ";border-color:" + C.cyan + ";color:" + C.cyan + "}\
.pf-st{display:inline-flex;align-items:center;gap:4px;padding:5px 10px;border-radius:6px;font-size:11px;font-family:'IBM Plex Mono',monospace}\
.pf-st.on{background:" + C.greenDim + ";color:" + C.green + "}\
.pf-st.off{background:" + C.yellowDim + ";color:" + C.yellow + "}\
.pf-tabs{display:flex;border-bottom:1px solid " + C.border + "}\
.pf-tab{flex:1;padding:14px;text-align:center;font-size:14px;font-weight:500;color:" + C.soft + ";cursor:pointer;border-bottom:2px solid transparent;font-family:'IBM Plex Sans',sans-serif;background:none;border-top:none;border-left:none;border-right:none}\
.pf-tab.a{color:" + C.cyan + ";border-bottom-color:" + C.cyan + "}\
.pf-tab:active{background:" + C.cyanDim + "}\
.pf-cap{padding:20px 16px;display:flex;flex-direction:column;align-items:center;gap:16px}\
.pf-cbtns{display:flex;gap:12px;width:100%}\
.pf-cbtn{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;padding:28px 16px;background:" + C.card + ";border:2px dashed " + C.border + ";border-radius:16px;color:" + C.text + ";font-size:14px;font-weight:500;font-family:'IBM Plex Sans',sans-serif;cursor:pointer}\
.pf-cbtn:active{border-color:" + C.cyan + ";background:" + C.cyanDim + "}\
.pf-cbtn .ic{font-size:36px}\
.pf-cbtn input{display:none}\
.pf-thmbs{width:100%;padding:0 16px}\
.pf-tl{font-size:12px;color:" + C.soft + ";font-family:'IBM Plex Mono',monospace;margin-bottom:8px;text-transform:uppercase;letter-spacing:1px}\
.pf-tg{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}\
.pf-th{position:relative;aspect-ratio:1;border-radius:10px;overflow:hidden;border:1px solid " + C.border + "}\
.pf-th img{width:100%;height:100%;object-fit:cover}\
.pf-thx{position:absolute;top:4px;right:4px;width:24px;height:24px;border-radius:50%;background:rgba(0,0,0,.75);border:1px solid " + C.border + ";color:" + C.red + ";font-size:14px;display:flex;align-items:center;justify-content:center;cursor:pointer;line-height:1}\
.pf-thx:active{background:" + C.red + ";color:#fff}\
.pf-ms{padding:0 16px 12px;display:flex;gap:6px;overflow-x:auto;-webkit-overflow-scrolling:touch}\
.pf-ms::-webkit-scrollbar{display:none}\
.pf-mi{width:48px;height:48px;border-radius:6px;overflow:hidden;flex-shrink:0;border:1px solid " + C.border + "}\
.pf-mi img{width:100%;height:100%;object-fit:cover}\
.pf-ma{width:48px;height:48px;border-radius:6px;display:flex;align-items:center;justify-content:center;border:1px dashed " + C.border + ";color:" + C.soft + ";font-size:18px;flex-shrink:0;cursor:pointer}\
.pf-sec{padding:16px;display:flex;flex-direction:column;gap:16px}\
.pf-sl{font-size:11px;font-family:'IBM Plex Mono',monospace;color:" + C.soft + ";text-transform:uppercase;letter-spacing:1.5px;margin-bottom:2px}\
.pf-pills{display:flex;flex-wrap:wrap;gap:8px}\
.pf-pill{padding:10px 14px;border-radius:10px;background:" + C.card + ";border:1px solid " + C.border + ";color:" + C.text + ";font-size:13px;font-weight:500;font-family:'IBM Plex Sans',sans-serif;cursor:pointer;display:flex;align-items:center;gap:6px}\
.pf-pill:active,.pf-pill.on{background:" + C.cyanDim + ";border-color:" + C.cyan + ";color:" + C.cyan + "}\
.pf-sr{display:flex;gap:8px;margin-top:4px}\
.pf-sp{padding:8px 16px;border-radius:8px;background:" + C.surface + ";border:1px solid " + C.border + ";color:" + C.soft + ";font-size:12px;font-weight:500;font-family:'IBM Plex Sans',sans-serif;cursor:pointer}\
.pf-sp:active,.pf-sp.on{background:" + C.cyanDim + ";border-color:" + C.cyan + ";color:" + C.cyan + "}\
.pf-inp{width:100%;padding:12px 14px;background:" + C.card + ";border:1px solid " + C.border + ";border-radius:10px;color:" + C.text + ";font-size:14px;font-family:'IBM Plex Sans',sans-serif;outline:none}\
.pf-inp:focus{border-color:" + C.cyan + "}\
.pf-inp::placeholder{color:" + C.soft + "}\
.pf-sw{position:relative}\
.pf-si{position:absolute;left:12px;top:50%;transform:translateY(-50%);color:" + C.soft + ";font-size:16px;pointer-events:none}\
.pf-sinp{padding-left:38px}\
.pf-recs{display:flex;gap:8px;overflow-x:auto;padding-bottom:4px;-webkit-overflow-scrolling:touch}\
.pf-recs::-webkit-scrollbar{display:none}\
.pf-rc{flex-shrink:0;padding:8px 14px;border-radius:8px;background:" + C.card + ";border:1px solid " + C.border + ";color:" + C.text + ";font-size:12px;font-weight:500;font-family:'IBM Plex Sans',sans-serif;cursor:pointer;white-space:nowrap}\
.pf-rc:active{background:" + C.cyanDim + ";border-color:" + C.cyan + ";color:" + C.cyan + "}\
.pf-ch{display:flex;align-items:center;justify-content:space-between;padding:10px 0 6px;border-bottom:1px solid " + C.muted + ";margin-top:12px}\
.pf-cn{font-size:12px;font-family:'IBM Plex Mono',monospace;color:" + C.cyan + ";text-transform:uppercase;letter-spacing:1px}\
.pf-cc{font-size:11px;color:" + C.soft + ";font-family:'IBM Plex Mono',monospace}\
.pf-srow{display:flex;align-items:center;justify-content:space-between;padding:11px 12px;border-radius:8px;cursor:pointer}\
.pf-srow:active{background:" + C.cyanDim + "}\
.pf-sn{font-size:14px;font-weight:500}\
.pf-scity{font-size:11px;color:" + C.soft + ";font-family:'IBM Plex Mono',monospace}\
.pf-sopen{font-size:18px;color:" + C.soft + ";padding:4px 8px;cursor:pointer;background:none;border:none}\
.pf-sopen:active{color:" + C.cyan + "}\
.pf-sel{display:flex;align-items:center;justify-content:space-between;padding:12px 14px;background:" + C.cyanDim + ";border:1px solid " + C.cyan + ";border-radius:10px;margin-bottom:12px}\
.pf-seln{font-size:14px;font-weight:600;color:" + C.cyan + "}\
.pf-sels{font-size:11px;color:" + C.soft + ";font-family:'IBM Plex Mono',monospace}\
.pf-selx{background:none;border:none;color:" + C.soft + ";font-size:18px;cursor:pointer;padding:4px}\
.pf-path{padding:12px 14px;background:" + C.surface + ";border:1px solid " + C.border + ";border-radius:10px;font-family:'IBM Plex Mono',monospace;font-size:12px;color:" + C.soft + ";display:flex;align-items:center;gap:8px}\
.pf-path .t{color:" + C.text + "}\
.pf-fns{padding:12px 14px;background:" + C.surface + ";border:1px solid " + C.border + ";border-radius:10px;font-family:'IBM Plex Mono',monospace;font-size:11px;color:" + C.soft + ";display:flex;flex-direction:column;gap:2px;max-height:100px;overflow-y:auto}\
.pf-fns span{color:" + C.text + "}\
.pf-btn{width:100%;padding:16px;border-radius:12px;background:" + C.cyan + ";border:none;color:#000;font-size:15px;font-weight:600;font-family:'IBM Plex Sans',sans-serif;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:8px}\
.pf-btn:active{transform:scale(.98)}\
.pf-btn:disabled{opacity:.4;pointer-events:none}\
.pf-btn.sec{background:" + C.card + ";color:" + C.text + ";border:1px solid " + C.border + "}\
.pf-prog{width:100%;height:6px;background:" + C.muted + ";border-radius:3px;overflow:hidden}\
.pf-progb{height:100%;background:" + C.cyan + ";border-radius:3px;transition:width .3s ease}\
.pf-mng{padding:16px;display:flex;flex-direction:column;gap:12px}\
.pf-ar{display:flex;gap:8px}\
.pf-ai{flex:1;padding:10px 12px;background:" + C.card + ";border:1px solid " + C.border + ";border-radius:8px;color:" + C.text + ";font-size:14px;font-family:'IBM Plex Sans',sans-serif;outline:none}\
.pf-ai:focus{border-color:" + C.cyan + "}\
.pf-ai::placeholder{color:" + C.soft + "}\
.pf-ab{padding:10px 16px;background:" + C.cyan + ";border:none;border-radius:8px;color:#000;font-size:13px;font-weight:600;font-family:'IBM Plex Sans',sans-serif;cursor:pointer;white-space:nowrap}\
.pf-ab:disabled{opacity:.4}\
.pf-db{background:none;border:1px solid " + C.border + ";color:" + C.red + ";width:32px;height:32px;border-radius:6px;display:flex;align-items:center;justify-content:center;font-size:14px;cursor:pointer;flex-shrink:0}\
.pf-db:active{background:" + C.redDim + ";border-color:" + C.red + "}\
.pf-mi2{display:flex;align-items:center;gap:8px;padding:10px 12px;background:" + C.card + ";border:1px solid " + C.border + ";border-radius:8px}\
.pf-mi2i{flex:1;min-width:0}\
.pf-mi2n{font-size:13px;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}\
.pf-mi2s{font-size:11px;color:" + C.soft + ";font-family:'IBM Plex Mono',monospace}\
.pf-ccard{background:" + C.card + ";border:1px solid " + C.border + ";border-radius:10px;overflow:hidden;margin-bottom:8px}\
.pf-ctap{display:flex;align-items:center;justify-content:space-between;padding:14px;cursor:pointer}\
.pf-ctap:active{background:" + C.cyanDim + "}\
.pf-ctl{display:flex;flex-direction:column;gap:2px}\
.pf-ctt{font-size:14px;font-weight:600}\
.pf-ctc{font-size:11px;color:" + C.soft + ";font-family:'IBM Plex Mono',monospace}\
.pf-wel{display:flex;flex-direction:column;align-items:center;justify-content:center;padding:60px 24px;text-align:center;gap:16px}\
.pf-wel-ic{font-size:56px}\
.pf-wel-t{font-size:20px;font-weight:600}\
.pf-wel-s{font-size:14px;color:" + C.soft + ";line-height:1.6;max-width:300px}\
.pf-toast{position:fixed;bottom:90px;left:50%;transform:translateX(-50%);padding:12px 20px;border-radius:10px;font-size:13px;font-weight:500;font-family:'IBM Plex Sans',sans-serif;z-index:999;animation:pfu .3s ease;white-space:nowrap}\
.pf-toast.ok{background:" + C.green + ";color:#000}\
.pf-toast.err{background:" + C.red + ";color:#fff}\
.pf-toast.inf{background:" + C.card + ";color:" + C.text + ";border:1px solid " + C.border + "}\
@keyframes pfu{from{opacity:0;transform:translate(-50%,20px)}to{opacity:1;transform:translate(-50%,0)}}\
.pf-ov{position:fixed;inset:0;background:rgba(0,0,0,.7);display:flex;align-items:center;justify-content:center;z-index:1000;padding:24px}\
.pf-dlg{background:" + C.card + ";border:1px solid " + C.border + ";border-radius:14px;padding:24px;max-width:340px;width:100%}\
.pf-dlg-t{font-size:16px;font-weight:600;margin-bottom:8px}\
.pf-dlg-s{font-size:13px;color:" + C.soft + ";margin-bottom:20px;line-height:1.5}\
.pf-dlg-b{display:flex;gap:10px}\
.pf-dlg-b button{flex:1;padding:12px;border-radius:8px;font-size:13px;font-weight:600;font-family:'IBM Plex Sans',sans-serif;cursor:pointer;border:none}\
.pf-dlg-c{background:" + C.surface + ";color:" + C.text + ";border:1px solid " + C.border + " !important}\
.pf-dlg-d{background:" + C.red + ";color:#fff}\
.pf-back{display:flex;align-items:center;gap:6px;padding:12px 16px;font-size:13px;color:" + C.soft + ";cursor:pointer;font-family:'IBM Plex Sans',sans-serif;border:none;background:none}\
.pf-back:active{color:" + C.cyan + "}\
.pf-rcard{display:flex;align-items:center;justify-content:space-between;padding:14px;background:" + C.card + ";border:1px solid " + C.border + ";border-radius:10px;cursor:pointer}\
.pf-rcard:active{background:" + C.cyanDim + ";border-color:" + C.cyan + "}\
.pf-rcn{font-size:14px;font-weight:500}\
.pf-rco{font-size:18px;color:" + C.soft + "}\
";

export default function PhotoFiler() {
  var _tab = useState("stores"); var tab = _tab[0], setTab = _tab[1];
  var _screen = useState("home"); var screen = _screen[0], setScreen = _screen[1];
  var _photos = useState([]); var photos = _photos[0], setPhotos = _photos[1];
  var _chains = useState(function () { return loadData("aq_pf_chains", []); }); var chains = _chains[0], setChainsRaw = _chains[1];
  function setChains(v) { var n = typeof v === "function" ? v(chains) : v; setChainsRaw(n); saveData("aq_pf_chains", n); }
  var _rcats = useState(function () { return loadData("aq_pf_rcats", DEFAULT_RECEIPT_CATS); }); var rcats = _rcats[0], setRcatsRaw = _rcats[1];
  function setRcats(v) { var n = typeof v === "function" ? v(rcats) : v; setRcatsRaw(n); saveData("aq_pf_rcats", n); }
  var _selStore = useState(null); var selStore = _selStore[0], setSelStore = _selStore[1];
  var _selCat = useState(null); var selCat = _selCat[0], setSelCat = _selCat[1];
  var _subOpt = useState(null); var subOpt = _subOpt[0], setSubOpt = _subOpt[1];
  var _note = useState(""); var note = _note[0], setNote = _note[1];
  var _selRcat = useState(null); var selRcat = _selRcat[0], setSelRcat = _selRcat[1];
  var _rnote = useState(""); var rnote = _rnote[0], setRnote = _rnote[1];
  var _search = useState(""); var search = _search[0], setSearch = _search[1];
  var _recents = useState(function () { return loadData("aq_pf_recents", []); }); var recents = _recents[0], setRecentsRaw = _recents[1];
  function addRecent(st) {
    var n = recents.filter(function (r) { return r.id !== st.id; });
    n.unshift({ id: st.id, name: st.name, chain: st.chain });
    if (n.length > 5) n = n.slice(0, 5);
    setRecentsRaw(n); saveData("aq_pf_recents", n);
  }
  var _uping = useState(false); var uping = _uping[0], setUping = _uping[1];
  var _prog = useState(0); var prog = _prog[0], setProg = _prog[1];
  var _done = useState(false); var done = _done[0], setDone = _done[1];
  var _driveOk = useState(false); var driveOk = _driveOk[0], setDriveOk = _driveOk[1];
  var _flinks = useState(function () { return loadData("aq_pf_links", {}); }); var flinks = _flinks[0], setFlinksRaw = _flinks[1];
  function saveFlink(k, lk) { var n = Object.assign({}, flinks); n[k] = lk; setFlinksRaw(n); saveData("aq_pf_links", n); }
  var _mchain = useState(null); var mchain = _mchain[0], setMchain = _mchain[1];
  var _acn = useState(""); var acn = _acn[0], setAcn = _acn[1];
  var _asn = useState(""); var asn = _asn[0], setAsn = _asn[1];
  var _asc = useState(""); var asc = _asc[0], setAsc = _asc[1];
  var _ass = useState("NV"); var ass = _ass[0], setAss = _ass[1];
  var _arcn = useState(""); var arcn = _arcn[0], setArcn = _arcn[1];
  var _toast = useState(null); var toast = _toast[0], setToast = _toast[1];
  var _cfm = useState(null); var cfm = _cfm[0], setCfm = _cfm[1];
  var ttRef = useRef(null);

  function showT(msg, tp) {
    if (ttRef.current) clearTimeout(ttRef.current);
    setToast({ m: msg, t: tp || "inf" });
    ttRef.current = setTimeout(function () { setToast(null); }, 3000);
  }

  var allStores = useMemo(function () {
    var l = [];
    chains.forEach(function (ch) {
      (ch.stores || []).forEach(function (s) {
        l.push({ id: ch.name + "_" + s.number, name: ch.name + " #" + s.number, chain: ch.name, city: s.city || "", state: s.state || "", number: s.number });
      });
    });
    return l;
  }, [chains]);

  var filtGrp = useMemo(function () {
    var q = search.toLowerCase().trim();
    var g = [];
    chains.forEach(function (ch) {
      var f = (ch.stores || []).filter(function (s) {
        if (!q) return true;
        return (ch.name + " " + s.number).toLowerCase().indexOf(q) >= 0 || (s.city || "").toLowerCase().indexOf(q) >= 0;
      });
      if (f.length > 0) g.push({ chain: ch.name, stores: f });
    });
    return g;
  }, [chains, search]);

  useEffect(function () {
    var cid = getClientId();
    if (cid) { loadGapi(function (e) { if (e) return; try { var a = window.gapi.auth2.getAuthInstance(); if (a && a.isSignedIn.get()) { GTOKEN = a.currentUser.get().getAuthResponse().access_token; setDriveOk(true); } } catch (x) {} }); }
  }, []);

  function handleCap(e) {
    var files = e.target.files;
    if (!files || files.length === 0) return;
    var arr = [];
    for (var i = 0; i < files.length; i++) {
      arr.push({ id: Date.now() + "_" + i + "_" + Math.random().toString(36).slice(2, 6), file: files[i], url: URL.createObjectURL(files[i]) });
    }
    setPhotos(function (p) { return p.concat(arr); });
    e.target.value = "";
  }

  function rmPhoto(id) {
    setPhotos(function (p) { return p.filter(function (x) { if (x.id === id) { URL.revokeObjectURL(x.url); return false; } return true; }); });
  }

  function pickStore(st) { setSelStore(st); addRecent(st); }

  var catObj = selCat ? PHOTO_CATEGORIES.find(function (c) { return c.id === selCat; }) : null;

  var fnames = photos.map(function (p, i) {
    if (tab === "receipts") return buildReceiptFilename(selRcat || "receipt", rnote, i, photos.length);
    return buildFilename(catObj ? catObj.label : "", subOpt, note, i, photos.length);
  });

  function storePath() { return selStore ? selStore.chain + "/" + selStore.number + "/Photos/" : ""; }
  function rcatPath() { return selRcat ? "Receipts/" + selRcat + "/" : ""; }

  function doUpload() {
    var cid = getClientId();
    if (!cid) { showT("Drive not configured", "err"); return; }
    setUping(true); setProg(0);
    gSignIn(function (e) {
      if (e) { showT("Sign-in failed", "err"); setUping(false); return; }
      setDriveOk(true);
      var pp, lk;
      if (tab === "receipts") { pp = ["Receipts", selRcat]; lk = "r_" + slugify(selRcat); }
      else { pp = [selStore.chain, selStore.number, "Photos"]; lk = "s_" + selStore.chain + "_" + selStore.number; }
      ensurePath(pp, function (e2, fid, fl) {
        if (e2) { showT("Folder error", "err"); setUping(false); return; }
        if (fl) saveFlink(lk, fl);
        var tot = photos.length, up = 0;
        function nx(i) {
          if (i >= tot) { setProg(100); setUping(false); setDone(true); showT(tot + " photo" + (tot > 1 ? "s" : "") + " uploaded!", "ok"); return; }
          uploadFile(fid, fnames[i], photos[i].file, function (e3) {
            if (e3) { showT("Upload failed #" + (i + 1), "err"); setUping(false); return; }
            up++; setProg(Math.round((up / tot) * 100)); nx(i + 1);
          });
        }
        nx(0);
      });
    });
  }

  function doDL() {
    photos.forEach(function (p, i) {
      var a = document.createElement("a"); a.href = p.url; a.download = fnames[i] || "photo.jpg";
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
    });
    showT(photos.length + " downloaded", "ok");
  }

  function openSF(st) {
    var k = "s_" + st.chain + "_" + st.number;
    if (flinks[k]) { window.open(flinks[k], "_blank"); return; }
    var cid = getClientId();
    if (!cid) { showT("Drive not configured", "err"); return; }
    gSignIn(function (e) {
      if (e) { showT("Sign-in failed", "err"); return; }
      setDriveOk(true);
      ensurePath([st.chain, st.number, "Photos"], function (e2, fid, lk) {
        if (e2) { showT("Folder error", "err"); return; }
        if (lk) { saveFlink(k, lk); window.open(lk, "_blank"); }
      });
    });
  }

  function openRF(cat) {
    var k = "r_" + slugify(cat);
    if (flinks[k]) { window.open(flinks[k], "_blank"); return; }
    var cid = getClientId();
    if (!cid) { showT("Drive not configured", "err"); return; }
    gSignIn(function (e) {
      if (e) { showT("Sign-in failed", "err"); return; }
      setDriveOk(true);
      ensurePath(["Receipts", cat], function (e2, fid, lk) {
        if (e2) { showT("Folder error", "err"); return; }
        if (lk) { saveFlink(k, lk); window.open(lk, "_blank"); }
      });
    });
  }

  function doReset() {
    photos.forEach(function (p) { URL.revokeObjectURL(p.url); });
    setPhotos([]); setSelStore(null); setSelCat(null); setSubOpt(null);
    setNote(""); setSelRcat(null); setRnote(""); setDone(false); setProg(0); setScreen("home");
  }

  function addChain() {
    var nm = acn.trim();
    if (!nm) return;
    if (chains.find(function (c) { return c.name.toLowerCase() === nm.toLowerCase(); })) { showT("Already exists", "err"); return; }
    setChains(function (p) { return p.concat([{ name: nm, stores: [] }]); });
    setAcn(""); showT("Added " + nm, "ok");
  }

  function rmChain(nm) {
    setChains(function (p) { return p.filter(function (c) { return c.name !== nm; }); });
    setCfm(null); showT(nm + " removed", "inf");
  }

  function addStore() {
    if (!asn.trim() || !mchain) return;
    setChains(function (p) {
      return p.map(function (ch) {
        if (ch.name !== mchain) return ch;
        if ((ch.stores || []).find(function (s) { return s.number === asn.trim(); })) return ch;
        return Object.assign({}, ch, { stores: (ch.stores || []).concat([{ number: asn.trim(), city: asc.trim() || "Las Vegas", state: ass || "NV" }]) });
      });
    });
    showT("Added #" + asn.trim(), "ok"); setAsn(""); setAsc("");
  }

  function rmStore(cn, num) {
    setChains(function (p) {
      return p.map(function (ch) {
        if (ch.name !== cn) return ch;
        return Object.assign({}, ch, { stores: (ch.stores || []).filter(function (s) { return s.number !== num; }) });
      });
    });
    setCfm(null); showT("#" + num + " removed", "inf");
  }

  function addRcat() {
    var nm = arcn.trim();
    if (!nm) return;
    if (rcats.indexOf(nm) >= 0) { showT("Already exists", "err"); return; }
    setRcats(function (p) { return p.concat([nm]); });
    setArcn(""); showT("Added " + nm, "ok");
  }

  function rmRcat(nm) {
    setRcats(function (p) { return p.filter(function (c) { return c !== nm; }); });
    setCfm(null); showT(nm + " removed", "inf");
  }

  var chainStoreList = (function() {
    var ch = chains.find(function (c) { return c.name === mchain; });
    var sts = ch ? (ch.stores || []) : [];
    if (sts.length === 0) return <div style={{ color: C.soft, fontSize: 13, padding: "12px 0" }}>No stores yet.</div>;
    return sts.map(function (s) {
      return (
        <div key={s.number} className="pf-mi2">
          <div className="pf-mi2i">
            <div className="pf-mi2n">{mchain} #{s.number}</div>
            <div className="pf-mi2s">{s.city || "Las Vegas"}, {s.state || "NV"}</div>
          </div>
          <button className="pf-db" onClick={function () { setCfm({ title: "Remove Store", text: "Remove #" + s.number + "?", action: function () { rmStore(mchain, s.number); } }); }}>{"✕"}</button>
        </div>
      );
    });
  }());

  var canUp = photos.length > 0;
  if (tab === "stores") { canUp = canUp && selStore; if (catObj && catObj.subs && !subOpt) canUp = false; }
  else { canUp = canUp && selRcat; }

  // ==========================================================================
  // RENDER
  // ==========================================================================
  return (
    <div className="pf-app">
      <style>{CSS}</style>

      {/* Header */}
      <div className="pf-header">
        <div className="pf-logo">AQUAFIELD <span>Photo Filer</span></div>
        <div className="pf-hdr-r">
          <span className={"pf-st " + (driveOk ? "on" : "off")}>{driveOk ? "\u2713 Drive" : "\u25CB Drive"}</span>
          {screen === "home" && <button className="pf-ibtn" onClick={function () { setScreen("manage"); }}>{"\u2699"}</button>}
        </div>
      </div>

      {/* Toast */}
      {toast && <div className={"pf-toast " + toast.t}>{toast.m}</div>}

      {/* Confirm Dialog */}
      {cfm && (
        <div className="pf-ov" onClick={function () { setCfm(null); }}>
          <div className="pf-dlg" onClick={function (e) { e.stopPropagation(); }}>
            <div className="pf-dlg-t">{cfm.title}</div>
            <div className="pf-dlg-s">{cfm.text}</div>
            <div className="pf-dlg-b">
              <button className="pf-dlg-c" onClick={function () { setCfm(null); }}>Cancel</button>
              <button className="pf-dlg-d" onClick={cfm.action}>Remove</button>
            </div>
          </div>
        </div>
      )}

      {/* Tabs */}
      {(screen === "home" || screen === "capture" || screen === "file") && (
        <div className="pf-tabs">
          <button className={"pf-tab" + (tab === "stores" ? " a" : "")} onClick={function () { setTab("stores"); if (screen !== "home") doReset(); }}>{"📷"} Stores</button>
          <button className={"pf-tab" + (tab === "receipts" ? " a" : "")} onClick={function () { setTab("receipts"); if (screen !== "home") doReset(); }}>{"🧾"} Receipts</button>
        </div>
      )}

      {/* === MANAGE: Chains list === */}
      {screen === "manage" && !mchain && (
        <div>
          <button className="pf-back" onClick={function () { setScreen("home"); }}>{"\u2190"} Back</button>
          <div className="pf-mng">
            <div className="pf-sl">Add Chain</div>
            <div className="pf-ar">
              <input className="pf-ai" placeholder="Chain name (e.g. Walmart)" value={acn} onChange={function (e) { setAcn(e.target.value); }} onKeyDown={function (e) { if (e.key === "Enter") addChain(); }} />
              <button className="pf-ab" onClick={addChain} disabled={!acn.trim()}>Add</button>
            </div>
            <div className="pf-sl" style={{ marginTop: 16 }}>Your Chains ({chains.length})</div>
            {chains.length === 0 && <div style={{ color: C.soft, fontSize: 13, padding: "12px 0" }}>No chains yet. Add your first chain above.</div>}
            {chains.map(function (ch) {
              var ct = (ch.stores || []).length;
              return (
                <div key={ch.name} className="pf-ccard">
                  <div className="pf-ctap" onClick={function () { setMchain(ch.name); }}>
                    <div className="pf-ctl">
                      <div className="pf-ctt">{ch.name}</div>
                      <div className="pf-ctc">{ct} store{ct !== 1 ? "s" : ""}</div>
                    </div>
                    <span style={{ color: C.cyan, fontSize: 13 }}>{"\u2192"}</span>
                  </div>
                </div>
              );
            })}
            <div className="pf-sl" style={{ marginTop: 24 }}>Receipt Categories ({rcats.length})</div>
            <div className="pf-ar">
              <input className="pf-ai" placeholder="New category (e.g. Tools)" value={arcn} onChange={function (e) { setArcn(e.target.value); }} onKeyDown={function (e) { if (e.key === "Enter") addRcat(); }} />
              <button className="pf-ab" onClick={addRcat} disabled={!arcn.trim()}>Add</button>
            </div>
            {rcats.map(function (cat) {
              return (
                <div key={cat} className="pf-mi2">
                  <div className="pf-mi2i"><div className="pf-mi2n">{cat}</div></div>
                  <button className="pf-db" onClick={function () { setCfm({ title: "Remove Category", text: 'Remove "' + cat + '"?', action: function () { rmRcat(cat); } }); }}>{"\u2715"}</button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* === MANAGE: Stores inside a chain === */}
      {screen === "manage" && mchain && (
        <div>
          <button className="pf-back" onClick={function () { setMchain(null); }}>{"\u2190"} Back to chains</button>
          <div className="pf-mng">
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div className="pf-sl">{mchain} Stores</div>
              <button className="pf-db" style={{ width: "auto", padding: "6px 12px", fontSize: 11 }} onClick={function () {
                setCfm({ title: "Remove Chain", text: "Remove " + mchain + " and all stores?", action: function () { rmChain(mchain); setMchain(null); } });
              }}>Remove Chain</button>
            </div>
            <div className="pf-ar">
              <input className="pf-ai" placeholder="Store # (e.g. 5070)" value={asn} onChange={function (e) { setAsn(e.target.value); }} onKeyDown={function (e) { if (e.key === "Enter") addStore(); }} />
              <button className="pf-ab" onClick={addStore} disabled={!asn.trim()}>Add</button>
            </div>
            <div className="pf-ar">
              <input className="pf-ai" placeholder="City (default: Las Vegas)" value={asc} onChange={function (e) { setAsc(e.target.value); }} />
              <select className="pf-ai" style={{ maxWidth: 70, padding: "10px 6px" }} value={ass} onChange={function (e) { setAss(e.target.value); }}>
                <option value="NV">NV</option><option value="AZ">AZ</option><option value="CA">CA</option><option value="UT">UT</option>
              </select>
            </div>
            {chainStoreList}
          </div>
        </div>
      )}

      {/* === HOME: Stores tab === */}
      {screen === "home" && tab === "stores" && (
        <div>
          {allStores.length === 0 ? (
            <div className="pf-wel">
              <div className="pf-wel-ic">{"📷"}</div>
              <div className="pf-wel-t">Welcome to Photo Filer</div>
              <div className="pf-wel-s">Add your chains and stores to get started. Photos upload directly to Google Drive.</div>
              <button className="pf-btn" style={{ maxWidth: 240 }} onClick={function () { setScreen("manage"); }}>{"\u2699"} Set Up Stores</button>
            </div>
          ) : (
            <div>
              <div className="pf-cap">
                <div className="pf-cbtns">
                  <label className="pf-cbtn"><span className="ic">{"📷"}</span>Camera<input type="file" accept="image/*" capture="environment" onChange={function (e) { handleCap(e); setScreen("capture"); }} /></label>
                  <label className="pf-cbtn"><span className="ic">{"🖼\uFE0F"}</span>Gallery<input type="file" accept="image/*" multiple onChange={function (e) { handleCap(e); setScreen("capture"); }} /></label>
                </div>
              </div>
              <div className="pf-sec">
                <div className="pf-sl">Your Stores</div>
                {chains.map(function (ch) {
                  if (!ch.stores || ch.stores.length === 0) return null;
                  return (
                    <div key={ch.name}>
                      <div className="pf-ch"><span className="pf-cn">{ch.name}</span><span className="pf-cc">{ch.stores.length}</span></div>
                      {ch.stores.map(function (s) {
                        var st = { chain: ch.name, number: s.number, name: ch.name + " #" + s.number, city: s.city, state: s.state };
                        return (
                          <div key={s.number} className="pf-srow">
                            <div><div className="pf-sn">{ch.name} #{s.number}</div><div className="pf-scity">{s.city || "Las Vegas"}, {s.state || "NV"}</div></div>
                            <button className="pf-sopen" onClick={function (e) { e.stopPropagation(); openSF(st); }}>{"📂"}</button>
                          </div>
                        );
                      })}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* === HOME: Receipts tab === */}
      {screen === "home" && tab === "receipts" && (
        <div>
          {rcats.length === 0 ? (
            <div className="pf-wel">
              <div className="pf-wel-ic">{"🧾"}</div>
              <div className="pf-wel-t">Receipt Categories</div>
              <div className="pf-wel-s">Add receipt categories to get started.</div>
              <button className="pf-btn" style={{ maxWidth: 240 }} onClick={function () { setScreen("manage"); }}>{"\u2699"} Set Up Categories</button>
            </div>
          ) : (
            <div>
              <div className="pf-cap">
                <div className="pf-cbtns">
                  <label className="pf-cbtn"><span className="ic">{"📷"}</span>Camera<input type="file" accept="image/*" capture="environment" onChange={function (e) { handleCap(e); setScreen("capture"); }} /></label>
                  <label className="pf-cbtn"><span className="ic">{"🖼\uFE0F"}</span>Gallery<input type="file" accept="image/*" multiple onChange={function (e) { handleCap(e); setScreen("capture"); }} /></label>
                </div>
              </div>
              <div className="pf-sec">
                <div className="pf-sl">Receipt Categories</div>
                {rcats.map(function (cat) {
                  return <div key={cat} className="pf-rcard" onClick={function () { openRF(cat); }}><div className="pf-rcn">{cat}</div><span className="pf-rco">{"📂"}</span></div>;
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* === CAPTURE: Take/add more photos === */}
      {screen === "capture" && (
        <div>
          <div className="pf-cap">
            <div className="pf-cbtns">
              <label className="pf-cbtn"><span className="ic">{"📷"}</span>Camera<input type="file" accept="image/*" capture="environment" onChange={handleCap} /></label>
              <label className="pf-cbtn"><span className="ic">{"🖼\uFE0F"}</span>Gallery<input type="file" accept="image/*" multiple onChange={handleCap} /></label>
            </div>
          </div>
          {photos.length > 0 && (
            <div className="pf-thmbs">
              <div className="pf-tl">{photos.length} photo{photos.length > 1 ? "s" : ""} ready</div>
              <div className="pf-tg">
                {photos.map(function (p) {
                  return <div key={p.id} className="pf-th"><img src={p.url} alt="" /><button className="pf-thx" onClick={function () { rmPhoto(p.id); }}>{"\u2715"}</button></div>;
                })}
              </div>
            </div>
          )}
          {photos.length > 0 && (
            <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 10 }}>
              <button className="pf-btn" onClick={function () { setScreen("file"); }}>File {photos.length} Photo{photos.length > 1 ? "s" : ""} {"\u2192"}</button>
              <button className="pf-btn sec" onClick={doReset}>Cancel</button>
            </div>
          )}
        </div>
      )}

      {/* === FILE: Pick destination and upload === */}
      {screen === "file" && (
        <div>
          <button className="pf-back" onClick={function () { setScreen("capture"); }}>{"\u2190"} Back to photos</button>
          <div className="pf-ms">
            {photos.map(function (p) { return <div key={p.id} className="pf-mi"><img src={p.url} alt="" /></div>; })}
            <div className="pf-ma" onClick={function () { setScreen("capture"); }}>+</div>
          </div>

          <div className="pf-sec">
            {/* Stores filing */}
            {tab === "stores" && (
              <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                <div>
                  <div className="pf-sl">Category <span style={{ color: C.soft, fontWeight: 400, textTransform: "none", letterSpacing: 0 }}>(optional)</span></div>
                  <div className="pf-pills">
                    {PHOTO_CATEGORIES.map(function (c) {
                      return <button key={c.id} className={"pf-pill" + (selCat === c.id ? " on" : "")} onClick={function () { setSelCat(selCat === c.id ? null : c.id); setSubOpt(null); }}><span>{c.icon}</span> {c.label}</button>;
                    })}
                  </div>
                  {catObj && catObj.subs && (
                    <div className="pf-sr">
                      {catObj.subs.map(function (s) { return <button key={s} className={"pf-sp" + (subOpt === s ? " on" : "")} onClick={function () { setSubOpt(subOpt === s ? null : s); }}>{s}</button>; })}
                    </div>
                  )}
                </div>
                <div>
                  <div className="pf-sl">Quick Note <span style={{ color: C.soft, fontWeight: 400, textTransform: "none", letterSpacing: 0 }}>(optional)</span></div>
                  <input className="pf-inp" placeholder="e.g. broken pipe north tower" value={note} onChange={function (e) { setNote(e.target.value); }} />
                </div>
                <div>
                  <div className="pf-sl">Store</div>
                  {selStore && (
                    <div className="pf-sel">
                      <div><div className="pf-seln">{selStore.name}</div><div className="pf-sels">{selStore.city}, {selStore.state}</div></div>
                      <button className="pf-selx" onClick={function () { setSelStore(null); }}>{"\u2715"}</button>
                    </div>
                  )}
                  {!selStore && (
                    <div>
                      <div className="pf-sw" style={{ marginBottom: 10 }}>
                        <span className="pf-si">{"🔍"}</span>
                        <input className="pf-inp pf-sinp" placeholder="Search stores..." value={search} onChange={function (e) { setSearch(e.target.value); }} />
                      </div>
                      {recents.length > 0 && !search && (
                        <div style={{ marginBottom: 8 }}>
                          <div className="pf-sl" style={{ fontSize: 10, marginBottom: 6 }}>Recent</div>
                          <div className="pf-recs">
                            {recents.map(function (r) {
                              return <button key={r.id} className="pf-rc" onClick={function () { var f = allStores.find(function (s) { return s.id === r.id; }); if (f) pickStore(f); }}>{r.name}</button>;
                            })}
                          </div>
                        </div>
                      )}
                      <div style={{ maxHeight: 260, overflowY: "auto" }}>
                        {filtGrp.map(function (g) {
                          return (
                            <div key={g.chain}>
                              <div className="pf-ch"><span className="pf-cn">{g.chain}</span><span className="pf-cc">{g.stores.length}</span></div>
                              {g.stores.map(function (s) {
                                var st = { id: g.chain + "_" + s.number, name: g.chain + " #" + s.number, chain: g.chain, number: s.number, city: s.city, state: s.state };
                                return <div key={s.number} className="pf-srow" onClick={function () { pickStore(st); }}><span className="pf-sn">{g.chain} #{s.number}</span><span className="pf-scity">{s.city || "Las Vegas"}, {s.state || "NV"}</span></div>;
                              })}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
                {selStore && (
                  <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                    <div className="pf-path"><span>{"📁"}</span> <span className="t">{storePath()}</span></div>
                    <div className="pf-fns">{fnames.map(function (f, i) { return <span key={i}>{f}</span>; })}</div>
                  </div>
                )}
              </div>
            )}

            {/* Receipts filing */}
            {tab === "receipts" && (
              <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                <div>
                  <div className="pf-sl">Receipt Category</div>
                  <div className="pf-pills">
                    {rcats.map(function (c) { return <button key={c} className={"pf-pill" + (selRcat === c ? " on" : "")} onClick={function () { setSelRcat(selRcat === c ? null : c); }}>{c}</button>; })}
                  </div>
                </div>
                <div>
                  <div className="pf-sl">Quick Note <span style={{ color: C.soft, fontWeight: 400, textTransform: "none", letterSpacing: 0 }}>(optional)</span></div>
                  <input className="pf-inp" placeholder="e.g. Shell station Flamingo Rd" value={rnote} onChange={function (e) { setRnote(e.target.value); }} />
                </div>
                {selRcat && (
                  <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                    <div className="pf-path"><span>{"📁"}</span> <span className="t">{rcatPath()}</span></div>
                    <div className="pf-fns">{fnames.map(function (f, i) { return <span key={i}>{f}</span>; })}</div>
                  </div>
                )}
              </div>
            )}

            {/* Upload / Download */}
            {!done && (
              <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 8 }}>
                {uping && (
                  <div>
                    <div className="pf-prog"><div className="pf-progb" style={{ width: prog + "%" }}></div></div>
                    <div style={{ fontSize: 12, color: C.soft, fontFamily: "'IBM Plex Mono',monospace", marginTop: 6, textAlign: "center" }}>{prog}%</div>
                  </div>
                )}
                <button className="pf-btn" onClick={doUpload} disabled={!canUp || uping}>{uping ? "Uploading..." : "\u2191 Upload to Drive"}</button>
                <button className="pf-btn sec" onClick={doDL} disabled={!canUp || uping}>{"\u2193"} Download All</button>
              </div>
            )}

            {/* Success */}
            {done && (
              <div style={{ textAlign: "center", padding: "16px 0" }}>
                <div style={{ fontSize: 48, marginBottom: 8 }}>{"\u2705"}</div>
                <div style={{ fontSize: 15, fontWeight: 600, color: C.green, marginBottom: 16 }}>{photos.length} photo{photos.length > 1 ? "s" : ""} uploaded!</div>
                <button className="pf-btn" onClick={doReset}>{"📷"} Take More Photos</button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
