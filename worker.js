// 채종명 어드바이저 — 보장분석 리포트 배포 플랫폼
// 관리자가 리포트를 업로드하면 무작위 링크가 생성됩니다. 분류를 "기고객용"으로 고르면
// 인사말 + 고정 안내카드 5개 + 홈화면 링크가 붙고, "취소고객용"으로 고르면 보장가이드로
// 이어지는 카드가 붙습니다(문구는 편집기의 "배포 사이트" 단계에서 바꿀 수 있어요).
// 리포트는 HTML 파일 업로드 또는 사진 2장 업로드 중 하나로 만들 수 있고, 업로드 시
// 생년월일 6자리를 입력하면 열람 시 본인 확인을 거치고, 비워두면 링크만으로 바로 열람
// 가능합니다. 만료 기간은 7/14/30일 자동 삭제 또는 "기한 없이 계속 보관" 중 고를 수 있습니다.
//
// 이 파일은 같은 배포(이 Worker) 안에 정적으로 함께 올라간 랜딩페이지와 같은 도메인에서
// 서빙되므로, 랜딩페이지 링크는 전부 상대경로(/guide.html 등)로 되어 있습니다.

const LOGO_URL = "/assets/toss-logo.png";
const SESSION_COOKIE = "cr_session";
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7; // 관리자 로그인 유지 7일
const MAX_VERIFY_ATTEMPTS = 5;
const VERIFY_LOCKOUT_SECONDS = 60 * 15;

// ---------- 유틸 ----------

function escapeHtml(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
  });
}

function randomSlug(len) {
  const alphabet = "abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = new Uint8Array(len);
  crypto.getRandomValues(bytes);
  let out = "";
  for (let i = 0; i < len; i++) out += alphabet[bytes[i] % alphabet.length];
  return out;
}

function randomToken() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

async function incrementViews(env, slug) {
  const key = "views:" + slug;
  const current = parseInt((await env.REPORTS.get(key)) || "0", 10);
  await env.REPORTS.put(key, String(current + 1));
}

function safeEqual(a, b) {
  a = String(a || "");
  b = String(b || "");
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function parseCookies(request) {
  const header = request.headers.get("Cookie") || "";
  const out = {};
  header.split(";").forEach((part) => {
    const idx = part.indexOf("=");
    if (idx === -1) return;
    out[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
  });
  return out;
}

function setCookie(name, value, opts) {
  opts = opts || {};
  let str = name + "=" + encodeURIComponent(value) + "; Path=" + (opts.path || "/") + "; HttpOnly; Secure; SameSite=Lax";
  if (opts.maxAge != null) str += "; Max-Age=" + opts.maxAge;
  return str;
}

function clearCookie(name, path) {
  return name + "=; Path=" + (path || "/") + "; HttpOnly; Secure; SameSite=Lax; Max-Age=0";
}

async function readJson(request) {
  try {
    return await request.json();
  } catch (e) {
    return null;
  }
}

// "data:image/png;base64,...." 형태의 데이터 URL을 실제 바이트+MIME 타입으로 분리한다.
function decodeDataUrl(dataUrl) {
  const m = /^data:([^;]+);base64,(.*)$/s.exec(dataUrl || "");
  if (!m) return null;
  return { contentType: m[1], bytes: Uint8Array.from(atob(m[2]), (c) => c.charCodeAt(0)) };
}

// ---------- 공통 레이아웃 ----------

const HEADER_STYLE = `
.top-bar { position:sticky; top:0; z-index:10; align-self:stretch; width:100%;
  display:flex; align-items:center; justify-content:space-between;
  height:56px; padding:0 20px; background:#ffffff; border-bottom:1px solid #e5e8eb; }
.brand-logo-link { display:flex; align-items:center; gap:6px; text-decoration:none; }
.brand-logo { height:22px; width:auto; display:block; }
.brand-text { font-size:15px; font-weight:700; color:#191f28; }
.menu-toggle { display:flex; align-items:center; justify-content:center; width:36px; height:36px;
  padding:0; border:none; background:transparent; cursor:pointer; }
.hamburger-icon { display:flex; flex-direction:column; gap:4px; width:20px; }
.hamburger-icon span { display:block; height:2px; width:100%; background:#191f28; border-radius:1px; }
.sr-only { position:absolute; width:1px; height:1px; padding:0; margin:-1px; overflow:hidden;
  clip:rect(0,0,0,0); white-space:nowrap; border:0; }
.site-menu { position:absolute; top:calc(100% + 8px); right:20px; z-index:20;
  display:flex; flex-direction:column; min-width:180px; padding:8px;
  background:#ffffff; border:1px solid #e5e8eb; border-radius:12px; box-shadow:0 8px 24px rgba(15,23,42,0.12); }
.site-menu[hidden] { display:none; }
.site-menu a { padding:12px; border-radius:8px; font-size:15px; font-weight:600; color:#191f28; text-decoration:none; }
.site-menu a:hover { background:#f2f4f6; }
`;

const BASE_STYLE = `
* { box-sizing: border-box; }
html, body { margin:0; padding:0; background:#f2f4f6; color:#191f28;
  font-family:"Pretendard", -apple-system, "Malgun Gothic", sans-serif; }
a { color:inherit; }
.page-frame { max-width:480px; margin:0 auto; min-height:100vh; background:#ffffff; }
.page-frame.wide { max-width:920px; }
@media (min-width:561px) {
  .page-frame { min-height:0; margin-top:24px; margin-bottom:24px; border:1px solid #e5e8eb; border-radius:20px; overflow:hidden; }
}
${HEADER_STYLE}
.center-card { padding:64px 24px; text-align:center; }
.center-card h1 { font-size:20px; font-weight:800; margin:0 0 12px; }
.center-card p { font-size:14px; color:#4e5968; line-height:1.6; margin:0 0 24px; }
.field { text-align:left; margin-bottom:16px; }
.field label { display:block; font-size:13px; font-weight:600; color:#4e5968; margin-bottom:6px; }
input[type=password], input[type=text], input[type=tel], select, textarea {
  width:100%; padding:12px 14px; border:1px solid #e5e8eb; border-radius:10px;
  font-size:15px; font-family:inherit; outline:none; background:#fff; color:#191f28; }
input:focus, select:focus, textarea:focus { border-color:#3182f6; }
.btn { display:inline-flex; align-items:center; justify-content:center; width:100%;
  height:48px; border:none; border-radius:12px; background:#3182f6; color:#fff;
  font-size:15px; font-weight:700; cursor:pointer; }
.btn:hover { background:#2272eb; }
.btn.weak { background:#e8f3ff; color:#1b64da; }
.err { color:#f04452; font-size:13px; margin:-8px 0 16px; text-align:left; min-height:16px; }
.muted { color:#8b95a1; font-size:12px; }
`;

function shellPage(title, bodyHtml, extraStyle, extraHead) {
  return `<!doctype html><html lang="ko"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${escapeHtml(title)}</title>
<link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/static/pretendard.css">
${extraHead || ""}
<style>${BASE_STYLE}${extraStyle || ""}</style>
</head><body>${bodyHtml}</body></html>`;
}

function ogMeta(title, description, image) {
  return `<meta property="og:type" content="website">
<meta property="og:title" content="${escapeHtml(title)}">
<meta property="og:description" content="${escapeHtml(description)}">
<meta property="og:image" content="${image}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${escapeHtml(title)}">
<meta name="twitter:description" content="${escapeHtml(description)}">
<meta name="twitter:image" content="${image}">`;
}

function brandHeader() {
  return `<header class="top-bar">
    <a class="brand-logo-link" href="/index.html"><img class="brand-logo" src="${LOGO_URL}" alt="토스"><span class="brand-text">toss insurance</span></a>
    <button id="menu-toggle" class="menu-toggle" type="button" aria-haspopup="true" aria-expanded="false" aria-controls="site-menu">
      <span class="hamburger-icon" aria-hidden="true"><span></span><span></span><span></span></span>
      <span class="sr-only">메뉴</span>
    </button>
    <nav id="site-menu" class="site-menu" hidden>
      <a href="/guide.html">보장가이드</a>
      <a href="/pension-guide.html">연금·저축 가이드</a>
      <a href="/claim.html">보험금 청구하기</a>
      <a href="/insight.html">Insight</a>
      <a href="/faq.html">FAQ</a>
    </nav>
  </header>
  <script>
  (function () {
    var btn = document.getElementById('menu-toggle');
    var menu = document.getElementById('site-menu');
    if (!btn || !menu || btn.dataset.bound) return;
    btn.dataset.bound = '1';
    btn.addEventListener('click', function () {
      var willOpen = menu.hidden;
      menu.hidden = !willOpen;
      btn.setAttribute('aria-expanded', String(willOpen));
    });
    document.addEventListener('click', function (e) {
      if (!menu.hidden && !menu.contains(e.target) && !btn.contains(e.target)) {
        menu.hidden = true;
        btn.setAttribute('aria-expanded', 'false');
      }
    });
  })();
  </script>`;
}

function pageFrame(contentHtml, wide) {
  return `<div class="page-frame${wide ? " wide" : ""}">${brandHeader()}${contentHtml}</div>`;
}

// 카카오톡 인앱 브라우저 뒤로가기 대응 (한 번 더 눌러야 카카오톡으로 나가지도록).
// window.__overlayOpen은 이미지 확대(zoomScript)가 자기 히스토리를 쌓을 때, 그 화면을
// 닫는 뒤로가기까지 이 안내가 겹쳐 뜨지 않도록 걸러내는 공유 플래그다.
function backGuardScript() {
  return `<script>
  (function(){
    if (window.__backGuardInit) return;
    window.__backGuardInit = true;
    var alreadyArmed = false;
    try { alreadyArmed = sessionStorage.getItem('bgArmed') === '1'; } catch (e) {}
    if (alreadyArmed) return;
    try { sessionStorage.setItem('bgArmed', '1'); } catch (e) {}
    history.pushState({ __bg: 1 }, '', location.href);
    window.addEventListener('popstate', function(e){
      if (e.state && e.state.__bg) return;
      if (window.__overlayOpen) return;
      var t = document.createElement('div');
      t.innerHTML = '한 번 더 누르시면,<br>카카오톡 대화방으로<br>돌아갑니다.';
      t.style.cssText = 'position:fixed;left:50%;bottom:24px;transform:translateX(-50%);' +
        'max-width:calc(100% - 40px);text-align:center;background:#191f28;color:#fff;' +
        'font-size:13.5px;font-weight:600;line-height:1.5;padding:14px 20px;border-radius:20px;z-index:200;' +
        'box-shadow:0 4px 16px rgba(0,0,0,.2)';
      (document.body || document.documentElement).appendChild(t);
      setTimeout(function(){ t.remove(); }, 2600);
    });
  })();
  </script>`;
}

// ---------- 관리자 인증 ----------

async function isAuthed(request, env) {
  const cookies = parseCookies(request);
  const token = cookies[SESSION_COOKIE];
  if (!token) return false;
  const ok = await env.REPORTS.get("session:" + token);
  return ok === "1";
}

function loginPage(error) {
  const body = pageFrame(`<div class="center-card">
    <h1>관리자 로그인</h1>
    <p>보장분석 리포트 배포 관리자만 접근할 수 있습니다.</p>
    <form method="POST" action="/admin/login">
      <div class="field"><label>비밀번호</label><input type="password" name="password" autofocus required></div>
      <div class="err">${error ? escapeHtml(error) : ""}</div>
      <button class="btn" type="submit">로그인</button>
    </form>
  </div>`);
  return shellPage("관리자 로그인", body);
}

// ---------- 관리자 대시보드 ----------

const DASH_STYLE = `
.dash-wrap { padding:28px 20px 80px; }
.dash-head { display:flex; align-items:center; justify-content:space-between; margin-bottom:22px; flex-wrap:wrap; gap:10px; }
.dash-head h1 { font-size:20px; font-weight:800; margin:0; }
.dash-head .sub { font-size:13px; color:#8b95a1; margin-top:4px; }
.dash-actions { display:flex; gap:8px; }
.iconbtn { border:1px solid #e5e8eb; background:#fff; border-radius:10px; padding:9px 14px;
  font-size:13px; font-weight:700; color:#4e5968; cursor:pointer; }
.iconbtn:hover { border-color:#3182f6; color:#3182f6; }
.upload-card { border:1px dashed #c8d0d8; border-radius:16px; padding:22px; margin-bottom:26px; background:#fafbfc; }
.upload-card h2 { font-size:15px; font-weight:800; margin:0 0 14px; }
.grid2 { display:grid; grid-template-columns:1fr 1fr; gap:12px; }
.grid2 .span2 { grid-column: span 2; }
.filebox { border:1px solid #e5e8eb; border-radius:10px; padding:12px 14px; background:#fff; font-size:13.5px; color:#4e5968; }
.filebox.has-file { border-color:#3182f6; color:#1b64da; font-weight:600; }
.tabs { display:flex; gap:6px; margin-bottom:14px; flex-wrap:wrap; }
.tab { border:1px solid #e5e8eb; background:#fff; border-radius:100px; padding:8px 14px;
  font-size:13px; font-weight:700; color:#4e5968; cursor:pointer; }
.tab.active { border-color:#3182f6; background:#e8f3ff; color:#1b64da; }
.search-row { display:flex; gap:8px; margin-bottom:14px; }
.search-row input { flex:1; }
.list { display:flex; flex-direction:column; gap:10px; }
.card { display:flex; align-items:center; gap:14px; border:1px solid #e5e8eb; border-radius:14px; padding:12px 16px; background:#fff; }
.card .thumb { flex-shrink:0; width:52px; height:98px; border-radius:8px; border:1px solid #e5e8eb;
  background:#f2f4f6 center/cover no-repeat; object-fit:cover; }
.card .tag { flex-shrink:0; font-size:11.5px; font-weight:800; color:#1b64da; background:#e8f3ff; border-radius:7px; padding:4px 9px; }
.card .info { flex:1; min-width:0; }
.card .name { font-size:14.5px; font-weight:700; }
.card .meta { font-size:12px; color:#8b95a1; margin-top:3px; }
.card .meta.warn { color:#f04452; font-weight:700; }
.card-actions { display:flex; gap:6px; flex-shrink:0; }
.smallbtn { border:1px solid #e5e8eb; background:#fff; border-radius:8px; padding:7px 11px; font-size:12.5px; font-weight:700; color:#4e5968; cursor:pointer; }
.smallbtn.primary { border-color:#3182f6; color:#1b64da; }
.smallbtn.danger { border-color:#f04452; color:#f04452; }
.empty { text-align:center; color:#8b95a1; font-size:13.5px; padding:40px 0; }
.toast { position:fixed; left:50%; bottom:24px; transform:translateX(-50%) translateY(8px); opacity:0;
  background:#191f28; color:#fff; font-size:13.5px; font-weight:600; padding:11px 18px; border-radius:100px;
  transition:all .2s; pointer-events:none; white-space:nowrap; }
.toast.show { opacity:1; transform:translateX(-50%) translateY(0); }
`;

function dashboardPage() {
  const content = `
  <div class="dash-wrap">
    <div class="dash-head">
      <div>
        <h1>리포트 배포</h1>
        <div class="sub">고객별 링크를 만들고 관리합니다</div>
      </div>
      <div class="dash-actions">
        <button class="iconbtn" onclick="loadList()">↻ 새로고침</button>
        <a class="iconbtn" href="/admin/logout">로그아웃</a>
      </div>
    </div>

    <div class="upload-card">
      <h2>새 리포트 배포</h2>
      <div class="grid2">
        <div class="field"><label>고객 이름</label><input type="text" id="f-name" placeholder="예: 홍길동"></div>
        <div class="field"><label>분류</label>
          <select id="f-category">
            <option value="취소고객용">취소고객용</option>
            <option value="기고객용">기고객용</option>
          </select>
        </div>
        <div class="field"><label>생년월일 6자리 (선택 · 비워두면 확인 없이 바로 열람)</label><input type="text" id="f-dob" placeholder="예: 820205" maxlength="6" inputmode="numeric"></div>
        <div class="field"><label>만료 기간</label>
          <select id="f-expiry">
            <option value="7">7일 후 자동 삭제</option>
            <option value="14" selected>14일 후 자동 삭제</option>
            <option value="30">30일 후 자동 삭제</option>
            <option value="none">기한 없이 계속 보관</option>
          </select>
        </div>
        <div class="field span2"><label>리포트 형식</label>
          <div style="display:flex;gap:16px;font-size:14px;padding-top:4px;">
            <label style="display:flex;align-items:center;gap:6px;font-weight:400;cursor:pointer;">
              <input type="radio" name="f-format" value="html" checked onchange="onFormatChange()"> HTML 파일
            </label>
            <label style="display:flex;align-items:center;gap:6px;font-weight:400;cursor:pointer;">
              <input type="radio" name="f-format" value="images" onchange="onFormatChange()"> 사진 2장
            </label>
          </div>
        </div>
        <div class="field span2" id="f-html-row">
          <label>리포트 HTML 파일</label>
          <input type="file" id="f-file" accept=".html,text/html" style="display:none" onchange="onFile(this)">
          <div class="filebox" id="f-filebox" onclick="document.getElementById('f-file').click()">클릭해서 .html 파일 선택</div>
        </div>
        <div class="field span2" id="f-images-row" style="display:none">
          <label>사진 1 · 가입 내역 한눈에 확인하기</label>
          <input type="file" id="f-photo1" accept="image/*" style="display:none" onchange="onPhoto(this,1)">
          <div class="filebox" id="f-photo1box" onclick="document.getElementById('f-photo1').click()">클릭해서 이미지 선택</div>
          <label style="margin-top:10px">사진 2 · 보장 한 장으로 보기</label>
          <input type="file" id="f-photo2" accept="image/*" style="display:none" onchange="onPhoto(this,2)">
          <div class="filebox" id="f-photo2box" onclick="document.getElementById('f-photo2').click()">클릭해서 이미지 선택</div>
        </div>
      </div>
      <div class="err" id="f-err"></div>
      <button class="btn" id="f-upload-btn" style="margin-top:6px" onclick="doUpload()">배포 링크 만들기</button>
    </div>

    <div class="tabs" id="tabs"></div>
    <div class="search-row">
      <input type="text" id="q" placeholder="고객 이름 검색" oninput="renderList()">
    </div>
    <div class="list" id="list"></div>
    <div class="empty" id="empty" style="display:none">배포된 리포트가 없습니다.</div>
  </div>
  <div class="toast" id="toast"></div>

  <script src="https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js"></script>
  <script>
  var ALL = [];
  var fileText = "";
  var thumbDataUrl = "";
  var photo1DataUrl = "";
  var photo2DataUrl = "";
  var CATS = ["전체", "취소고객용", "기고객용"];
  var currentTab = "전체";

  function renderTabs() {
    document.getElementById('tabs').innerHTML = CATS.map(function(c){
      return '<button class="tab' + (c === currentTab ? ' active' : '') + '" onclick="selectTab(\\'' + c + '\\')">' + c + '</button>';
    }).join('');
  }
  function selectTab(c) { currentTab = c; renderTabs(); renderList(); }
  renderTabs();

  function toast(msg) {
    var t = document.getElementById('toast');
    t.textContent = msg;
    t.classList.add('show');
    setTimeout(function(){ t.classList.remove('show'); }, 2200);
  }

  var thumbGenerating = false;

  function onFormatChange() {
    var fmt = document.querySelector('input[name="f-format"]:checked').value;
    document.getElementById('f-html-row').style.display = fmt === 'html' ? '' : 'none';
    document.getElementById('f-images-row').style.display = fmt === 'images' ? '' : 'none';
  }

  function onPhoto(input, n) {
    var file = input.files[0];
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function(e) {
      if (n === 1) photo1DataUrl = e.target.result; else photo2DataUrl = e.target.result;
      var box = document.getElementById('f-photo' + n + 'box');
      box.textContent = '✓ ' + file.name;
      box.classList.add('has-file');
    };
    reader.readAsDataURL(file);
  }

  function onFile(input) {
    var file = input.files[0];
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function(e) {
      fileText = e.target.result;
      thumbDataUrl = "";
      thumbGenerating = true;
      var box = document.getElementById('f-filebox');
      var uploadBtn = document.getElementById('f-upload-btn');
      box.textContent = '✓ ' + file.name + ' · 썸네일 만드는 중…';
      box.classList.add('has-file');
      uploadBtn.disabled = true;
      generateThumb(fileText, function(dataUrl){
        thumbDataUrl = dataUrl || "";
        thumbGenerating = false;
        uploadBtn.disabled = false;
        box.textContent = '✓ ' + file.name + (thumbDataUrl ? '' : ' · 썸네일 생성 실패(업로드는 가능)');
      });
    };
    reader.readAsText(file, 'utf-8');
  }

  function generateThumb(html, cb) {
    try {
      var iframe = document.createElement('iframe');
      iframe.style.cssText = 'position:fixed;left:-9999px;top:0;width:480px;height:900px;border:0;background:#fff';
      document.body.appendChild(iframe);
      iframe.onload = function() {
        setTimeout(function(){
          try {
            html2canvas(iframe.contentDocument.body, { width:480, height:900, windowWidth:480, windowHeight:900, useCORS:true, scale:1, backgroundColor:'#ffffff' })
              .then(function(canvas){
                var small = document.createElement('canvas');
                small.width = 240; small.height = 450;
                small.getContext('2d').drawImage(canvas, 0, 0, 480, 900, 0, 0, 240, 450);
                document.body.removeChild(iframe);
                cb(small.toDataURL('image/png'));
              })
              .catch(function(){ document.body.removeChild(iframe); cb(null); });
          } catch (e) { document.body.removeChild(iframe); cb(null); }
        }, 450);
      };
      iframe.srcdoc = html;
    } catch (e) { cb(null); }
  }

  function doUpload() {
    var name = document.getElementById('f-name').value.trim();
    var category = document.getElementById('f-category').value;
    var dob = document.getElementById('f-dob').value.trim();
    var expiryDays = document.getElementById('f-expiry').value;
    var format = document.querySelector('input[name="f-format"]:checked').value;
    var err = document.getElementById('f-err');
    err.textContent = '';
    if (!name) { err.textContent = '고객 이름을 입력해주세요.'; return; }
    if (dob && !/^\\d{6}$/.test(dob)) { err.textContent = '생년월일은 6자리 숫자로 입력하거나, 비워두세요.'; return; }
    var payload = { name: name, category: category, dob: dob, expiryDays: expiryDays, format: format };
    if (format === 'images') {
      if (!photo1DataUrl || !photo2DataUrl) { err.textContent = '사진 2장을 모두 선택해주세요.'; return; }
      payload.photo1 = photo1DataUrl;
      payload.photo2 = photo2DataUrl;
    } else {
      if (!fileText) { err.textContent = 'HTML 파일을 선택해주세요.'; return; }
      if (thumbGenerating) { err.textContent = '썸네일 만드는 중이에요. 잠시만 기다렸다가 눌러주세요.'; return; }
      payload.html = fileText;
      payload.thumb = thumbDataUrl;
    }
    fetch('/admin/upload', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    }).then(function(r){ return r.json(); }).then(function(data){
      if (data.error) { err.textContent = data.error; return; }
      navigator.clipboard.writeText(data.url).catch(function(){});
      toast('링크가 생성되어 클립보드에 복사되었습니다');
      document.getElementById('f-name').value = '';
      document.getElementById('f-dob').value = '';
      fileText = ''; thumbDataUrl = ''; photo1DataUrl = ''; photo2DataUrl = '';
      var box = document.getElementById('f-filebox');
      box.textContent = '클릭해서 .html 파일 선택';
      box.classList.remove('has-file');
      var box1 = document.getElementById('f-photo1box');
      box1.textContent = '클릭해서 이미지 선택';
      box1.classList.remove('has-file');
      var box2 = document.getElementById('f-photo2box');
      box2.textContent = '클릭해서 이미지 선택';
      box2.classList.remove('has-file');
      loadList();
    }).catch(function(){ err.textContent = '업로드 중 오류가 발생했습니다.'; });
  }

  function fmtDate(ts) {
    var d = new Date(ts);
    return d.getFullYear() + '.' + String(d.getMonth()+1).padStart(2,'0') + '.' + String(d.getDate()).padStart(2,'0');
  }

  function renderList() {
    var q = document.getElementById('q').value.trim();
    var list = document.getElementById('list');
    var empty = document.getElementById('empty');
    var items = ALL.filter(function(it){
      var matchTab = currentTab === '전체' || it.category === currentTab;
      var matchQ = !q || it.name.indexOf(q) > -1;
      return matchTab && matchQ;
    });
    if (!items.length) { list.innerHTML = ''; empty.style.display = 'block'; return; }
    empty.style.display = 'none';
    list.innerHTML = items.map(function(it){
      var metaCls, metaTxt;
      if (it.expiresAt == null) {
        metaCls = 'meta';
        metaTxt = '무기한 · ' + fmtDate(it.createdAt) + ' 배포';
      } else {
        var daysLeft = Math.ceil((it.expiresAt - Date.now()) / 86400000);
        metaCls = daysLeft <= 2 ? 'meta warn' : 'meta';
        metaTxt = daysLeft <= 0 ? '오늘 만료' : ('D-' + daysLeft + ' · ' + fmtDate(it.createdAt) + ' 배포');
      }
      metaTxt += ' · 👁 ' + (it.views || 0) + '회';
      var lockTag = it.locked ? '' : '<span class="tag" style="background:#eef;color:#33c">🔓 확인없음</span>';
      var formatTag = it.format === 'images' ? '<span class="tag" style="background:#fef3e0;color:#b25e09">🖼 이미지</span>' : '';
      return '<div class="card">' +
        '<img class="thumb" src="/admin/thumb/' + it.slug + '" onerror="this.style.visibility=\\'hidden\\'" alt="">' +
        '<span class="tag">' + it.category + '</span>' + formatTag + lockTag +
        '<div class="info"><div class="name">' + it.name + '</div><div class="' + metaCls + '">' + metaTxt + '</div></div>' +
        '<div class="card-actions">' +
          '<button class="smallbtn primary" onclick="copyLink(\\'' + it.slug + '\\')">🔗 링크 복사</button>' +
          '<button class="smallbtn danger" onclick="removeItem(\\'' + it.slug + '\\')">삭제</button>' +
        '</div></div>';
    }).join('');
  }

  function copyLink(slug) {
    var url = location.origin + '/r/' + slug;
    navigator.clipboard.writeText(url).then(function(){ toast('링크가 복사되었습니다'); }).catch(function(){ prompt('링크', url); });
  }

  function removeItem(slug) {
    if (!confirm('이 리포트를 삭제할까요? 되돌릴 수 없습니다.')) return;
    fetch('/admin/delete', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({slug:slug}) })
      .then(function(){ loadList(); toast('삭제되었습니다'); });
  }

  function loadList() {
    fetch('/admin/list').then(function(r){ return r.json(); }).then(function(data){
      ALL = data.items || [];
      renderList();
    });
  }
  loadList();
  </script>`;
  return shellPage("리포트 배포 대시보드", pageFrame(content, true), DASH_STYLE);
}

// ---------- 고객용 페이지 ----------

function reportOgHead(category) {
  const isExisting = category === "기고객용";
  const title = isExisting ? "보장 안내 | 담당자 채종명" : "보험 분석 | 담당자 채종명";
  const desc = isExisting ? "보장 내역, 새로 정리해드렸어요." : "꼭 점검하셔야 할 부분 한 가지만 담았어요.";
  const image = isExisting ? "/assets/og-guide-notice.png" : "/assets/og-checkup.png";
  return { title, ogHead: ogMeta(title, desc, image) };
}

function gatePage(slug, error, category) {
  const body = pageFrame(`<div class="center-card">
    <h1>본인 확인</h1>
    <p>보내드린 보장분석 리포트입니다.<br>생년월일 6자리를 입력하시면 확인하실 수 있어요.</p>
    <form method="POST" action="/r/${escapeHtml(slug)}/verify">
      <div class="field"><label>생년월일 6자리</label><input type="tel" name="dob" placeholder="예: 820205" maxlength="6" inputmode="numeric" autofocus required></div>
      <div class="err">${error ? escapeHtml(error) : ""}</div>
      <button class="btn" type="submit">확인하고 열람하기</button>
    </form>
  </div>`);
  const { title, ogHead } = reportOgHead(category);
  return shellPage(title, body, "", ogHead + backGuardScript());
}

function expiredPage() {
  const body = pageFrame(`<div class="center-card">
    <h1>만료되었거나 존재하지 않는 링크입니다</h1>
    <p>보안을 위해 일정 기간이 지난 리포트는 자동으로 삭제됩니다.<br>다시 필요하시면 담당자에게 말씀해주세요.</p>
    <a class="btn weak" href="/index.html" style="text-decoration:none">홈으로 이동</a>
  </div>`);
  return shellPage("만료된 링크 | 채종명", body);
}

// 리포트 본문(HTML 업로드형이든 사진 2장형이든) 맨 아래/위에 공통으로 붙는 카드들의 스타일.
const REPORT_EXTRA_STYLE = `
.pg-body { display:flex; flex-direction:column; align-items:center; gap:20px; padding:0 0 20px; }
.pg-body.img-report-body { padding-top:24px; }
.pg-fit { overflow:hidden; }
.info-card { margin:0 20px; padding:24px 20px; border:1px solid #e5e8eb; border-radius:16px; background:#ffffff;
  width:calc(100% - 40px); box-sizing:border-box; }
.info-card h2 { display:flex; align-items:center; gap:10px; margin:0 0 14px; font-size:18px; font-weight:800; color:#191f28; }
.info-card p { margin:0 0 12px; font-size:15px; line-height:1.65; color:#4e5968; white-space:pre-line; }
.info-card p:last-child { margin-bottom:0; }
.info-card ul { margin:0 0 12px; padding-left:20px; }
.info-card li { font-size:15px; line-height:1.65; color:#4e5968; margin-bottom:4px; }
.info-card li strong, .info-card p strong { color:#191f28; font-weight:700; }
.gc-btn { display:flex; align-items:center; justify-content:center; width:100%; height:52px; padding:0 20px;
  border-radius:16px; font-size:16px; font-weight:600; text-decoration:none; background:#3182f6; color:#ffffff;
  box-sizing:border-box; }
.gc-btn:hover { background:#2272eb; }
.info-card .gc-btn { margin-top:4px; }
.icon-badge { display:inline-flex; align-items:center; justify-content:center; width:34px; height:34px;
  border-radius:10px; font-size:17px; line-height:1; flex-shrink:0; }
.icon-badge.accent-blue { background:#e8f3ff; }
.icon-badge.accent-red { background:rgba(208,59,59,0.1); }
.icon-badge.accent-green { background:rgba(27,175,122,0.12); }
.icon-badge.accent-amber { background:#fef3e0; }
.icon-badge.accent-neutral { background:#f2f4f6; }
.info-card.accent-blue { border-left:3px solid #3182f6; }
.info-card.accent-red { border-left:3px solid #d03b3b; }
.info-card.accent-green { border-left:3px solid #1baf7a; }
.info-card.accent-amber { border-left:3px solid #b25e09; }
.info-card .punchline { font-weight:700; }
.info-card.accent-blue .punchline { color:#1b64da; }
.info-card.accent-red .punchline { color:#d03b3b; }
.info-card.accent-green .punchline { color:#0ca36b; }
.info-card.accent-amber .punchline { color:#b25e09; }
.step-row { display:flex; align-items:center; flex-wrap:wrap; gap:6px; margin:0 0 14px; }
.step-pill { background:#e8f3ff; color:#1b64da; font-size:13.5px; font-weight:700; padding:6px 12px; border-radius:100px; white-space:nowrap; }
.step-arrow { color:#8bb8f5; font-weight:700; font-size:14px; }
.report-footer { margin-top:4px; padding:32px 20px 36px; background:#f2f4f6; border-top:1px solid #e5e8eb; text-align:center; }
.report-footer .footer-heading { margin:0 0 16px; font-size:17px; font-weight:700; color:#191f28; text-align:left; }
.report-footer .phone-line { margin:16px 0 0; font-size:13px; color:#8b95a1; line-height:1.6; }
.greeting-hero { padding:28px 20px 4px 34px; }
.greeting-hero .greeting-eyebrow { margin:0 0 6px; font-size:15px; font-weight:400; line-height:1.5; color:#4e5968; }
.greeting-hero .greeting-name { margin:0; font-size:15px; font-weight:400; line-height:1.5; color:#4e5968; }
.img-section { width:calc(100% - 40px); margin:0 20px; padding:24px 20px; border:1px solid #e5e8eb;
  border-radius:16px; background:#ffffff; box-sizing:border-box; }
.img-section h3 { margin:0 0 14px; font-size:16px; font-weight:700; color:#191f28; }
.img-section img.zoomable { width:100%; border-radius:12px; border:1px solid #e5e8eb; display:block; cursor:zoom-in; }
.img-overlay { position:fixed; inset:0; z-index:100; background:rgba(0,0,0,0.85); display:flex;
  align-items:center; justify-content:center; padding:20px; cursor:zoom-out; }
.img-overlay img { max-width:100%; max-height:100%; border-radius:8px; }
.img-overlay[hidden] { display:none; }
.img-overlay-close { position:absolute; top:16px; right:16px; width:40px; height:40px; padding:0;
  border:none; border-radius:50%; background:rgba(255,255,255,0.15); color:#fff; font-size:20px;
  line-height:1; display:flex; align-items:center; justify-content:center; cursor:pointer; }
`;

// 이미지1(가입내역)을 탭하면 화면 전체로 확대해서 보여주는 스크립트.
function zoomScript() {
  return `<script>
  (function(){
    var overlayOpen = false;
    function ensureOverlay(){
      var ov = document.getElementById('img-overlay');
      if (ov) return ov;
      ov = document.createElement('div');
      ov.id = 'img-overlay';
      ov.className = 'img-overlay';
      ov.hidden = true;
      ov.innerHTML = '<button type="button" class="img-overlay-close" aria-label="닫기">✕</button><img id="img-overlay-img" alt="">';
      ov.addEventListener('click', function(){ if (overlayOpen) history.back(); });
      document.body.appendChild(ov);
      return ov;
    }
    document.addEventListener('click', function(e){
      var img = e.target.closest && e.target.closest('img.zoomable');
      if (!img) return;
      var ov = ensureOverlay();
      document.getElementById('img-overlay-img').src = img.src;
      ov.hidden = false;
      overlayOpen = true;
      window.__overlayOpen = true;
      history.pushState({ __imgOverlay: 1 }, '', location.href);
    });
    window.addEventListener('popstate', function(){
      if (!overlayOpen) return;
      var ov = document.getElementById('img-overlay');
      if (ov) ov.hidden = true;
      overlayOpen = false;
      window.__overlayOpen = false;
    });
  })();
  </script>`;
}

// 취소고객용 리포트 맨 아래에 붙는, 보장가이드로 이어지는 카드. 문구는 편집기의
// "배포 사이트" 단계에서 편집할 수 있다.
function guideCtaHtml() {
  return `<div class="info-card">
    <h2>내 보험 [자체점검] 해보기</h2>
    <p>보험에 대한 설명과 포괄적인 가이드가 있어요.</p>
    <a class="gc-btn" href="/guide.html">보장가이드 확인하기</a>
  </div>`;
}

// 기고객용 리포트에 붙는 보험금 청구 안내 카드.
function claimCtaHtml() {
  return `<div class="info-card">
    <h2>보험금 청구가 필요하신가요?</h2>
    <p>서류 사진만 찍어서 올리면 끝. 간편 청구 방법을 안내해드립니다.</p>
    <a class="gc-btn" href="/claim.html">보험금 청구하기</a>
  </div>`;
}

// 고객 이름에서 성을 뗀 "이름"만 뽑아낸다.
function firstNameOf(fullName) {
  const name = String(fullName || "").trim();
  if (name.length <= 1) return name;
  return name.slice(1);
}

// 기고객용 리포트 맨 위, 헤더 바로 아래에 붙는 인사말.
function greetingHtml(meta) {
  const displayName = firstNameOf(meta && meta.name);
  return `<div class="greeting-hero">
    <p class="greeting-eyebrow">믿고 맡겨주셔서 감사합니다. 😊</p>
    <p class="greeting-name">${escapeHtml(displayName)}님의 마지막 보험 담당자 채종명입니다.</p>
  </div>`;
}

// 기고객용 리포트 맨 아래, 카드들보다도 바깥쪽에 붙는 사업자 정보 + 홈 이동 푸터.
function siteFooterHtml() {
  return `<div class="report-footer">
    <p class="footer-heading">더 궁금한 점이 있으신가요?</p>
    <a class="gc-btn" href="/index.html">홈 화면 가기</a>
    <p class="phone-line">토스인슈어런스 직영사업단 직영1 총괄본부<br>
서울특별시 구로구 경인로 662, 37F(신도림동, 디큐브시티)</p>
  </div>`;
}

// 기고객용 리포트 맨 아래에 붙는 안내 카드들. 편집기의 "배포 사이트" 단계에서
// 개수/아이콘/색상/제목/본문을 자유롭게 편집할 수 있고, 이 문자열은 그 결과가
// 빌드 시점에 그대로 채워진 것이다.
function staticInfoBoxesHtml() {
  return "<div class=\"info-card accent-blue\"><h2><span class=\"icon-badge accent-blue\">🤝</span>청구는 제가 도와드려요</h2><p>서류준비 → 사진전송 → 청구대행</p>\n<p>대부분의 보험금 청구는 제가 직접 처리해드립니다.</p>\n<p>보험금 지급완료 문자 받으시면 저에게도 공유해주세요.</p><p class=\"punchline\">→ 정상 지급 여부와 추가 청구 가능한 부분까지 다시 체크해드립니다.</p></div>\n<div class=\"info-card accent-red\"><h2><span class=\"icon-badge accent-red\">🚨</span>꼭 연락주셔야 하는 변경사항</h2><p>직업 변경 (상해급수 영향)<br>\n주소 변경 (배상책임 소재지)<br>\n운전 관련 (자가용/영업용/이륜차)</p>\n<p>미리 연락 안 주시면 나중에 보상받을 때 불이익이 생길 수 있습니다.<br>\n\"이 정도도 말해야 하나?\" 싶어도 편하게 물어봐 주세요.</p></div>\n<div class=\"info-card accent-green\"><h2><span class=\"icon-badge accent-green\">🚗</span>다이렉트 자동차보험 비교</h2><p>자동차보험은 매년 저렴한 보험사가 달라집니다.<br>\n갱신 시즌마다 여러 보험사 견적을 비교해드리고, 가입 진행까지 담당자가 직접 도와드립니다.<br>\n갱신 시기 되시면 꼭 먼저 톡 주세요.</p><p class=\"punchline\">→ 같은 조건, 더 저렴하게 바꿀 수 있습니다.</p></div>\n<div class=\"info-card accent-amber\"><h2><span class=\"icon-badge accent-amber\">🎁</span>지인 소개 캠페인</h2><p>주변에 객관적인 보험 점검이나 재무설계가 필요한 분이 계시다면 편하게 추천해주세요.</p>\n<p>추천받으신 분: 정밀 점검 제공<br>\n추천해주신 분: 감사의 선물 전달</p>\n<p>제 프로필이나 연락처를 전달해 주시거나, 연락처를 알려주시면 제가 먼저 인사드리겠습니다.</p></div>\n<div class=\"info-card\"><h2><span class=\"icon-badge accent-neutral\">💬</span>언제든 편하게 톡 주세요</h2><p>병원 진료 예정 있으실 때<br>\n보험/투자 관련 궁금한 점 있으실 때</p>\n<p>\"이럴 때 물어봐도 되나?\" 고민하지 마시고 그냥 톡 한 줄만 남겨주시면 됩니다.<br>\n미리 상담받을수록 더 똑똑하게 활용하실 수 있습니다.<br>\n앞으로 잘 부탁드립니다. 😁</p></div>";
}

// 분류(카테고리)에 따라 리포트 위/아래에 붙는 조각을 결정한다.
// 기고객용: 인사말(위) + 청구카드·고정안내카드5개(아래) + 홈이동 푸터(맨아래, 카드 바깥)
// 취소고객용: 보장가이드로 이어지는 카드(아래)만 — 기존 platform/의 단순한 구조 그대로.
function reportChrome(meta) {
  if (meta && meta.category === "기고객용") {
    return { top: greetingHtml(meta), tail: claimCtaHtml() + staticInfoBoxesHtml(), footer: siteFooterHtml() };
  }
  return { top: "", tail: guideCtaHtml(), footer: "" };
}

function wrapReportHtml(rawHtml, meta) {
  const header = brandHeader();
  const chrome = reportChrome(meta);
  const headerStyle = `<style>${HEADER_STYLE}${REPORT_EXTRA_STYLE}
    body { display:block !important; margin:0 !important; padding:0 !important; background:#f2f4f6 !important; }
    .page-frame { max-width:480px; margin:0 auto; background:#ffffff; }
    @media (min-width:561px) {
      .page-frame { margin-top:24px; margin-bottom:24px; border:1px solid #e5e8eb; border-radius:20px; overflow:hidden; }
    }
  </style>`;
  const fitScript = `<script>
    (function(){
      function fit(){
        document.querySelectorAll('.pg').forEach(function(pg){
          var wrap = pg.parentElement;
          if (!wrap || !wrap.classList.contains('pg-fit')) {
            wrap = document.createElement('div');
            wrap.className = 'pg-fit';
            pg.parentNode.insertBefore(wrap, pg);
            wrap.appendChild(pg);
          }
          pg.style.transform = 'none';
          var naturalH = pg.offsetHeight;
          var avail = wrap.parentElement.clientWidth;
          var s = Math.min(1, avail / 480);
          wrap.style.width = (480 * s) + 'px';
          wrap.style.height = (naturalH * s) + 'px';
          wrap.style.margin = '0 auto';
          pg.style.transformOrigin = 'top left';
          pg.style.transform = 'scale(' + s + ')';
        });
      }
      window.addEventListener('resize', fit);
      window.addEventListener('orientationchange', fit);
      if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fit); else fit();
    })();
  </script>`;
  const { ogHead } = reportOgHead(meta.category);
  let html = rawHtml;
  if (/<\/head>/i.test(html)) {
    html = html.replace(/<\/head>/i, ogHead + headerStyle + backGuardScript() + "</head>");
  } else {
    html = ogHead + headerStyle + backGuardScript() + html;
  }
  const bodyMatch = html.match(/<body[^>]*>([\s\S]*)<\/body>/i);
  if (bodyMatch) {
    const inner = bodyMatch[1];
    const wrapped = `<div class="page-frame">${header}${chrome.top}<div class="pg-body">${inner}${chrome.tail}</div>${chrome.footer}</div>${fitScript}`;
    return html.replace(/<body[^>]*>[\s\S]*<\/body>/i, "<body>" + wrapped + "</body>");
  }
  return shellPage(meta.name + "님의 보장분석", `<div class="page-frame">${header}${chrome.top}<div class="pg-body">${html}${chrome.tail}</div>${chrome.footer}</div>${fitScript}`, "", ogHead + backGuardScript());
}

// 사진 2장형 리포트. 사진1(가입내역)은 화면에 바로 보이고 탭하면 확대되고, 사진2(한장
// 분석표)는 별도 페이지 링크로 안내하고 그 페이지에서 다운로드도 할 수 있게 한다.
function imageReportHtml(slug, meta) {
  const header = brandHeader();
  const chrome = reportChrome(meta);
  const body = `<div class="page-frame">${header}${chrome.top}<div class="pg-body img-report-body">
    <div class="img-section">
      <h3>가입 내역, 한 눈에 확인하기</h3>
      <img class="zoomable" src="/photo/${escapeHtml(slug)}/1" alt="가입 내역 한눈에 확인하기">
    </div>
    <div class="img-section">
      <h3>보장, 한 장으로 보기</h3>
      <a class="gc-btn" href="/photo/${escapeHtml(slug)}/2/view">한 장 분석표 보러가기</a>
    </div>
    ${chrome.tail}
  </div>${chrome.footer}</div>${zoomScript()}`;
  const { ogHead } = reportOgHead(meta && meta.category);
  return shellPage((meta && meta.name ? meta.name : "") + "님의 보장분석", body, REPORT_EXTRA_STYLE, ogHead + backGuardScript());
}

const PHOTO_VIEW_STYLE = `
.photo-view-bar { position:sticky; top:0; z-index:10; align-self:stretch; width:100%;
  display:flex; align-items:center; justify-content:space-between;
  height:56px; padding:0 20px; background:#ffffff; border-bottom:1px solid #e5e8eb; box-sizing:border-box; }
.photo-view-bar .brand-logo-link { display:flex; align-items:center; gap:6px; text-decoration:none; }
.photo-view-bar .back-link { font-size:14px; font-weight:700; color:#3182f6; text-decoration:none; }
.photo-view { padding:20px; display:flex; flex-direction:column; gap:16px; }
.photo-view h1 { margin:0; font-size:18px; font-weight:800; color:#191f28; }
.photo-view img { width:100%; border-radius:12px; border:1px solid #e5e8eb; display:block; }
`;

function photoViewPage(slug, meta) {
  const header = `<header class="photo-view-bar">
    <a class="brand-logo-link" href="/index.html"><img class="brand-logo" src="${LOGO_URL}" alt="토스"><span class="brand-text">toss insurance</span></a>
    <a class="back-link" href="/r/${escapeHtml(slug)}">← 뒤로 가기</a>
  </header>`;
  const body = `<div class="page-frame">${header}<div class="photo-view">
    <h1>보장, 한 장으로 보기</h1>
    <img src="/photo/${escapeHtml(slug)}/2" alt="보장 분석표">
    <a class="btn" href="/photo/${escapeHtml(slug)}/2?dl=1" download="보장분석표.png" style="text-decoration:none">이미지 다운로드</a>
  </div></div>`;
  return shellPage((meta && meta.name ? meta.name + "님의 " : "") + "보장분석표", body, PHOTO_VIEW_STYLE);
}

// 리포트 포맷(html 업로드형 / images 사진 2장형)에 따라 알맞은 렌더러로 분기한다.
function renderReport(slug, meta, rawValue) {
  if (meta.format === "images") return imageReportHtml(slug, meta);
  return wrapReportHtml(rawValue, meta);
}

async function loadGatedRecord(request, env, slug) {
  const record = await env.REPORTS.getWithMetadata("report:" + slug);
  if (!record.metadata) {
    return { ok: false, response: new Response(expiredPage(), { headers: { "Content-Type": "text/html; charset=UTF-8" } }) };
  }
  if (record.metadata.dob) {
    const cookies = parseCookies(request);
    if (cookies["v_" + slug] !== "1") {
      return { ok: false, response: Response.redirect(new URL("/r/" + slug, request.url).toString(), 302) };
    }
  }
  return { ok: true, record };
}

// ---------- 라우팅 ----------

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;

    if (!env.REPORTS) {
      return new Response("서버 설정 오류: KV 바인딩(REPORTS)이 연결되어 있지 않습니다.", { status: 500 });
    }
    if (!env.ADMIN_PASSWORD) {
      return new Response("서버 설정 오류: ADMIN_PASSWORD 시크릿이 설정되어 있지 않습니다.", { status: 500 });
    }
    const adminPassword = typeof env.ADMIN_PASSWORD === "string" ? env.ADMIN_PASSWORD : await env.ADMIN_PASSWORD.get();

    // ── 관리자 로그인 ──
    if (path === "/admin/login" && request.method === "POST") {
      const form = await request.formData();
      const password = form.get("password");
      if (!safeEqual(password, adminPassword)) {
        return new Response(loginPage("비밀번호가 올바르지 않습니다."), { headers: { "Content-Type": "text/html; charset=UTF-8" } });
      }
      const token = randomToken();
      await env.REPORTS.put("session:" + token, "1", { expirationTtl: SESSION_TTL_SECONDS });
      return new Response(null, {
        status: 302,
        headers: { Location: "/admin", "Set-Cookie": setCookie(SESSION_COOKIE, token, { maxAge: SESSION_TTL_SECONDS }) },
      });
    }

    if (path === "/admin/logout") {
      const cookies = parseCookies(request);
      if (cookies[SESSION_COOKIE]) await env.REPORTS.delete("session:" + cookies[SESSION_COOKIE]);
      return new Response(null, { status: 302, headers: { Location: "/admin", "Set-Cookie": clearCookie(SESSION_COOKIE) } });
    }

    // ── 관리자 대시보드(인증 필요) ──
    if (path === "/admin" || path === "/admin/") {
      if (!(await isAuthed(request, env))) {
        return new Response(loginPage(), { headers: { "Content-Type": "text/html; charset=UTF-8" } });
      }
      return new Response(dashboardPage(), { headers: { "Content-Type": "text/html; charset=UTF-8" } });
    }

    if (path === "/admin/list") {
      if (!(await isAuthed(request, env))) return new Response("unauthorized", { status: 401 });
      const listRes = await env.REPORTS.list({ prefix: "report:" });
      const filtered = listRes.keys.filter((k) => k.metadata);
      const views = await Promise.all(
        filtered.map((k) => env.REPORTS.get("views:" + k.name.slice("report:".length)))
      );
      const items = filtered
        .map((k, i) => ({
          slug: k.name.slice("report:".length),
          name: k.metadata.name,
          category: k.metadata.category,
          createdAt: k.metadata.createdAt,
          expiresAt: k.metadata.expiresAt,
          locked: !!k.metadata.dob,
          format: k.metadata.format || "html",
          views: parseInt(views[i] || "0", 10),
        }))
        .sort((a, b) => b.createdAt - a.createdAt);
      return new Response(JSON.stringify({ items }), { headers: { "Content-Type": "application/json" } });
    }

    if (path === "/admin/upload" && request.method === "POST") {
      if (!(await isAuthed(request, env))) return new Response("unauthorized", { status: 401 });
      const body = await readJson(request);
      if (!body || !body.name || (body.dob && !/^\d{6}$/.test(body.dob))) {
        return new Response(JSON.stringify({ error: "입력값을 확인해주세요." }), { status: 400, headers: { "Content-Type": "application/json" } });
      }
      const format = body.format === "images" ? "images" : "html";
      if (format === "html" && !body.html) {
        return new Response(JSON.stringify({ error: "HTML 파일을 선택해주세요." }), { status: 400, headers: { "Content-Type": "application/json" } });
      }
      if (format === "images" && (!body.photo1 || !body.photo2)) {
        return new Response(JSON.stringify({ error: "사진 2장을 모두 선택해주세요." }), { status: 400, headers: { "Content-Type": "application/json" } });
      }
      const category = ["취소고객용", "기고객용"].indexOf(body.category) > -1 ? body.category : "취소고객용";
      const isPermanent = body.expiryDays === "none";
      const slug = randomSlug(14);
      const createdAt = Date.now();
      const expiryDays = isPermanent ? null : Math.max(1, Math.min(90, parseInt(body.expiryDays, 10) || 14));
      const expiresAt = isPermanent ? null : createdAt + expiryDays * 86400000;
      const meta = { name: String(body.name).slice(0, 40), category, dob: body.dob || "", createdAt, expiresAt, format };
      const reportPutOpts = { metadata: meta };
      if (!isPermanent) reportPutOpts.expirationTtl = expiryDays * 86400;

      if (format === "images") {
        const p1 = decodeDataUrl(body.photo1);
        const p2 = decodeDataUrl(body.photo2);
        if (!p1 || !p2) {
          return new Response(JSON.stringify({ error: "이미지 파일을 다시 선택해주세요." }), { status: 400, headers: { "Content-Type": "application/json" } });
        }
        meta.photo1Type = p1.contentType;
        meta.photo2Type = p2.contentType;
        await env.REPORTS.put("report:" + slug, "[image-report]", reportPutOpts);
        const assetOpts = isPermanent ? { metadata: meta } : { metadata: meta, expirationTtl: expiryDays * 86400 };
        await env.REPORTS.put("photo1:" + slug, p1.bytes, assetOpts);
        await env.REPORTS.put("photo2:" + slug, p2.bytes, assetOpts);
        await env.REPORTS.put("thumb:" + slug, p1.bytes, isPermanent ? {} : { expirationTtl: expiryDays * 86400 });
      } else {
        await env.REPORTS.put("report:" + slug, body.html, reportPutOpts);
        if (typeof body.thumb === "string" && body.thumb.startsWith("data:image/png;base64,")) {
          try {
            const base64 = body.thumb.slice("data:image/png;base64,".length);
            const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
            const thumbPutOpts = isPermanent ? {} : { expirationTtl: expiryDays * 86400 };
            await env.REPORTS.put("thumb:" + slug, bytes, thumbPutOpts);
          } catch (e) {
            // 썸네일 저장 실패는 배포 자체를 막지 않는다.
          }
        }
      }
      return new Response(JSON.stringify({ slug, url: url.origin + "/r/" + slug }), { headers: { "Content-Type": "application/json" } });
    }

    if (path === "/admin/delete" && request.method === "POST") {
      if (!(await isAuthed(request, env))) return new Response("unauthorized", { status: 401 });
      const body = await readJson(request);
      if (body && body.slug) {
        await env.REPORTS.delete("report:" + body.slug);
        await env.REPORTS.delete("thumb:" + body.slug);
        await env.REPORTS.delete("views:" + body.slug);
        await env.REPORTS.delete("photo1:" + body.slug);
        await env.REPORTS.delete("photo2:" + body.slug);
      }
      return new Response(JSON.stringify({ ok: true }), { headers: { "Content-Type": "application/json" } });
    }

    const thumbMatch = path.match(/^\/admin\/thumb\/([A-Za-z0-9]+)$/);
    if (thumbMatch) {
      if (!(await isAuthed(request, env))) return new Response("unauthorized", { status: 401 });
      const bytes = await env.REPORTS.get("thumb:" + thumbMatch[1], { type: "arrayBuffer" });
      if (!bytes) return new Response("no thumbnail", { status: 404 });
      return new Response(bytes, { headers: { "Content-Type": "image/png", "Cache-Control": "private, max-age=86400" } });
    }

    // ── 고객용 리포트 열람 ──
    const rMatch = path.match(/^\/r\/([A-Za-z0-9]+)(?:\/(verify))?$/);
    if (rMatch) {
      const slug = rMatch[1];
      const isVerify = rMatch[2] === "verify";
      const record = await env.REPORTS.getWithMetadata(slug.startsWith("report:") ? slug : "report:" + slug);

      if (isVerify && request.method === "POST") {
        if (!record.metadata) return new Response(expiredPage(), { headers: { "Content-Type": "text/html; charset=UTF-8" } });
        const failKey = "fail:" + slug;
        const failCount = parseInt((await env.REPORTS.get(failKey)) || "0", 10);
        if (failCount >= MAX_VERIFY_ATTEMPTS) {
          return new Response(gatePage(slug, "확인 시도 횟수를 초과했습니다. 15분 후 다시 시도해주세요.", record.metadata.category), { headers: { "Content-Type": "text/html; charset=UTF-8" } });
        }
        const form = await request.formData();
        const dob = String(form.get("dob") || "").trim();
        if (!safeEqual(dob, record.metadata.dob)) {
          await env.REPORTS.put(failKey, String(failCount + 1), { expirationTtl: VERIFY_LOCKOUT_SECONDS });
          return new Response(gatePage(slug, "생년월일이 일치하지 않습니다.", record.metadata.category), { headers: { "Content-Type": "text/html; charset=UTF-8" } });
        }
        await env.REPORTS.delete(failKey);
        const remainSeconds = record.metadata.expiresAt == null
          ? 365 * 86400
          : Math.max(60, Math.floor((record.metadata.expiresAt - Date.now()) / 1000));
        // 사진 2장형 리포트는 사진이 /photo/:slug/... 경로에서 로드되므로, 확인 쿠키를
        // /r/:slug 경로로만 좁혀두면 그 경로엔 쿠키가 안 실려서 이미지가 안 뜬다.
        return new Response(null, {
          status: 302,
          headers: { Location: "/r/" + slug, "Set-Cookie": setCookie("v_" + slug, "1", { path: "/", maxAge: remainSeconds }) },
        });
      }

      if (!record.value || !record.metadata) {
        return new Response(expiredPage(), { headers: { "Content-Type": "text/html; charset=UTF-8" } });
      }
      if (!record.metadata.dob) {
        await incrementViews(env, slug);
        return new Response(renderReport(slug, record.metadata, record.value), { headers: { "Content-Type": "text/html; charset=UTF-8" } });
      }
      const cookies = parseCookies(request);
      if (cookies["v_" + slug] === "1") {
        await incrementViews(env, slug);
        return new Response(renderReport(slug, record.metadata, record.value), { headers: { "Content-Type": "text/html; charset=UTF-8" } });
      }
      return new Response(gatePage(slug, null, record.metadata.category), { headers: { "Content-Type": "text/html; charset=UTF-8" } });
    }

    // ── 사진 2장형 리포트의 사진 파일/보기 페이지 ──
    const photoMatch = path.match(/^\/photo\/([A-Za-z0-9]+)\/([12])$/);
    if (photoMatch) {
      const photoSlug = photoMatch[1];
      const n = photoMatch[2];
      const gated = await loadGatedRecord(request, env, photoSlug);
      if (!gated.ok) return gated.response;
      const bytes = await env.REPORTS.get("photo" + n + ":" + photoSlug, { type: "arrayBuffer" });
      if (!bytes) return new Response("no image", { status: 404 });
      const contentType = gated.record.metadata["photo" + n + "Type"] || "image/png";
      const headers = { "Content-Type": contentType, "Cache-Control": "private, max-age=86400" };
      if (n === "2" && url.searchParams.get("dl") === "1") {
        const ext = contentType === "image/jpeg" ? "jpg" : contentType === "image/webp" ? "webp" : "png";
        headers["Content-Disposition"] = 'attachment; filename="보장분석표.' + ext + '"';
      }
      return new Response(bytes, { headers });
    }

    const photoViewMatch = path.match(/^\/photo\/([A-Za-z0-9]+)\/2\/view$/);
    if (photoViewMatch) {
      const viewSlug = photoViewMatch[1];
      const gated = await loadGatedRecord(request, env, viewSlug);
      if (!gated.ok) return gated.response;
      return new Response(photoViewPage(viewSlug, gated.record.metadata), { headers: { "Content-Type": "text/html; charset=UTF-8" } });
    }

    return new Response("Not found", { status: 404 });
  },
};
