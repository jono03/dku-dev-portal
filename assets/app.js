// 페이지별 렌더링. 계산은 state.js의 computeSummary() / computeChange()만 사용한다.

const SURVEY_LABELS = {
  purpose:    { web: '웹 서버 구동', model: '모델 학습', practice: '단순 실습' },
  scale:      { light: '가벼움', normal: '보통', heavy: '무거움' }
};

// 아키텍처 프리뷰 아이콘. 파일이 없으면 이니셜 배지로 대체된다.
const ICON_FILES = {
  ubuntu22: 'ubuntu.svg', rocky9: 'rocky-linux.svg', debian12: 'debian.svg',
  mysql: 'mysql.svg', mongodb: 'mongodb.svg', kafka: 'kafka.svg',
  postgresql: 'postgresql.svg', redis: 'redis.svg', nginx: 'nginx.svg', docker: 'docker.svg'
};
const ICON_FALLBACK = {
  ubuntu22: 'U', rocky9: 'R', debian12: 'D', mysql: 'My', mongodb: 'Mo', kafka: 'K',
  postgresql: 'Pg', redis: 'Re', nginx: 'N', docker: 'Do'
};

/* ---------- 공용 헬퍼 ---------- */

function esc(s) {
  return String(s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}
function fmt(n) { return n.toLocaleString(); }
function specText(f) { return f.cpu + ' Core / ' + f.ram + 'GB'; }
function osById(id) { return OS_LIST.filter(function (o) { return o.id === id; })[0] || OS_LIST[0]; }
function osSlug(id) {
  return osById(id).name.replace(/ LTS$/, '').toLowerCase().replace(/\s+/g, '-');
}
function addonNames(ids) {
  return ids.length ? ids.map(function (id) { return ADDONS[id].name; }).join(', ') : '없음';
}
function formatLeft(hours) {
  if (hours < 24) return hours + '시간';
  const d = Math.floor(hours / 24), h = hours % 24;
  return d + '일' + (h ? ' ' + h + '시간' : '');
}
function signed(n) { return (n > 0 ? '+' : n < 0 ? '-' : '') + fmt(Math.abs(n)); }

function iconHtml(key, cls) {
  return '<span class="' + cls + '"><img src="assets/icons/' + ICON_FILES[key] +
         '" alt="" data-fallback="' + ICON_FALLBACK[key] + '"></span>';
}

// 아이콘 파일이 없을 때 이니셜 배지로 교체 (error 이벤트는 버블링되지 않아 캡처 단계에서 위임)
document.addEventListener('error', function (e) {
  const img = e.target;
  if (img.tagName !== 'IMG' || !img.dataset.fallback) return;
  const badge = document.createElement('span');
  badge.className = 'mono-badge';
  badge.textContent = img.dataset.fallback;
  img.replaceWith(badge);
}, true);

function alertsHtml(warnings) {
  return warnings.map(function (w) {
    return '<div class="alert alert--' + (w.level === 'block' ? 'block' : 'warn') + '">' +
           '<span class="alert__tag">' + (w.level === 'block' ? '차단' : '주의') + '</span>' +
           '<span>' + esc(w.msg) + '</span></div>';
  }).join('');
}

function showToast(msg) {
  Array.prototype.forEach.call(document.querySelectorAll('.toast'), function (x) { x.remove(); });   // 겹치지 않게 이전 것은 지운다
  const t = document.createElement('div');
  t.className = 'toast';
  t.setAttribute('role', 'status');
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(function () { t.remove(); }, 3000);
}

// 공용 모달. handler(action, dialog)가 true를 반환하면 닫지 않는다.
function openDialog(html, handler) {
  const d = document.createElement('dialog');
  d.innerHTML = html;
  document.body.appendChild(d);
  d.addEventListener('click', function (e) {
    const b = e.target.closest('[data-action]');
    if (!b) return;
    if (handler(b.dataset.action, d) !== true) d.close();
  });
  d.addEventListener('keydown', function (e) {
    if (e.key !== 'Enter' || e.target.tagName !== 'INPUT') return;
    e.preventDefault();
    const def = d.querySelector('[data-default]');
    if (def) def.click();
  });
  d.addEventListener('close', function () { d.remove(); });
  d.showModal();
  return d;
}

function confirmDialog(title, text, okLabel, onOk) {
  openDialog(
    '<h2>' + esc(title) + '</h2><p>' + esc(text) + '</p>' +
    '<div class="actions"><button type="button" class="btn btn--secondary" data-action="cancel">취소</button>' +
    '<button type="button" class="btn" data-action="ok">' + esc(okLabel) + '</button></div>',
    function (action) { if (action === 'ok') onOk(); });
}

function saveTemplateDialog(state) {
  const d = openDialog(
    '<h2>템플릿으로 저장</h2>' +
    '<p>지금 구성을 저장해 두면 다음에 설문 없이 바로 불러올 수 있습니다.</p>' +
    '<input class="input" type="text" maxlength="30" aria-label="템플릿 이름" value="' +
      esc(defaultTemplateName(state)) + '">' +
    '<div class="form-error" role="alert"></div>' +
    '<div class="actions"><button type="button" class="btn btn--secondary" data-action="cancel">취소</button>' +
    '<button type="button" class="btn" data-action="save" data-default>저장</button></div>',
    function (action, dlg) {
      if (action !== 'save') return;
      const name = dlg.querySelector('input').value.trim();
      if (!name) {
        dlg.querySelector('.form-error').textContent = '템플릿 이름을 입력하세요.';
        return true;
      }
      state.templates.push(makeTemplate(state, name));
      saveState(state);
      showToast('"' + name + '" 템플릿을 저장했습니다. My Page에서 확인할 수 있습니다.');
    });
  const input = d.querySelector('input');
  input.focus();
  input.select();
}

/* ---------- 세션 / 상단 / 쿼터 위젯 ---------- */

function renderTopbar() {
  const el = document.getElementById('topbar-user');
  const s = getSession();
  if (!el || !s) return;
  const u = currentUser(loadState());
  el.innerHTML =
    '<button type="button" class="bell" id="bell" aria-label="알림" aria-expanded="false" aria-controls="notif-pop">' +
      '<svg viewBox="0 0 16 16" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M3.5 11.5h9l-1.2-1.6V7a3.3 3.3 0 0 0-6.6 0v2.9L3.5 11.5zM6.6 13.5a1.5 1.5 0 0 0 2.8 0"/></svg>' +
      '<span class="bell__badge" id="bell-badge" hidden></span></button>' +
    '<div class="notif-pop" id="notif-pop" hidden></div>' +
    '<span class="topbar__credit" title="잔여 크레딧">잔여 <b id="topbar-credit">' + fmt(remainingCredit(loadState())) + '</b></span>' +
    '<span>' + esc(u.studentNo + ' ' + u.name + ' \u00B7 ' + u.team) + '</span>' +
    '<a href="mypage.html">My Page</a>' +
    '<button type="button" class="btn btn--sm btn--secondary" data-action="logout">로그아웃</button>';
  if (el.dataset.bound) return;   // 프로필 수정 뒤 다시 그려도 리스너는 한 번만 등록
  el.dataset.bound = '1';
  el.addEventListener('click', function (e) {
    if (e.target.closest('#bell')) { toggleNotifPop(); return; }
    if (e.target.closest('[data-action="notif-read"]')) { markNotifsRead(); renderNotifPop(); updateBell(); return; }
    if (!e.target.closest('[data-action="logout"]')) return;
    logout();
    location.href = 'login.html';
  });
  document.addEventListener('click', function (e) {
    const pop = document.getElementById('notif-pop');
    if (pop && !pop.hidden && !e.target.closest('#notif-pop') && !e.target.closest('#bell')) closeNotifPop();
  });
  document.addEventListener('keydown', function (e) {
    const pop = document.getElementById('notif-pop');
    if (e.key === 'Escape' && pop && !pop.hidden) { closeNotifPop(); document.getElementById('bell').focus(); }
  });
}

/* ---------- 알림 센터 (종 아이콘) ---------- */

function unreadNotifs(state) {
  const seen = (state.hints && state.hints.seen) || [];
  return buildNotifications(state).filter(function (n) { return seen.indexOf(n.key) === -1; });
}
function updateBell() {
  const badge = document.getElementById('bell-badge');
  if (!badge) return;
  const n = unreadNotifs(loadState()).length;
  badge.hidden = n === 0;
  badge.textContent = n > 9 ? '9+' : String(n);
}
function markNotifsRead() {
  const state = loadState();
  state.hints.seen = buildNotifications(state).map(function (n) { return n.key; });
  saveState(state);
}
function renderNotifPop() {
  const pop = document.getElementById('notif-pop');
  const state = loadState();
  const seen = state.hints.seen || [];
  const items = buildNotifications(state);
  pop.innerHTML = '<div class="notif-pop__head"><strong>알림</strong>' +
    (items.some(function (n) { return seen.indexOf(n.key) === -1; })
      ? '<button type="button" class="link-btn" data-action="notif-read">모두 읽음</button>' : '') + '</div>' +
    (items.length ? items.map(function (n) {
      return '<a class="notif-item notif-item--' + n.level + (seen.indexOf(n.key) === -1 ? ' is-unread' : '') + '" href="' + n.href + '">' +
        '<span class="notif-item__title">' + esc(n.title) + '</span><span class="notif-item__text">' + esc(n.text) + '</span></a>';
    }).join('') : '<p class="notif-empty">새 알림이 없습니다.</p>') +
    '<a class="notif-pop__foot" href="mypage.html">알림 설정</a>';
}
function openNotifPop() {
  renderNotifPop();
  document.getElementById('notif-pop').hidden = false;
  document.getElementById('bell').setAttribute('aria-expanded', 'true');
  markNotifsRead();          // 열어 본 알림은 읽은 것으로 본다 (목록에는 이번에 한해 강조 표시가 남는다)
  updateBell();
}
function closeNotifPop() {
  document.getElementById('notif-pop').hidden = true;
  document.getElementById('bell').setAttribute('aria-expanded', 'false');
}
function toggleNotifPop() {
  if (document.getElementById('notif-pop').hidden) openNotifPop(); else closeNotifPop();
}

function renderQuotaWidget() {
  const el = document.getElementById('quota-widget');
  if (!el) return;
  const remaining = remainingCredit(loadState());
  const tc = document.getElementById('topbar-credit');
  if (tc) tc.textContent = fmt(remaining);
  updateBell();
  const pct = Math.max(0, Math.round((remaining / USER_QUOTA.maxCredit) * 100));
  el.innerHTML =
    '<div class="quota__title">내 쿼터</div>' +
    '<div class="quota__row quota__row--stack"><span>잔여 크레딧</span>' +
      '<span class="quota__value">' + fmt(remaining) + ' / ' +
      fmt(USER_QUOTA.maxCredit) + '</span></div>' +
    '<div class="quota__gauge" role="img" aria-label="잔여 크레딧 ' + pct + '%">' +
      '<span style="width:' + pct + '%"></span></div>' +
    '<div class="quota__row"><span>VM당 최대 RAM</span>' +
      '<span class="quota__value">' + USER_QUOTA.maxRam + 'GB</span></div>';
}

/* ---------- 생성 요청 (builder / result 공용) ---------- */

let provisioning = false;

// 생성 화면(New Env, 추천 결과)의 저장소 입력. 입력 값은 state.repoDraft에 저장한다. 폼 컨트롤은 다시 그리지 않는다.
function initRepoFields(state) {
  const url = document.getElementById('repo-url'), br = document.getElementById('repo-branch');
  if (!url || !br) return;
  url.value = state.repoDraft.url || '';
  br.value = state.repoDraft.branch || 'main';
  const save = function () { state.repoDraft = { url: url.value.trim(), branch: br.value.trim() }; saveState(state); };
  url.addEventListener('input', save);
  br.addEventListener('input', save);
}

// 생성 화면의 프로젝트 입력(선택). 기존 프로젝트 이름은 자동완성으로 보여 준다.
function initProjectField(state) {
  const el = document.getElementById('project-input');
  if (!el) return;
  el.value = state.projectDraft || '';
  document.getElementById('project-list').innerHTML = projectNames(state).map(function (n) {
    return '<option value="' + esc(n) + '"></option>'; }).join('');
  el.addEventListener('input', function () { state.projectDraft = cleanProject(el.value); saveState(state); });
}

// 생성 전에 저장소 입력을 검사한다. 비어 있으면 통과(선택 항목), 틀리면 안내하고 false.
function checkRepoDraft(state) {
  const d = state.repoDraft;
  const msg = document.getElementById('repo-msg');
  if (!d || !d.url) return true;
  const u = validateRepoUrl(d.url), b = validateBranch(d.branch || 'main');
  if (u.ok && b.ok) return true;
  if (msg) { msg.textContent = (u.ok ? b.msg : u.msg); msg.classList.add('field-error'); }
  const el = document.getElementById(u.ok ? 'repo-branch' : 'repo-url');
  if (el) el.focus();
  return false;
}

function requestCreate(state) {
  if (provisioning) return;
  if (!checkRepoDraft(state)) return;
  saveState(state);
  if (computeSummary(state).blocked) {
    location.href = 'error.html';
    return;
  }
  provisioning = true;
  runProvisioning(state, function () {
    const r = createResource(state);
    state.resources.push(r);
    applyCredit(state, 'create', r, r.cost);   // 선불: 생성 시 총액 차감
    state.resourceName = '';
    state.lastCreatedId = r.id; state.cloneFrom = null; state.cloneOrigin = null; state.repoDraft = { url: '', branch: 'main' }; state.projectDraft = ''; markOnboard(state, 'create');
    saveState(state);
    location.href = 'created.html';
  });
}

// 가짜 배포 로그. 줄마다 지연을 다르게 주고 전체 12초를 넘기지 않는다.
function runProvisioning(state, onDone) {
  const flavor = FLAVORS[state.flavor];
  const lines = [
    '요청 검증: 쿼터 및 잔여 크레딧 확인',
    'VM 인스턴스 할당 (' + flavor.name + ', ' + specText(flavor) + ')',
    'OS 이미지 복제: ' + osById(state.os).name,
    '디스크 초기화 및 파일시스템 생성 (' + (state.disk || DISK_INCLUDED_GB) + 'GB SSD)'
  ];
  state.addons.forEach(function (id) {
    lines.push('패키지 설치: ' + ADDONS[id].name);
    lines.push(ADDONS[id].name + ' 서비스 기동 및 상태 점검');
  });
  lines.push('SSH 데몬 설정, 기본 계정 soft2021 생성');
  lines.push('TTL 등록: ' + state.ttl + '일 후 자동 회수');
  lines.push('상태 확인: running');

  const base = [420, 260, 780, 350, 900, 240, 610, 330, 850, 270, 540, 700, 300];
  let delays = lines.map(function (_, i) { return base[i % base.length]; });
  const total = delays.reduce(function (a, b) { return a + b; }, 0);
  const limit = 10500;
  if (total > limit) delays = delays.map(function (d) { return Math.round(d * limit / total); });

  const overlay = document.createElement('div');
  overlay.className = 'overlay';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-label', '환경 배포 진행 상황');
  overlay.innerHTML =
    '<div class="overlay__box">' +
      '<h2 class="card__title">환경을 배포하는 중입니다</h2>' +
      '<div class="progress"><span id="prov-bar"></span></div>' +
      '<div class="progress__pct" id="prov-pct">0%</div>' +
      '<div class="log" id="prov-log"></div>' +
    '</div>';
  document.body.appendChild(overlay);

  const log = overlay.querySelector('#prov-log');
  const bar = overlay.querySelector('#prov-bar');
  const pct = overlay.querySelector('#prov-pct');
  const start = Date.now();
  let i = 0;

  function step() {
    if (i >= lines.length) { setTimeout(onDone, 600); return; }
    const t = ((Date.now() - start) / 1000).toFixed(2).padStart(5, '0');
    const row = document.createElement('div');
    row.innerHTML = '<span class="t">[' + t + ']</span>' + esc(lines[i]);
    log.appendChild(row);
    log.scrollTop = log.scrollHeight;
    i++;
    const p = Math.round((i / lines.length) * 100);
    bar.style.width = p + '%';
    pct.textContent = p + '%';
    setTimeout(step, delays[i - 1]);
  }
  step();
}

/* ---------- login ---------- */

function initLoginPage() {
  const form = document.getElementById('login-form');
  const err = document.getElementById('login-error');
  form.addEventListener('submit', function (e) {
    e.preventDefault();
    if (login(form.elements.id.value.trim(), form.elements.pw.value)) {
      location.href = 'index.html';
    } else {
      err.textContent = '아이디 또는 비밀번호가 일치하지 않습니다.';
    }
  });
}

/* ---------- home ---------- */

// 이름 제안: 확인 화면에서 미리 채워 주고 사용자가 고칠 수 있게 한다.
function suggestName(state) {
  if (state.templateName) return state.templateName;
  const a = state.surveyAnswers;
  const label = a ? { web: '웹 서버', model: '모델 학습 서버', practice: '실습 서버' }[a.purpose]
                  : FLAVORS[state.flavor].name + ' 서버';
  return currentUser(state).team + ' ' + label;
}

// 프리셋/템플릿을 state에 적용하고 확인 화면으로 보낸다.
// templateName: 저장한 템플릿에서 시작할 때만 넣는다. resourceName: 확인 화면에 미리 채울 서버 이름.
function startFrom(state, cfg, templateName, resourceName) {
  state.os = cfg.os; state.flavor = cfg.flavor; state.addons = cfg.addons.slice();
  state.disk = cfg.disk || DISK_INCLUDED_GB;
  state.ttl = cfg.ttl; state.surveyAnswers = null; state.templateName = templateName; state.cloneFrom = null;
  state.resourceName = resourceName || '';
  saveState(state);
  location.href = 'result.html';
}

// 프리셋(골든 패스)에 무엇이 포함되고 어떤 가드레일이 걸리는지. 값은 모두 catalog의 상수에서 읽는다.
function goldenPathHtml(p, s) {
  const saving = scheduleEstimate({ flavor: p.flavor, addons: p.addons, disk: p.disk, ttlLeftHours: p.ttl * 24 }, defaultSchedule()).perDay;
  const row = function (k, v) { return '<div class="gp__row"><dt>' + esc(k) + '</dt><dd>' + v + '</dd></div>'; };
  return '<details class="gp"><summary>무엇이 포함되나요</summary><dl class="gp__list">' +
    row('운영체제', esc(osById(p.os).name)) +
    row('사양', esc(s.flavor.name) + ' (' + specText(s.flavor) + ')') +
    row('디스크', p.disk + 'GB SSD') +
    row('도구', p.addons.length ? esc(addonNames(p.addons)) : '없음') +
    (p.deploy ? row('배포 설정', '포함 (저장소를 연결하면 push할 때마다 자동 배포)') : '') +
    '<div class="gp__h">안전 장치</div>' +
    row('기본 기한', p.ttl + '일 (만료되면 자동 정지)') +
    row('자동 중지', scheduleText(defaultSchedule()).split(' (')[0] + ' 권장, 하루 약 ' + fmt(saving) + ' 크레딧 절약(예상)') +
    row('크레딧', '잔액이 부족하면 관리자 승인을 요청합니다') +
    '</dl></details>';
}

function logosHtml(os, addons) {
  return [os].concat(addons).map(function (k) {
    return '<img src="assets/icons/' + ICON_FILES[k] + '" alt="" data-fallback="' + ICON_FALLBACK[k] + '">';
  }).join('');
}

function initHomePage() {
  const state = loadState();
  document.getElementById('home-hello').textContent = currentUser(state).name + '님, 안녕하세요';

  document.getElementById('preset-list').innerHTML = PRESETS.map(function (p) {
    const s = computeSummary({ os: p.os, flavor: p.flavor, addons: p.addons, disk: p.disk, ttl: p.ttl,
                               creditDelta: state.creditDelta });
    return '<div class="card preset' + (p.recommended ? ' preset--rec' : '') + '">' +
      (p.recommended ? '<span class="preset__badge">가장 많이 써요</span>' : '') +
      '<div class="preset__logos">' + logosHtml(p.os, p.addons) + '</div>' +
      '<div class="preset__name">' + esc(p.name) + '</div>' +
      '<div class="preset__desc">' + esc(p.desc) + '</div>' +
      '<div class="preset__use"><span class="muted">이런 때 쓰세요</span> ' + esc(p.useCase) + '</div>' +
      goldenPathHtml(p, s) +
      '<div class="preset__chips"><span class="chip">' + s.flavor.name + ' · ' + specText(s.flavor) + '</span>' +
        (p.addons.length ? '<span class="chip">' + esc(addonNames(p.addons)) + '</span>' : '') +
        '<span class="chip">' + p.disk + 'GB SSD</span></div>' +
      '<div class="preset__cost">하루 ' + fmt(s.dailyCost) + ' · ' + p.ttl + '일 ' +
        (s.blocked ? '<span class="over">' + fmt(s.totalCost) + ' (잔액 부족)</span>' : fmt(s.totalCost)) + ' 크레딧</div>' +
      '<button type="button" class="btn' + (p.recommended ? '' : ' btn--secondary') + '" data-action="preset" data-id="' + p.id + '">이 구성으로 시작</button></div>';
  }).join('');

  document.getElementById('preset-list').addEventListener('click', function (e) {
    const b = e.target.closest('[data-action="preset"]');
    if (!b) return;
    const p = PRESETS.filter(function (x) { return x.id === b.dataset.id; })[0];
    startFrom(state, p, null, currentUser(state).team + ' ' + p.name + (/서버$/.test(p.name) ? '' : ' 서버'));
  });

  // 저장한 템플릿
  if (state.templates.length) {
    document.getElementById('home-templates').hidden = false;
    const list = document.getElementById('home-template-list');
    list.innerHTML = state.templates.map(function (t) {
      return '<button type="button" class="btn btn--secondary btn--sm" data-action="use-template" data-id="' +
             esc(t.id) + '">' + esc(t.name) + '</button>';
    }).join('');
    list.addEventListener('click', function (e) {
      const b = e.target.closest('[data-action="use-template"]');
      if (!b) return;
      const t = state.templates.filter(function (x) { return x.id === b.dataset.id; })[0];
      startFrom(state, t, t.name, '');
    });
  }

  // 내 서버 요약 + 만료 임박 안내
  const mine = state.resources.filter(isMine);
  const urgent = mine.filter(function (r) { return r.ttlLeftHours < LIFECYCLE_POLICY.warnBeforeHours; });
  const running = mine.filter(function (r) { return r.status !== 'stopped'; }).length;
  const fc = creditForecast(state);
  document.getElementById('home-summary').innerHTML = mine.length
    ? '<div>운영 중 ' + running + '대, 중지 ' + (mine.length - running) + '대. 하루 ' + fmt(fc.daily) + ' 크레딧이 사용됩니다.' +
      (fc.days !== null ? '<div class="muted-p" style="margin:4px 0 0">지금 서버를 그대로 연장한다면 잔여 크레딧으로 약 ' + fmt(fc.days) + '일 더 쓸 수 있어요.</div>' : '') + '</div>' +
      '<a class="btn btn--secondary btn--sm" href="dashboard.html">내 서버 관리하기</a>'
    : '<div>아직 만든 서버가 없습니다. 위에서 하나 골라 시작해 보세요.</div>';

  // 절약 팁: 자동 중지가 없는 서버가 있을 때
  const tipEl = document.getElementById('home-tip');
  const un = unscheduledServers(state);
  tipEl.hidden = !un.length;
  if (un.length) {
    tipEl.innerHTML = '<div><strong>절약 팁: 자동 중지</strong><div class="muted-p" style="margin:4px 0 0">서버 ' + un.length +
      '대가 밤새 켜져 있어요. 평일 밤에 자동으로 멈추면 하루 약 ' + fmt(scheduleTipSaving(state)) + ' 크레딧을 아낄 수 있어요(예상).</div></div>' +
      '<a class="btn btn--sm" href="dashboard.html">대시보드에서 설정하기</a>';
  }

  // 시작 체크리스트
  const ob = document.getElementById('home-onboard');
  function renderOnboard() {
    const steps = onboardingSteps(state);
    const done = steps.filter(function (x) { return x.done; }).length;
    ob.hidden = done === steps.length || !!state.hints.onboardHidden;
    if (ob.hidden) return;
    ob.innerHTML = '<div class="onboard__head"><strong>시작 체크리스트 (' + done + '/' + steps.length + ')</strong>' +
      '<button type="button" class="link-btn" data-action="ob-hide">숨기기</button></div>' +
      '<ol class="onboard__list">' + steps.map(function (x) {
        return '<li class="onboard__item' + (x.done ? ' is-done' : '') + '"><span class="onboard__mark" aria-hidden="true">' + (x.done ? '\u2713' : '') + '</span>' +
          '<span class="onboard__label">' + esc(x.label) + '</span>' +
          (x.done ? '' : '<a class="link-btn" href="' + x.href + '">하러 가기</a>') +
          '<button type="button" class="btn btn--sm btn--secondary" data-action="ob-toggle" data-id="' + x.id +
          '" aria-pressed="' + x.done + '">' + (x.done ? '완료 취소' : '했어요') + '</button></li>';
      }).join('') + '</ol>';
  }
  renderOnboard();
  ob.addEventListener('click', function (e) {
    const t = e.target.closest('[data-action]');
    if (!t) return;
    if (t.dataset.action === 'ob-hide') state.hints.onboardHidden = true;
    else if (t.dataset.action === 'ob-toggle') {
      state.hints.onboard = state.hints.onboard || {};
      state.hints.onboard[t.dataset.id] = !state.hints.onboard[t.dataset.id];
    } else return;
    saveState(state);
    renderOnboard();
  });
  const banner = document.getElementById('home-banner');
  if (urgent.length) {
    banner.hidden = false;
    banner.innerHTML = '<div class="banner__text">' + esc(urgent[0].name) + '의 사용 기한이 ' +
      urgent[0].ttlLeftHours + '시간 남았습니다.</div>' +
      '<a class="btn btn--sm" href="dashboard.html">기한 연장하러 가기</a>';
  }
}

/* ---------- survey (한 번에 한 질문) ---------- */

const SURVEY_STEPS = [
  { key: 'purpose', label: '목적' }, { key: 'scale', label: '규모' }, { key: 'os', label: '운영체제' },
  { key: 'middleware', label: '도구' }, { key: 'ttl', label: '사용 기간' }
];

let surveyShown = {};   // 직전 프리뷰 상태. 바뀐 부분에만 등장 애니메이션을 준다.

// 답한 만큼만 채워지는 프리뷰. 아직 답하지 않은 자리는 점선 placeholder로 남겨 둔다.
function renderSurveyPreview(answers, sim) {
  const el = document.getElementById('preview');
  const answered = SURVEY_STEPS.some(function (s) { return answers[s.key]; });
  if (!answered) {
    el.innerHTML = '<div class="vm vm--empty"><div class="vm__empty" style="border:0">질문에 답하면 여기에 서버가 만들어집니다.</div></div>';
    surveyShown = {};
    return;
  }
  const flavorKnown = !!(answers.purpose || answers.scale);
  const f = FLAVORS[sim.state.flavor];
  const anim = function (key, val) { return val !== surveyShown[key] ? ' pv-new' : ''; };

  const logo = answers.os ? iconHtml(answers.os, 'vm__logo' + anim('os', answers.os))
                          : '<span class="vm__logo vm__logo--ph"></span>';
  const chips = flavorKnown
    ? '<span class="vm__chips' + anim('flavor', sim.state.flavor) + '"><span class="chip">' + f.cpu +
      ' Core</span><span class="chip">' + f.ram + 'GB RAM</span><span class="chip">' + sim.state.disk + 'GB SSD</span></span>'
    : '<span class="vm__chips"><span class="chip chip--ph">사양 선택 전</span></span>';

  const tools = answers.middleware || [];
  const picked = tools.filter(function (id) { return id !== 'none'; });
  const prevTools = surveyShown.middleware || [];
  let body;
  if (!tools.length) body = '<div class="vm__empty vm__empty--ph">함께 설치할 도구를 고르면 여기에 나타납니다</div>';
  else if (!picked.length) body = '<div class="vm__empty' + (prevTools.indexOf('none') === -1 ? ' pv-new' : '') + '">추가 SW 없음 (OS만 설치)</div>';
  else {
    body = '<div class="vm__addons">' + picked.map(function (id) {
      const a = ADDONS[id];
      return '<div class="sw' + (prevTools.indexOf(id) === -1 ? ' pv-new' : '') + '">' +
        iconHtml(id, 'sw__logo') + '<div><div class="sw__name">' + esc(a.name) +
        '</div><div class="sw__sub">' + fmt(a.costPerDay) + '/일</div></div></div>';
    }).join('') + '</div>';
  }

  let ram = '';
  if (picked.length && flavorKnown) {
    const need = requiredRam(picked), over = need > f.ram;
    ram = '<div class="vm__ram' + (over ? ' vm__ram--over' : '') + '"><div class="meter-label" style="margin-top:0"><span>RAM 여유</span>' +
      '<span>권장 ' + need + 'GB / VM ' + f.ram + 'GB</span></div><div class="meter' + (over ? ' meter--over' : '') +
      '"><span style="width:' + Math.min(100, Math.round(need / f.ram * 100)) + '%"></span></div>' +
      '<div class="vm__ram-note">' + (over ? 'RAM이 부족할 수 있습니다. 규모를 올려 보세요.'
        : sim.raisedByTools ? '고른 도구가 들어가도록 사양을 ' + f.name + '(으)로 올려 추천합니다.'
        : '설치한 SW를 돌리기에 충분합니다.') + '</div></div>';
  }

  const foot = answers.ttl
    ? '<div class="vm__foot' + anim('ttl', answers.ttl) + '">사용 기간 <span class="chip">' + answers.ttl +
      '일</span> 뒤 자동으로 회수됩니다</div>' : '';

  el.innerHTML = '<div class="vm"><div class="vm__head">' + logo + '<div class="vm__meta"><div class="vm__os">' +
    (answers.os ? esc(osById(answers.os).name) : '운영체제 선택 전') + '</div><div class="vm__slug">' +
    (answers.os ? esc(osSlug(answers.os)) : '-') + '</div></div>' + chips + '</div>' +
    '<div class="vm__body"><div class="vm__label">설치되는 소프트웨어</div>' + body + ram + foot + '</div></div>';

  surveyShown = { os: answers.os, flavor: flavorKnown ? sim.state.flavor : undefined,
                  middleware: tools.slice(), ttl: answers.ttl };
}

function initSurveyPage() {
  const form = document.getElementById('survey');
  const state = loadState();
  const nextBtn = document.getElementById('next-btn');
  const prevBtn = document.getElementById('prev-btn');
  const sections = SURVEY_STEPS.map(function (s) { return form.querySelector('[data-step="' + s.key + '"]'); });
  const last = SURVEY_STEPS.length - 1;
  let step = 0;

  const policy = document.querySelector('[data-policy="expiry"]');
  if (policy) policy.textContent = LIFECYCLE_POLICY.expiryAction;

  // 도구 카드는 ADDONS에서 만든다. 여러 개 선택할 수 있고 "없음"은 나머지와 함께 선택되지 않는다.
  document.getElementById('mw-choices').innerHTML = ADDON_CATEGORIES.map(function (c) {
    const ids = Object.keys(ADDONS).filter(function (id) { return ADDONS[id].cat === c.id; });
    if (!ids.length) return '';
    return '<div class="mw__group"><div class="mw__h">' + esc(c.name) + '</div><div class="choices">' +
      ids.map(function (id) {
        return '<label class="choice"><input type="checkbox" name="middleware" value="' + id + '">' +
          '<span class="choice__body">' + iconHtml(id, 'choice__logo') + '<strong>' + esc(ADDONS[id].name.replace(/ [\d.]+$/, '')) +
          '</strong><small>' + esc(ADDONS[id].desc) + '</small><small class="cost" data-hint="mw:' + id + '"></small></span></label>';
      }).join('') + '</div></div>';
  }).join('') +
    '<div class="mw__group"><div class="choices"><label class="choice"><input type="checkbox" name="middleware" value="none">' +
    '<span class="choice__body"><strong>없음</strong><small>OS만 사용합니다</small><small class="cost" data-hint="mw:none"></small></span></label></div></div>';
  const extra = document.querySelector('[data-policy="extra-ram"]');
  if (extra) extra.textContent = ADDON_EXTRA_RAM;

  function readAnswers() {
    const answers = {};
    SURVEY_STEPS.forEach(function (s) {
      if (s.key === 'middleware') {
        const on = Array.prototype.map.call(form.querySelectorAll('input[name="middleware"]:checked'),
          function (i) { return i.value; });
        answers.middleware = on.length ? on : null;
        return;
      }
      const c = form.querySelector('input[name="' + s.key + '"]:checked');
      answers[s.key] = c ? c.value : null;
    });
    return answers;
  }
  function setHint(key, text, over) {
    const el = form.querySelector('[data-hint="' + key + '"]');
    if (!el) return;
    el.textContent = text;
    el.classList.toggle('cost--over', !!over);
  }

  function updateHints(s) {
    ['web', 'model', 'practice'].forEach(function (v) {
      const f = FLAVORS[SURVEY_RULES.purpose[v]];
      setHint('purpose:' + v, '권장 ' + f.name + ' · ' + fmt(f.costPerDay) + '/일');
    });
    ['light', 'normal', 'heavy'].forEach(function (v) {
      const f = FLAVORS[SURVEY_RULES.scale[v]];
      setHint('scale:' + v, '권장 ' + f.name + ' · ' + fmt(f.costPerDay) + '/일');
    });
    OS_LIST.forEach(function (o) { setHint('os:' + o.id, '요금 차이 없음'); });
    Object.keys(ADDONS).forEach(function (id) {
      setHint('mw:' + id, '+' + fmt(ADDONS[id].costPerDay) + '/일 · 권장 RAM ' + ADDONS[id].minRam + 'GB');
    });
    setHint('mw:none', '추가 비용 없음');
    [1, 7, 30].forEach(function (d) {
      const total = s.dailyCost * d;
      setHint('ttl:' + d, fmt(total) + ' 크레딧' + (total > s.remaining ? ' (한도 초과)' : ''), total > s.remaining);
    });
  }

  function renderCost(answers, sim, s) {
    const el = document.getElementById('survey-cost');
    const any = SURVEY_STEPS.some(function (x) { return answers[x.key]; });
    el.hidden = !any;
    if (!any) return;
    const ratio = s.remaining > 0 ? Math.round((s.totalCost / s.remaining) * 100) : 999;
    const maxDays = Math.floor(s.remaining / s.dailyCost);
    let html = billRow('하루 요금', fmt(s.dailyCost) + '/일') +
      billRow('× ' + sim.state.ttl + '일' + (sim.assumedTtl ? ' (기본값)' : ''), '', 'bill__row--mult') +
      billRow('총액', fmt(s.totalCost) + ' 크레딧', 'bill__row--total') +
      '<div class="meter-label"><span>내 잔여 크레딧의</span><span>' + ratio + '%</span></div>' +
      '<div class="meter' + (ratio > 100 ? ' meter--over' : ratio > 70 ? ' meter--warn' : '') +
      '"><span style="width:' + Math.min(100, ratio) + '%"></span></div>';
    const guide = s.warnings.slice();
    if (s.blocked) {
      guide.push({ level: 'block', msg: maxDays >= 1
        ? '이대로는 생성할 수 없습니다. 기간을 ' + maxDays + '일 이하로 줄이거나 규모를 낮추세요'
        : '하루 요금이 잔여 크레딧을 넘어 생성할 수 없습니다. 규모를 낮추세요' });
    }
    el.innerHTML = html + alertsHtml(guide);
  }

  function refresh() {
    const answers = readAnswers();
    const sim = simulateSurvey(answers, state);
    const s = computeSummary(sim.state);
    updateHints(s);
    renderSurveyPreview(answers, sim);
    renderCost(answers, sim, s);
    nextBtn.disabled = !answers[SURVEY_STEPS[step].key];
    const picked = surveyAddons(answers);
    document.getElementById('mw-chips').innerHTML = picked.map(function (id) {
      return '<button type="button" class="mw-chip" data-action="mw-remove" data-id="' + id + '" aria-label="' +
        esc(ADDONS[id].name) + ' 선택 해제">' + esc(ADDONS[id].name.replace(/ [\d.]+$/, '')) + ' <span aria-hidden="true">&times;</span></button>';
    }).join('');
    // 좁은 화면에서는 프리뷰가 질문 아래로 내려가므로, 현재 구성을 하단 바로 요약한다.
    const mbar = document.getElementById('mbar');
    const any = SURVEY_STEPS.some(function (x) { return answers[x.key]; });
    mbar.hidden = !any;
    if (any) mbar.innerHTML = '<span>' + esc(sim.state.flavor ? FLAVORS[sim.state.flavor].name : '') + ' \u00B7 하루 <b>' + fmt(s.dailyCost) +
      '</b></span><span>총 <b>' + fmt(s.totalCost) + '</b> 크레딧 \u25B2</span>';
    document.getElementById('mw-sum').textContent = picked.length
      ? '선택한 도구 ' + picked.length + '개 · 하루 +' + fmt(picked.reduce(function (n, id) { return n + ADDONS[id].costPerDay; }, 0)) +
        ' 크레딧' + (picked.length > 1 ? ' · 함께 쓰려면 RAM ' + requiredRam(picked) + 'GB 이상' : '')
      : (answers.middleware ? '도구 없이 OS만 설치합니다.' : '');
  }

  function show(i, focus) {
    step = i;
    sections.forEach(function (sec, k) { sec.hidden = k !== i; });
    document.getElementById('step-label').textContent = (i + 1) + ' / ' + SURVEY_STEPS.length;
    document.getElementById('step-name').textContent = SURVEY_STEPS[i].label;
    document.getElementById('step-bar').style.width = Math.round(((i + 1) / SURVEY_STEPS.length) * 100) + '%';
    prevBtn.disabled = i === 0;
    nextBtn.textContent = i === last ? '확인 화면으로' : '다음';
    refresh();
    if (focus) {
      const t = sections[i].querySelector('input:checked') || sections[i].querySelector('input');
      if (t) t.focus();
    }
  }

  form.addEventListener('change', function (e) {
    const t = e.target;
    if (t.name === 'middleware' && t.checked) {
      Array.prototype.forEach.call(form.querySelectorAll('input[name="middleware"]'), function (i) {
        if (i !== t && (t.value === 'none' || i.value === 'none')) i.checked = false;
      });
    }
    refresh();
  });

  form.addEventListener('click', function (e) {
    if (e.target.closest('[data-action="prev"]') && step > 0) show(step - 1, true);
    const rm = e.target.closest('[data-action="mw-remove"]');
    if (rm) {
      form.querySelector('input[name="middleware"][value="' + rm.dataset.id + '"]').checked = false;
      refresh();
    }
    if (e.target.closest('[data-action="to-preview"]')) document.getElementById('preview').scrollIntoView({ behavior: 'smooth', block: 'start' });
  });

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    const answers = readAnswers();
    if (!answers[SURVEY_STEPS[step].key]) return;
    if (step < last) { show(step + 1, true); return; }
    const rec = recommendFlavor(answers);
    state.surveyAnswers = answers;
    state.os = rec.os;
    state.flavor = rec.flavor;
    state.addons = rec.addons;
    state.disk = rec.disk;
    state.ttl = rec.ttl;
    state.templateName = null;
    state.cloneFrom = null;
    state.resourceName = '';
    saveState(state);
    location.href = 'result.html';
  });

  show(0, false);
}

/* ---------- 공용: 청구서 / 프리뷰 / 경고 ---------- */

let previewShown = null;   // 직전 프리뷰에 그려진 애드온 id (새 블록에만 등장 애니메이션을 주기 위함)

function billRow(label, value, cls) {
  return '<div class="bill__row' + (cls ? ' ' + cls : '') + '"><span>' + esc(label) +
         '</span><span>' + esc(value) + '</span></div>';
}

function renderBill(state) {
  const s = computeSummary(state);
  let html = billRow('기본 요금 (' + s.flavor.name + ')', fmt(s.flavor.costPerDay) + '/일');
  s.addons.forEach(function (a) { html += billRow(a.name, fmt(a.costPerDay) + '/일'); });
  if (s.diskCost > 0) html += billRow('디스크 ' + s.disk + 'GB', fmt(s.diskCost) + '/일');
  html += billRow('일일 합계', fmt(s.dailyCost) + '/일', 'bill__row--sum');
  html += billRow('× ' + state.ttl + '일', '', 'bill__row--mult');
  html += billRow('총액', fmt(s.totalCost) + ' 크레딧', 'bill__row--total');
  html += '<div class="bill__note">잔여 크레딧 ' + fmt(s.remaining) + (s.blocked ? '' : ' \u2192 생성 후 ' + fmt(s.remaining - s.totalCost)) + '</div>';
  const el = document.getElementById('bill');
  el.className = s.blocked ? 'bill--blocked' : '';
  el.innerHTML = html;
}

function renderPreview(state) {
  const flavor = FLAVORS[state.flavor], os = osById(state.os);
  const first = previewShown === null;
  const blocks = state.addons.map(function (id) {
    const isNew = !first && previewShown.indexOf(id) === -1;
    return '<div class="sw' + (isNew ? ' is-new' : '') + '">' + iconHtml(id, 'sw__logo') +
      '<div><div class="sw__name">' + esc(ADDONS[id].name) + '</div>' +
      '<div class="sw__sub">' + fmt(ADDONS[id].costPerDay) + '/일</div></div></div>';
  }).join('');

  let ram = '';
  if (state.addons.length) {
    const need = requiredRam(state.addons);
    const over = need > flavor.ram;
    ram = '<div class="vm__ram' + (over ? ' vm__ram--over' : '') + '">' +
      '<div class="meter-label" style="margin-top:0"><span>RAM 여유</span><span>권장 ' + need +
      'GB / VM ' + flavor.ram + 'GB</span></div>' +
      '<div class="meter' + (over ? ' meter--over' : '') + '"><span style="width:' +
      Math.min(100, Math.round(need / flavor.ram * 100)) + '%"></span></div>' +
      '<div class="vm__ram-note">' + (over ? 'RAM이 부족할 수 있습니다. 사양을 올려 주세요.' : '설치한 SW를 돌리기에 충분합니다.') +
      '</div></div>';
  }

  document.getElementById('preview').innerHTML =
    '<div class="vm">' +
      '<div class="vm__head">' + iconHtml(state.os, 'vm__logo') +
        '<div class="vm__meta"><div class="vm__os">' + esc(os.name) + '</div>' +
        '<div class="vm__slug">' + esc(osSlug(state.os)) + '</div></div>' +
        '<div class="vm__chips"><span class="chip">' + flavor.cpu + ' Core</span>' +
        '<span class="chip">' + flavor.ram + 'GB RAM</span><span class="chip">' + (state.disk || DISK_INCLUDED_GB) + 'GB SSD</span></div></div>' +
      '<div class="vm__body"><div class="vm__label">설치되는 소프트웨어</div>' +
        (blocks ? '<div class="vm__addons">' + blocks + '</div>'
                : '<div class="vm__empty">추가 SW 없음 (OS만 설치)</div>') +
        ram + '</div></div>';
  previewShown = state.addons.slice();
}

function renderGuardrails(state) {
  const s = computeSummary(state);
  const el = document.getElementById('guardrails');
  el.innerHTML = s.warnings.length ? alertsHtml(s.warnings) : '<p class="empty">경고 없음</p>';
}

/* ---------- builder ---------- */

function initBuilderPage() {
  const form = document.getElementById('builder-form');
  const state = loadState();

  // 폼 컨트롤은 최초 1회만 생성한다. 이후에는 checked/value만 동기화한다.
  document.getElementById('os-select').innerHTML = OS_LIST.map(function (o) {
    return '<option value="' + o.id + '">' + esc(o.name) + '</option>';
  }).join('');

  document.getElementById('flavor-choices').innerHTML = FLAVOR_RANK.map(function (id) {
    const f = FLAVORS[id];
    return '<label class="choice"><input type="radio" name="flavor" value="' + id + '">' +
      '<span class="choice__body"><strong>' + f.name + '</strong>' +
      '<small>' + esc(f.label) + '</small>' +
      '<small class="meta">' + specText(f) + '</small>' +
      '<small class="meta">' + fmt(f.costPerDay) + '/일</small></span></label>';
  }).join('');

  document.getElementById('addon-choices').innerHTML = Object.keys(ADDONS).map(function (id) {
    const a = ADDONS[id];
    return '<label class="choice"><input type="checkbox" name="addons" value="' + id + '">' +
      '<span class="choice__body"><strong>' + esc(a.name) + '</strong>' +
      '<small class="meta">권장 RAM ' + a.minRam + 'GB 이상</small>' +
      '<small class="meta">' + fmt(a.costPerDay) + '/일</small></span></label>';
  }).join('');

  document.getElementById('disk-choices').innerHTML = DISK_OPTIONS.map(function (gb) {
    return '<label class="choice"><input type="radio" name="disk" value="' + gb + '">' +
      '<span class="choice__body"><strong>' + (gb >= 1000 ? '1TB' : gb + 'GB') + '</strong>' +
      '<small class="meta">' + (diskCostOf(gb) ? '+' + fmt(diskCostOf(gb)) + '/일' : '기본 포함') + '</small></span></label>';
  }).join('');
  document.getElementById('disk-note').textContent = '기본 ' + DISK_INCLUDED_GB + 'GB는 사양 요금에 포함됩니다. 초과분은 1GB당 하루 ' +
    DISK_COST_PER_GB_DAY + ' 크레딧이며, 만든 뒤에는 늘리기만 할 수 있습니다.';

  document.getElementById('ttl-choices').innerHTML = [1, 7, 30].map(function (d) {
    return '<label class="choice"><input type="radio" name="ttl" value="' + d + '">' +
      '<span class="choice__body"><strong>' + d + '일</strong>' +
      '<small class="meta" data-ttl-cost="' + d + '"></small></span></label>';
  }).join('');

  function syncFormControls(st) {
    form.elements.os.value = st.os;
    if (document.activeElement !== form.elements.rname) form.elements.rname.value = st.resourceName || '';
    Array.prototype.forEach.call(form.querySelectorAll('input[name="flavor"]'), function (i) {
      i.checked = i.value === st.flavor;
    });
    Array.prototype.forEach.call(form.querySelectorAll('input[name="addons"]'), function (i) {
      i.checked = st.addons.indexOf(i.value) !== -1;
    });
    Array.prototype.forEach.call(form.querySelectorAll('input[name="ttl"]'), function (i) {
      i.checked = i.value === String(st.ttl);
    });
    Array.prototype.forEach.call(form.querySelectorAll('input[name="disk"]'), function (i) {
      i.checked = i.value === String(st.disk || DISK_INCLUDED_GB);
    });
    // 기한 카드에 현재 사양 기준 총액을 보여 준다.
    const daily = computeSummary(st).dailyCost;
    Array.prototype.forEach.call(form.querySelectorAll('[data-ttl-cost]'), function (el) {
      el.textContent = fmt(daily * Number(el.dataset.ttlCost)) + ' 크레딧';
    });
    const notice = document.getElementById('builder-notice');
    notice.hidden = !(st.templateName || st.cloneFrom);
    notice.textContent = st.cloneFrom ? '"' + st.cloneFrom + '" 서버와 같은 구성을 불러왔습니다. 이름과 사용 기간을 확인하세요.'
      : st.templateName ? '저장한 템플릿 "' + st.templateName + '"을 불러왔습니다.' : '';
  }

  initRepoFields(state);
  initProjectField(state);

  function render() {
    renderBill(state);
    renderPreview(state);
    renderGuardrails(state);
    syncFormControls(state);
    saveState(state);
  }

  form.addEventListener('change', function (e) {
    const t = e.target;
    if (t.name === 'rname') { state.resourceName = t.value.trim(); saveState(state); return; }
    if (t.name === 'os') state.os = t.value;
    else if (t.name === 'flavor') state.flavor = t.value;
    else if (t.name === 'ttl') state.ttl = Number(t.value);
    else if (t.name === 'disk') state.disk = Number(t.value);
    else if (t.name === 'addons') {
      state.addons = Object.keys(ADDONS).filter(function (id) {
        return form.querySelector('input[name="addons"][value="' + id + '"]').checked;
      });
    } else return;
    state.templateName = null;
    state.cloneFrom = null;
    render();
  });

  form.addEventListener('click', function (e) {
    if (e.target.closest('[data-action="save-template"]')) saveTemplateDialog(state);
  });

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    state.resourceName = form.elements.rname.value.trim();
    requestCreate(state);
  });

  render();
}

/* ---------- result ---------- */

function initResultPage() {
  const state = loadState();
  const s = computeSummary(state);
  const answers = state.surveyAnswers;

  const rows = [
    ['운영체제', osById(state.os).name],
    ['사양', s.flavor.name + ' (' + specText(s.flavor) + ')'],
    ['미들웨어', addonNames(state.addons)],
    ['디스크', s.disk + 'GB SSD' + (s.diskCost ? ' (+' + fmt(s.diskCost) + '/일)' : '')],
    ['사용 기한', state.ttl + '일'],
    ['일일 요금', fmt(s.dailyCost) + ' 크레딧']
  ];
  let html = rows.map(function (r) {
    return '<div class="kv__row"><dt>' + esc(r[0]) + '</dt><dd>' + esc(r[1]) + '</dd></div>';
  }).join('');
  html += '<div class="kv__row kv__row--strong' + (s.blocked ? ' kv__row--danger' : '') +
          '"><dt>총액</dt><dd>' + fmt(s.totalCost) + ' 크레딧</dd></div>';
  document.getElementById('receipt').innerHTML = html;

  document.getElementById('receipt-note').innerHTML = alertsHtml(s.warnings);
  initRepoFields(state);
  initProjectField(state);
  const nameInput = document.getElementById('rname-result');
  nameInput.value = state.resourceName || suggestName(state);
  document.getElementById('owner-line').textContent =
    '소유자: ' + currentUser(state).name + ' \u00B7 ' + currentUser(state).team + ' (' + CURRENT_USER.id + ')';
  renderPreview(state);

  const reasons = document.getElementById('reasons');
  if (!answers) {
    reasons.innerHTML = state.templateName
      ? '<p>저장한 템플릿 "' + esc(state.templateName) + '"의 구성을 그대로 불러왔습니다.</p>'
      : '<p>빠른 시작이나 직접 설정으로 만든 구성이라 추천 이유는 표시되지 않습니다. 구성은 "세부 조정하기"에서 바꿀 수 있습니다.</p>';
  } else {
    const rec = recommendFlavor(answers);
    const pName = FLAVORS[rec.purposeFlavor].name, sName = FLAVORS[rec.scaleFlavor].name;
    const items = [
      '목적이 "' + SURVEY_LABELS.purpose[answers.purpose] + '"이므로 ' + pName + ' 사양이 적합합니다.',
      '규모가 "' + SURVEY_LABELS.scale[answers.scale] + '"이므로 ' + sName + ' 사양이 적합합니다.'
    ];
    if (rec.conflict) {
      items.push('두 답변이 서로 다른 사양을 가리켜 더 높은 ' + FLAVORS[rec.baseFlavor].name +
                 ' 사양을 선택했습니다. 자원 부족으로 작업이 실패하는 것보다 낫기 때문입니다.');
    } else {
      items.push('두 답변이 같은 사양을 가리켜 ' + FLAVORS[rec.baseFlavor].name + ' 사양을 선택했습니다.');
    }
    if (answers.os) items.push('운영체제는 ' + osById(answers.os).name + '로 선택했습니다.');
    if (rec.raised) {
      items.push('선택한 도구를 함께 쓰려면 RAM ' + rec.needRam + 'GB 이상이 필요해 사양을 ' +
                 FLAVORS[rec.flavor].name + '(으)로 올렸습니다.');
    }
    if (rec.disk > DISK_INCLUDED_GB) items.push('작업 규모를 고려해 디스크를 ' + rec.disk + 'GB로 추천했습니다. 만든 뒤에도 늘릴 수 있습니다.');
    items.push('도구는 "' + addonNames(rec.addons) + '", 사용 기한은 ' + answers.ttl + '일로 반영했습니다.');
    reasons.innerHTML = '<ul class="steps">' + items.map(function (t) {
      return '<li>' + esc(t) + '</li>';
    }).join('') + '</ul>';
  }

  document.getElementById('result-card').addEventListener('click', function (e) {
    if (e.target.closest('[data-action="create"]')) {
      state.resourceName = nameInput.value.trim();   // 비워 두면 자동 이름이 붙는다
      requestCreate(state);
    }
    else if (e.target.closest('[data-action="save-template"]')) {
      state.resourceName = nameInput.value.trim();
      saveTemplateDialog(state);
    }
  });
}

/* ---------- error ---------- */

function initErrorPage() {
  const state = loadState();
  const s = computeSummary(state);
  const need = s.totalCost, have = s.remaining, diff = need - have;

  document.getElementById('error-title').textContent = s.blocked
    ? '요청한 환경이 배정 한도를 넘었습니다'
    : '현재 설정은 배정 한도 이내입니다';

  const blocks = s.warnings.filter(function (w) { return w.level === 'block'; });
  document.getElementById('error-reason').textContent = blocks.length
    ? blocks.map(function (w) { return w.msg; }).join(' / ')
    : '차단 사유가 없습니다. 설정 화면에서 환경을 생성할 수 있습니다.';

  document.getElementById('error-table').innerHTML =
    '<div class="kv__row"><dt>필요 크레딧</dt><dd>' + fmt(need) + '</dd></div>' +
    '<div class="kv__row"><dt>보유 크레딧</dt><dd>' + fmt(have) + '</dd></div>' +
    '<div class="kv__row kv__row--strong' + (diff > 0 ? ' kv__row--danger' : '') +
    '"><dt>차액</dt><dd>' + (diff > 0 ? '-' : '') + fmt(Math.abs(diff)) + '</dd></div>';

  // 해결 방법: 실제 계산 결과로 안내한다.
  const maxDays = Math.floor(have / s.dailyCost);
  const ttlText = maxDays >= 1
    ? '사용 기한을 ' + maxDays + '일 이하로 줄이면 ' + fmt(s.dailyCost * maxDays) +
      ' 크레딧으로 생성할 수 있습니다. (현재 ' + state.ttl + '일)'
    : '현재 구성은 하루 요금(' + fmt(s.dailyCost) + ')이 잔여 크레딧을 넘어 기한 단축만으로는 해결되지 않습니다.';

  let downText = '더 낮은 사양이 없습니다.';
  const idx = FLAVOR_RANK.indexOf(state.flavor);
  for (let i = idx - 1; i >= 0; i--) {
    const sim = computeSummary(Object.assign({}, state, { flavor: FLAVOR_RANK[i] }));
    if (!sim.blocked) {
      downText = '사양을 ' + sim.flavor.name + ' 사양으로 낮추면 ' + state.ttl + '일 기준 ' +
                 fmt(sim.totalCost) + ' 크레딧으로 생성할 수 있습니다.';
      break;
    }
  }
  if (idx > 0 && downText === '더 낮은 사양이 없습니다.') {
    downText = '더 낮은 사양으로 바꿔도 현재 기한으로는 한도를 넘습니다. 기한과 함께 조정하세요.';
  }
  document.getElementById('solutions').innerHTML =
    '<li><strong>사용 기한 단축.</strong> ' + esc(ttlText) + '</li>' +
    '<li><strong>사양 하향.</strong> ' + esc(downText) + '</li>';

  const approveBtn = document.querySelector('[data-action="approve"]');
  function markRequested() {
    approveBtn.textContent = '승인 요청 접수됨 (대기 중)';
    approveBtn.disabled = true;
  }
  // 같은 구성으로 이미 요청한 적이 있으면 처음부터 접수 상태로 보여준다.
  if (findApproval(state, state)) markRequested();

  document.getElementById('error-card').addEventListener('click', function (e) {
    const btn = e.target.closest('[data-action="approve"]');
    if (!btn) return;
    requestApproval(state);
    saveState(state);
    markRequested();
    const note = document.createElement('p');
    note.className = 'hint';
    note.textContent = '요청이 접수되었습니다. 대시보드 상단에서 진행 상황을 확인하세요.';
    btn.parentNode.appendChild(note);
  });
}

/* ---------- dashboard ---------- */

const STATUS_LABEL = { running: '실행 중', stopped: '중지됨', restarting: '재시작 중', expiring: '만료 임박' };

// 상태 알약 배지와 남은 기한 색 (24시간 미만 빨강, 72시간 미만 주황)
// 서버 위생 점수 배지 (4점 초록, 3점 파랑, 2점 주황, 그 이하 빨강)
function scoreBadge(r, full) {
  const h = hygieneScore(r);
  return '<span class="score score--' + h.score + '" title="서버 위생 점수: ' + h.checks.filter(function (c) { return !c.ok; }).map(function (c) { return c.label + ' 필요'; }).join(', ') + '">' +
    (full ? '위생 ' : '') + h.score + '/' + h.total + '</span>';
}

function pillHtml(status) { return '<span class="pill pill--' + status + '">' + STATUS_LABEL[status] + '</span>'; }
function leftClass(hours) {
  return hours < LIFECYCLE_POLICY.warnBeforeHours ? 'left--danger' : hours < 72 ? 'left--warn' : '';
}

function isMine(r) { return r.owner === CURRENT_USER.id; }
function myPerm(r) { return permissionOf(r, CURRENT_USER.id); }

function timeText(ms) {
  return new Date(ms).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
}

// 확인이 필요한 작업용 공용 모달. rows: [[라벨, 값, 추가 클래스]]
function actionDialog(o, onOk) {
  const rows = (o.rows || []).map(function (r) {
    return '<div class="kv__row' + (r[2] ? ' ' + r[2] : '') + '"><dt>' + esc(r[0]) + '</dt><dd>' +
           esc(r[1]) + '</dd></div>';
  }).join('');
  openDialog(
    '<h2>' + esc(o.title) + '</h2><p>' + esc(o.text) + '</p>' +
    (rows ? '<div class="diff">' + rows + '</div>' : '') + alertsHtml(o.alerts || []) +
    '<div class="actions"><button type="button" class="btn btn--secondary" data-action="cancel">취소</button>' +
    '<button type="button" class="btn' + (o.danger ? ' btn--danger-fill' : '') + '" data-action="ok"' +
    (o.disabled ? ' disabled' : '') + '>' + esc(o.okLabel) + '</button></div>',
    function (action) { if (action === 'ok') onOk(); });
}

// 작업 열: 행에는 핵심 버튼만 둔다. 나머지 작업은 상세 패널에 있다.
function actionButtons(r) {
  const perm = myPerm(r);
  const id = esc(r.id);
  if (perm === 'none') return '<div class="no-perm">권한 없음 (소유자 ' + esc(r.ownerName) + ')</div>';
  if (perm === 'use') return '<div class="no-perm">사용 권한: 접속 정보만 볼 수 있습니다</div>';
  return '<div class="actions-row"><button class="btn btn--sm" data-action="extend" data-id="' + id + '">기한 연장</button>' +
    '<button class="btn btn--sm btn--secondary" data-action="detail" data-id="' + id + '">상세</button></div>';
}

// 행 안의 자동 중지 표시. 예약을 걸 수 있는 서버에는 바로 설정할 수 있는 버튼을 준다.
// 상태 열의 보조 배지: 배포 중이거나 마지막 배포가 실패했을 때만 표시한다 (성공은 조용히)
function deployBadge(r) {
  if (!r.repo || !canDo(r, CURRENT_USER.id, 'deployView')) return '';
  if (runningDeploy(r)) return '<div class="badge-row"><span class="pill pill--dep-run">배포 중</span></div>';
  const d = lastDeploy(r);
  return d && d.status === 'failed' ? '<div class="badge-row"><span class="pill pill--dep-fail">배포 실패</span></div>' : '';
}

function schedHtml(r) {
  const mayEdit = canDo(r, CURRENT_USER.id, 'schedule');
  const on = r.schedule && r.schedule.enabled;
  if (on) {
    return mayEdit
      ? '<button type="button" class="sched-btn" data-action="schedule" data-id="' + esc(r.id) + '" title="자동 중지 변경">자동 중지 ' + esc(scheduleText(r.schedule)) + '</button>'
      : '<div class="sched">자동 중지 ' + esc(scheduleText(r.schedule)) + '</div>';
  }
  return mayEdit && r.status !== 'stopped'
    ? '<button type="button" class="sched-btn sched-btn--add" data-action="schedule" data-id="' + esc(r.id) + '">+ 자동 중지 설정</button>' : '';
}

function rowHtml(r, ctx) {
  const f = FLAVORS[r.flavor];
  const status = resourceStatus(r);
  const stopped = status === 'stopped';
  const urgent = r.ttlLeftHours < LIFECYCLE_POLICY.warnBeforeHours;
  const high = r.usage > 85;
  const daily = resourceDailyCost(r);
  const team = r.members.length
    ? '<span class="badge-team" title="' + esc(r.members.map(function (m) {
        return m.name + ' (' + MEMBER_ROLES[m.role].name + ')'; }).join(', ')) + '">+' + r.members.length + '</span>' : '';
  const tags = r.tags.length
    ? '<div class="tags">' + r.tags.map(function (t) {
        return '<button type="button" class="tag' + (t === ctx.tag ? ' tag--on' : '') +
          '" data-action="tag-filter" data-tag="' + esc(t) + '">' + esc(t) + '</button>'; }).join('') + '</div>' : '';
  return '<tr class="row--click' + (urgent ? ' row--expiring' : '') + '" data-id="' + esc(r.id) + '">' +
    '<td>' + pillHtml(status) + deployBadge(r) + '</td>' +
    '<td><button type="button" class="res-link" data-action="detail" data-id="' + esc(r.id) + '" title="상세 보기">' +
      esc(r.name) + '</button><div class="res-id">' + esc(r.id) + ' ' + scoreBadge(r) + '</div>' +
      (r.project ? '<div class="proj-chip">' + esc(r.project) + '</div>' : '') +
      '<div class="owner">' + esc(r.ownerName) + team + ' · ' + esc(r.team) + '</div>' + tags +
      schedHtml(r) + '</td>' +
    '<td class="spec"><div>' + f.name + ' <span class="mono">(' + specText(f) + ')</span></div>' +
      '<div class="sub">' + esc(osById(r.os).name) + ' / ' + esc(addonNames(r.addons)) + ' / ' + r.disk + 'GB SSD</div></td>' +
    '<td>' + (stopped ? '<span class="na">—</span>'
      : '<div class="gauge' + (high ? ' gauge--high' : '') + '"><span style="width:' + r.usage + '%"></span></div>' +
        '<div class="gauge-label">' + r.usage + '%</div>') + '</td>' +
    '<td class="mono left-time ' + leftClass(r.ttlLeftHours) + '">' + formatLeft(r.ttlLeftHours) + '</td>' +
    '<td class="mono">' + fmt(daily) + (stopped ? ' <span class="cost-sub">(중지)</span>' : '') + '</td>' +
    '<td>' + actionButtons(r) + '</td></tr>';
}

// 필터(내 자원 / 우리 팀 / 연구실 전체) -> 검색어 / 태그 -> 정렬
function visibleRows(state, view) {
  const me = CURRENT_USER.id;
  const base = view.filter === 'mine' ? state.resources.filter(isMine)
    : view.filter === 'team' ? state.resources.filter(function (r) { return isTeamResource(r, me); })
    : state.resources.slice();
  const q = view.query.trim().toLowerCase();
  const rows = base.filter(function (r) {
    const okQ = !q || r.name.toLowerCase().indexOf(q) !== -1 || r.id.toLowerCase().indexOf(q) !== -1 ||
                r.ownerName.toLowerCase().indexOf(q) !== -1 || (r.project || '').toLowerCase().indexOf(q) !== -1;
    return okQ && (!view.tag || r.tags.indexOf(view.tag) !== -1);
  });
  const num = function (r) { return parseInt(r.id.replace(/\D/g, ''), 10) || 0; };
  const by = {
    expiry: function (a, b) { return a.ttlLeftHours - b.ttlLeftHours; },
    name:   function (a, b) { return a.name.localeCompare(b.name, 'ko'); },
    cost:   function (a, b) { return resourceDailyCost(b) - resourceDailyCost(a); },
    recent: function (a, b) { return num(b) - num(a); }
  };
  rows.sort(by[view.sort] || by.expiry);
  return { baseCount: base.length, rows: rows };
}

let approvalTimer = null;
let deployTimer = null;
let detailHook = null;   // 열려 있는 상세 패널을 다시 그리는 함수 (initDashboardPage가 등록)
let restartTimer = null;

function renderTrash(state) {
  const items = state.trash.filter(function (t) { return t.owner === CURRENT_USER.id; });
  const sec = document.getElementById('trash-section');
  sec.hidden = items.length === 0;
  document.getElementById('trash-summary').textContent = '휴지통 (' + items.length + ')';
  const now = Date.now();
  document.getElementById('trash-list').innerHTML = items.map(function (t) {
    const d = new Date(t.deletedAt).toLocaleDateString('ko-KR', { month: 'numeric', day: 'numeric' });
    return '<div class="trash__row"><div><strong>' + esc(t.name) + '</strong> <span class="res-id">' + esc(t.id) +
      '</span><div class="trash__meta">' + esc(d) + ' 반납 · 복구할 때 ' + fmt(restoreCost(t)) + ' 크레딧이 다시 차감됩니다</div></div>' +
      '<div class="trash__left">' + trashDaysLeft(t, now) + '일 뒤 삭제</div>' +
      '<div class="trash__actions"><button type="button" class="btn btn--sm" data-action="trash-restore" data-id="' + esc(t.id) + '">복구</button>' +
      '<button type="button" class="btn btn--sm btn--danger" data-action="trash-purge" data-id="' + esc(t.id) + '">영구 삭제</button></div></div>';
  }).join('');
}

function renderDashboard(state, view) {
  const mine = state.resources.filter(isMine);
  const count = function (s) { return mine.filter(function (r) { return resourceStatus(r) === s; }).length; };
  const daily = mine.reduce(function (sum, r) { return sum + resourceDailyCost(r); }, 0);

  document.getElementById('stat-running').textContent = count('running') + count('restarting');
  document.getElementById('stat-stopped').textContent = count('stopped');
  document.getElementById('stat-expiring').textContent = count('expiring');
  document.getElementById('stat-daily').textContent = fmt(daily);
  const avg = hygieneAverage(mine);
  document.getElementById('stat-hygiene').textContent = avg === null ? '\u2014' : avg + '/4';
  const fc = creditForecast(state);
  document.getElementById('stat-forecast').textContent =
    (fc.dailyPct !== null && daily > 0 ? '(잔액의 ' + fc.dailyPct + '%)' : '') +
    (fc.days !== null ? ' \u00B7 이대로면 약 ' + fmt(fc.days) + '일 더' : '');

  // (a) 만료 임박 배너: 내가 연장할 수 있는(소유자/관리 권한) 서버 중 24시간 미만인 것
  const urgent = state.resources.filter(function (r) {
    return canDo(r, CURRENT_USER.id, 'extend') && r.ttlLeftHours < LIFECYCLE_POLICY.warnBeforeHours;
  }).sort(function (a, b) { return a.ttlLeftHours - b.ttlLeftHours; });
  const banner = document.getElementById('expiry-banner');
  banner.hidden = !urgent.length;
  if (urgent.length) {
    const u = urgent[0];
    banner.innerHTML =
      '<div class="banner__text"><div>' + esc(u.name) + '의 사용 기한이 ' + u.ttlLeftHours + '시간 남았습니다. ' +
      esc(LIFECYCLE_POLICY.expiryAction) + '</div>' +
      (urgent.length > 1 ? '<div class="banner__more">그 외 ' + (urgent.length - 1) + '건도 24시간 이내에 만료됩니다.</div>' : '') +
      '</div><button type="button" class="btn btn--sm" data-action="extend" data-id="' + esc(u.id) + '">기한 연장</button>';
  }

  // (a-2) 자동 중지 안내: 예약 없이 켜져 있는 서버가 있을 때 (닫으면 다시 묻지 않는다)
  const un = unscheduledServers(state);
  const sb = document.getElementById('sched-banner');
  sb.hidden = !un.length || !!state.hints.schedBannerDismissed;
  if (!sb.hidden) {
    sb.innerHTML = '<div class="banner__text"><strong>밤새 켜져 있는 서버가 ' + un.length + '대 있어요.</strong> 자동 중지를 예약하면 하루 약 ' +
      fmt(scheduleTipSaving(state)) + ' 크레딧을 아낄 수 있어요(예상).</div>' +
      '<div class="banner__btns"><button type="button" class="btn btn--sm" data-action="sched-look" data-id="' + esc(un[0].id) + '">설정하러 가기</button>' +
      '<button type="button" class="btn btn--sm btn--secondary" data-action="sched-dismiss">닫기</button></div>';
  }

  // (b) 승인 요청 (승인 대기 / 승인됨)
  const apr = state.approvals.filter(function (a) { return a.status === 'pending' || a.status === 'approved'; });
  const aprEl = document.getElementById('approval-section');
  aprEl.hidden = !apr.length;
  aprEl.innerHTML = apr.map(function (a) {
    const cfg = FLAVORS[a.flavor].name + (a.addons.length ? ' + ' + addonNames(a.addons) : '') + ' · ' + (a.disk || DISK_INCLUDED_GB) + 'GB · ' + a.ttl + '일';
    const shortfall = Math.max(0, a.totalCost - remainingCredit(state));
    const ok = a.status === 'approved';
    return '<div class="approval"><div><div class="approval__title"><span class="dot dot--' +
      (ok ? 'approved' : 'expiring') + '"></span>' + (ok ? '승인됨' : '승인 대기 중') +
      ' — ' + esc(cfg) + '</div><div class="approval__sub">요청 사양 ' + esc(cfg) +
      ' / 필요 크레딧 ' + fmt(a.totalCost) + ' / 요청 시각 ' + timeText(a.requestedAt) +
      (ok ? ' / 부족분 ' + fmt(shortfall) + ' 크레딧이 추가로 배정됩니다' : '') + '</div></div>' +
      '<div class="approval__actions">' +
      (ok ? '<button type="button" class="btn btn--sm" data-action="approval-create" data-id="' + esc(a.id) + '">지금 생성</button>' : '') +
      '<button type="button" class="btn btn--sm btn--secondary" data-action="approval-dismiss" data-id="' + esc(a.id) +
      '">' + (ok ? '닫기' : '요청 취소') + '</button></div></div>';
  }).join('');

  // 필터 / 정렬 / 태그 바
  Array.prototype.forEach.call(document.querySelectorAll('#owner-filter button'), function (b) {
    b.setAttribute('aria-pressed', String(b.dataset.filter === view.filter));
  });
  // 범위가 '내 자원'이 아닐 때만 요약 기준을 알려 준다.
  const note = document.getElementById('scope-note');
  note.hidden = view.filter === 'mine';
  note.textContent = view.filter === 'team' ? '위 요약은 내 자원 기준입니다. 우리 팀에는 내가 소유자이거나 팀원인 서버가 표시됩니다.'
                                            : '위 요약은 내 자원 기준입니다. 연구실 전체의 서버가 표시됩니다.';
  // 보기 옵션이 기본값과 다르면 개수를 배지로 알린다.
  const changed = view.sort !== 'expiry' ? 1 : 0;
  const cnt = document.getElementById('opt-count');
  cnt.hidden = !changed;
  cnt.textContent = changed;
  const tagBar = document.getElementById('tag-bar');
  tagBar.hidden = !view.tag;
  tagBar.innerHTML = view.tag
    ? '<span class="muted-p" style="margin:0">태그 필터</span><button type="button" class="tag tag--on" data-action="tag-clear">' +
      esc(view.tag) + ' ×</button>' : '';

  // 표 / 검색 결과 없음 / 빈 상태
  const v = visibleRows(state, view);
  const emptyAll = v.baseCount === 0;
  const noMatch = !emptyAll && v.rows.length === 0;
  document.getElementById('table-card').hidden = emptyAll || noMatch || view.mode === 'project';
  const pv = document.getElementById('project-view');
  pv.hidden = emptyAll || noMatch || view.mode !== 'project';
  if (!pv.hidden) pv.innerHTML = projectViewHtml(v.rows);
  Array.prototype.forEach.call(document.querySelectorAll('#view-mode button'), function (b) {
    b.setAttribute('aria-pressed', String(b.dataset.mode === view.mode));
  });
  document.getElementById('empty-state').hidden = !emptyAll;
  if (emptyAll) {
    document.getElementById('empty-title').textContent = view.filter === 'mine' ? '아직 만든 서버가 없어요. 하나 골라 바로 시작해 보세요.' : '이 조건에 해당하는 서버가 없습니다.';
    document.getElementById('empty-presets').innerHTML = view.filter !== 'mine' ? '' : PRESETS.map(function (p) {
      const sm = computeSummary({ os: p.os, flavor: p.flavor, addons: p.addons, disk: p.disk, ttl: p.ttl, creditDelta: state.creditDelta });
      return '<button type="button" class="empty-preset" data-action="preset" data-id="' + p.id + '"><strong>' + esc(p.name) + '</strong>' +
        '<small>' + sm.flavor.name + ' \u00B7 하루 ' + fmt(sm.dailyCost) + '</small></button>';
    }).join('');
  }
  document.getElementById('no-match').hidden = !noMatch;
  document.getElementById('resource-list').innerHTML = v.rows.map(function (r) {
    return rowHtml(r, { tag: view.tag });
  }).join('');

  renderTrash(state);

  // 타이머: 승인 대기 건, 재시작 중인 서버가 있으면 끝나는 시각에 맞춰 다시 그린다.
  clearTimeout(approvalTimer);
  const pending = state.approvals.filter(function (a) { return a.status === 'pending'; });
  if (pending.length) {
    const due = Math.min.apply(null, pending.map(function (a) {
      return a.requestedAt + LIFECYCLE_POLICY.approvalDemoDelaySec * 1000;
    }));
    approvalTimer = setTimeout(function () {
      if (refreshApprovals(state, Date.now())) saveState(state);
      renderDashboard(state, view);
    }, Math.max(100, due - Date.now() + 50));
  }
  clearTimeout(restartTimer);
  const now = Date.now();
  const ends = state.resources.filter(function (r) { return r.restartingUntil && r.restartingUntil > now; })
    .map(function (r) { return r.restartingUntil; });
  if (ends.length) {
    restartTimer = setTimeout(function () { renderDashboard(state, view); },
                              Math.max(100, Math.min.apply(null, ends) - now + 60));
  }
  // 진행 중인 배포가 있으면 1초마다 다시 그려 로그가 흐르게 하고, 끝나면 결과를 확정한다.
  clearTimeout(deployTimer);
  if (state.resources.some(function (r) { return runningDeploy(r); })) {
    deployTimer = setTimeout(function () {
      if (settleDeploys(state, Date.now())) saveState(state);
      renderDashboard(state, view);
      updateBell();
    }, 1000);
  }
  if (detailHook) detailHook();
}

// 프로젝트별로 묶어 보는 카탈로그. rows는 필터, 검색, 태그가 적용된 서버 목록이다.
function projectViewHtml(rows) {
  return groupByProject(rows).map(function (g) {
    const avg = g.avgScore === null ? '' : ' \u00B7 평균 위생 <span class="score score--' + Math.round(g.avgScore) + '">' + g.avgScore + '/4</span>';
    const shown = g.people.slice(0, 6);
    return '<section class="card proj"><div class="proj__head"><h3 class="proj__name">' + (g.name ? esc(g.name) : '프로젝트 없음') + '</h3>' +
      '<div class="proj__meta">서버 ' + g.servers.length + '대 \u00B7 하루 ' + fmt(g.daily) + ' 크레딧' + avg + '</div></div>' +
      '<div class="proj__people"><span class="muted">함께 쓰는 사람</span> ' + shown.map(function (m) {
        return '<span class="chip">' + esc(m.name) + '</span>'; }).join('') +
        (g.people.length > shown.length ? ' <span class="muted">+' + (g.people.length - shown.length) + '</span>' : '') + '</div>' +
      '<div class="proj__servers">' + g.servers.map(function (r) {
        const st = resourceStatus(r);
        // 1줄: 서버 이름(길면 줄바꿈)과 기한 연장 버튼, 2줄: 상태, 위생 점수, 남은 기한
        return '<div class="proj__srv"><button type="button" class="proj__main" data-action="detail" data-id="' + esc(r.id) + '">' +
          '<strong>' + esc(r.name) + '</strong> <span class="res-id">' + esc(r.id) + '</span></button>' +
          (canDo(r, CURRENT_USER.id, 'extend') ? '<button type="button" class="btn btn--sm proj__extend" data-action="extend" data-id="' + esc(r.id) + '">기한 연장</button>' : '') +
          '<div class="proj__info">' + pillHtml(st) + scoreBadge(r) + '<span class="mono proj__left ' + leftClass(r.ttlLeftHours) + '">남은 기한 ' + formatLeft(r.ttlLeftHours) + '</span></div></div>';
      }).join('') + '</div></section>';
  }).join('');
}

// 오른쪽 상세 패널 내용. 작업 버튼은 표의 버튼과 같은 data-action을 쓰므로 같은 핸들러가 처리한다.
let detailTab = 'overview';
const DETAIL_TABS = [['overview', '개요'], ['deploy', '배포'], ['monitor', '모니터링'], ['team', '팀원'], ['access', '접속'], ['history', '기록']];
let detailRange = '24h';   // 모니터링 탭의 기간

// 서버 위생 점수 카드 (개요 탭 맨 위). 지키지 못한 항목은 바로 고칠 수 있는 버튼을 붙인다.
function hygieneSection(r, can) {
  const h = hygieneScore(r);
  const fixLabel = { team: '팀원 추가', tags: '태그 편집', schedule: '자동 중지 설정', extend: '기한 연장' };
  const perm = { team: 'team', tags: 'tags', schedule: 'schedule', extend: 'extend' };
  return '<section class="dsec"><div class="mon-head"><h3 class="dsec__h" style="margin:0">서버 위생 점수</h3>' + scoreBadge(r, true) + '</div>' +
    '<ul class="hyg">' + h.checks.map(function (c) {
      return '<li class="hyg__item' + (c.ok ? ' is-ok' : '') + '"><span class="hyg__mark" aria-hidden="true">' + (c.ok ? '\u2713' : '') + '</span>' +
        '<div class="hyg__body"><div>' + esc(c.label) + '</div>' + (c.ok ? '' : '<div class="hyg__hint">' + esc(c.hint) + '</div>') + '</div>' +
        (!c.ok && can(perm[c.action]) ? '<button type="button" class="btn btn--sm btn--secondary" data-action="' + c.action + '" data-id="' + esc(r.id) + '">' + fixLabel[c.action] + '</button>' : '') + '</li>';
    }).join('') + '</ul></section>';
}

// 몇 분/시간/일 전
function agoText(ms) {
  const m = Math.max(0, Math.floor((Date.now() - ms) / 60000));
  if (m < 1) return '방금';
  if (m < 60) return m + '분 전';
  if (m < 60 * 24) return Math.floor(m / 60) + '시간 전';
  return Math.floor(m / 60 / 24) + '일 전';
}
const TRIGGER_LABEL = { push: 'push', manual: '수동', rollback: '롤백' };
let deployOpen = null;   // 배포 탭에서 로그를 펼쳐 둔 배포 id

function deployPill(d) {
  const t = { success: ['성공', 'pill--running'], failed: ['실패', 'pill--dep-fail'], running: ['배포 중', 'pill--dep-run'] }[d.status];
  return '<span class="pill ' + t[1] + '">' + t[0] + '</span>';
}

// 배포 탭. 실제 배포가 아니라 시뮬레이션이다.
function deployHtml(state, r, can) {
  const id = esc(r.id);
  const run = runningDeploy(r), cur = currentDeploy(r), last = lastDeploy(r);
  const stopped = r.status === 'stopped';
  const who = r.repo ? (r.repo.connectedBy === CURRENT_USER.id ? currentUser(state).name : (personById(r.repo.connectedBy) || {}).name || r.repo.connectedBy) : '';
  let card;
  if (r.repo) {
    const off = stopped ? '중지된 서버에는 배포할 수 없습니다.' : run ? '이미 배포가 진행 중입니다.' : '';
    card = '<div class="repo"><div class="repo__url">' + esc(r.repo.url) + '</div>' +
      '<div class="repo__meta">' + esc(r.repo.branch) + ' 브랜치 \u00B7 ' + esc(who) + '이(가) ' + agoText(r.repo.connectedAt) + ' 연결</div>' +
      '<p class="muted-p" style="margin:8px 0 0">' + esc(r.repo.branch) + '에 push하면 자동으로 배포됩니다.</p>' +
      (can('deploy') ? '<div class="repo__btns"><button type="button" class="btn btn--sm" data-action="deploy-run" data-id="' + id + '"' +
        (off ? ' disabled title="' + esc(off) + '"' : '') + '>지금 배포</button>' +
        (can('repo') ? '<button type="button" class="btn btn--sm btn--secondary" data-action="deploy-disconnect" data-id="' + id + '">연결 해제</button>' : '') + '</div>' : '') + '</div>';
  } else {
    card = '<div class="repo repo--empty"><p class="muted-p" style="margin:0">저장소를 연결하면 push할 때마다 서버에 자동으로 반영됩니다.</p>' +
      (r.clonedFrom ? '<p class="muted-p" style="margin:8px 0 0">"' + esc(r.clonedFrom) + '"의 저장소 연결은 복사되지 않았습니다. 실수로 다른 저장소에 배포되는 것을 막기 위해서입니다.</p>' : '') +
      (can('repo') ? '<div class="repo__btns"><button type="button" class="btn btn--sm" data-action="deploy-connect" data-id="' + id + '">저장소 연결</button></div>' : '') + '</div>';
  }
  let notes = '';
  if (r.repo && r.pendingDeploy) {
    notes += '<div class="tip tip--warn">중지 중이라 배포가 보류되었습니다. 서버를 시작하면 최신 커밋(' + esc(r.pendingDeploy.commit) + ')으로 배포됩니다.</div>';
  }
  if (r.repo && last && last.status === 'failed') {
    notes += '<div class="tip tip--warn"><strong>최근 배포(#' + last.seq + ')가 실패했습니다.</strong> ' +
      (cur ? '서버에는 #' + cur.seq + ' 버전이 그대로 올라가 있습니다.' : '서버에는 아직 배포된 버전이 없습니다.') + ' 아래 이력에서 로그를 확인하세요.</div>';
  }
  const curLine = r.repo ? '<div class="depcur"><span class="muted">현재 배포</span> ' + (cur
    ? '<strong>#' + cur.seq + '</strong> \u00B7 <span class="mono">' + esc(cur.commit) + '</span> \u00B7 ' + agoText(cur.at) + ' \u00B7 ' + esc(cur.message || '')
    : '<span class="muted">아직 없음. "지금 배포"로 첫 배포를 해 보세요.</span>') + '</div>' : '';

  const rows = (r.deploys || []).slice().sort(function (a, b) { return b.seq - a.seq; }).map(function (d) {
    const open = d.status === 'running' || deployOpen === d.id;
    const title = d.trigger === 'rollback' ? '#' + d.seq + ' (롤백 \u2192 #' + d.rollbackOf + ')' : '#' + d.seq;
    const canRb = can('deploy') && r.repo && d.status === 'success' && d.trigger !== 'rollback' && !(cur && cur.seq === d.seq) && !run && !stopped;
    return '<div class="dep' + (open ? ' is-open' : '') + '"><div class="dep__row">' +
      '<button type="button" class="dep__main" data-action="deploy-log" data-id="' + id + '" data-dep="' + esc(d.id) + '" aria-expanded="' + open + '">' +
        '<span class="dep__title"><strong>' + esc(title) + '</strong> <span class="mono muted">' + esc(d.commit) + '</span> ' + deployPill(d) + '</span>' +
        '<span class="dep__msg">' + esc(d.message || '') + '</span>' +
        '<span class="dep__meta muted">' + TRIGGER_LABEL[d.trigger] + ' \u00B7 ' + esc(d.author || '') + ' \u00B7 ' + agoText(d.at) + '</span></button>' +
      (canRb ? '<button type="button" class="btn btn--sm btn--secondary" data-action="deploy-rollback" data-id="' + id + '" data-seq="' + d.seq + '">롤백</button>' : '') + '</div>' +
      (open ? '<pre class="deplog">' + deployLogLines(r, d, Date.now()).map(function (l) {
        return '<span class="deplog__' + l.level + '">' + esc(l.text) + '</span>'; }).join('\n') + '</pre>' : '') + '</div>';
  }).join('');

  return '<section class="dsec"><div class="mon-head"><h3 class="dsec__h" style="margin:0">배포</h3>' +
    '<span class="pill pill--sim" title="실제 빌드나 GitHub 연동은 없습니다">프로토타입 \u00B7 시뮬레이션</span></div>' +
    '<div style="margin-top:12px">' + card + '</div>' + notes + curLine + '</section>' +
    '<section class="dsec"><h3 class="dsec__h">배포 이력</h3>' + (rows ? '<div class="deps">' + rows + '</div>' : '<p class="muted-p">배포 이력이 아직 없습니다.</p>') + '</section>';
}

// 자동 중지 예약 카드 (개요 탭)
function scheduleSection(r, canEdit) {
  const sch = r.schedule && r.schedule.enabled ? r.schedule : null;
  let body;
  if (sch) {
    const e = scheduleEstimate(r, sch);
    body = '<div class="sch-now"><strong>' + esc(scheduleText(sch)) + '</strong>' +
      (inScheduleWindow(sch, new Date()) ? ' <span class="pill pill--stopped">지금 중지 시간대</span>' : '') + '</div>' +
      '<p class="muted-p" style="margin:6px 0 0">하루 ' + e.offHours + '시간 꺼져 있어 하루 평균 약 ' + fmt(e.perDay) +
      ' 크레딧, 남은 기한 동안 약 ' + fmt(e.total) + ' 크레딧을 아낄 수 있습니다(예상치).</p>';
  } else {
    body = '<p class="muted-p" style="margin:0">설정되어 있지 않습니다. 밤새 켜 둔 서버를 자동으로 멈추면 크레딧을 아낄 수 있습니다.</p>';
  }
  return '<section class="dsec dsec--sched"><h3 class="dsec__h">자동 중지</h3>' + body +
    (canEdit ? '<button type="button" class="btn btn--sm btn--secondary" style="margin-top:10px" data-action="schedule" data-id="' +
      esc(r.id) + '">' + (sch ? '예약 변경' : '예약 설정') + '</button>' : '') + '</section>';
}

// 꺾은선 그래프 (SVG). values: 0~100 (%)
function lineChart(values, leftLabel) {
  const w = 320, h = 90, pad = 4, n = values.length;
  const x = function (i) { return pad + (w - pad * 2) * i / (n - 1); };
  const y = function (v) { return h - pad - (h - pad * 2) * v / 100; };
  const pts = values.map(function (v, i) { return x(i).toFixed(1) + ',' + y(v).toFixed(1); }).join(' ');
  return '<svg class="chart" viewBox="0 0 ' + w + ' ' + (h + 14) + '" role="img" aria-label="사용률 그래프" preserveAspectRatio="none">' +
    [0, 50, 100].map(function (g) { return '<line class="chart__grid" x1="0" x2="' + w + '" y1="' + y(g) + '" y2="' + y(g) + '"/>'; }).join('') +
    '<polygon class="chart__area" points="' + x(0) + ',' + y(0) + ' ' + pts + ' ' + x(n - 1) + ',' + y(0) + '"/>' +
    '<polyline class="chart__line" points="' + pts + '"/>' +
    '<text class="chart__label" x="0" y="' + (h + 11) + '">' + leftLabel + '</text>' +
    '<text class="chart__label" x="' + w + '" y="' + (h + 11) + '" text-anchor="end">지금</text></svg>';
}

// 모니터링 탭. 값은 실제 측정이 아니라 사용량에서 만든 예시다.
function monitorHtml(r, can) {
  const m = metricSeries(r, detailRange);
  const rangeBtns = '<div class="seg seg--sm" role="group" aria-label="기간">' + [['24h', '24시간'], ['7d', '7일']].map(function (o) {
    return '<button type="button" data-action="monitor-range" data-range="' + o[0] + '" aria-pressed="' + (detailRange === o[0]) + '">' + o[1] + '</button>';
  }).join('') + '</div>';
  if (m.stopped) {
    return '<section class="dsec"><div class="mon-head"><h3 class="dsec__h" style="margin:0">사용률</h3>' + rangeBtns + '</div>' +
      '<p class="muted-p" style="margin-top:12px">서버가 중지되어 있어 사용률이 기록되지 않습니다. 시작하면 다시 표시됩니다.</p></section>' + diskBlock(r, m, can);
  }
  const left = detailRange === '7d' ? '7일 전' : '24시간 전';
  const stat = function (title, avg, max, now, series) {
    return '<div class="mon"><div class="mon__head"><span>' + title + '</span><span class="mon__now' + (now >= 80 ? ' mon__now--high' : '') + '">' + now + '%</span></div>' +
      lineChart(series, left) + '<div class="mon__foot">평균 ' + avg + '% · 최대 ' + max + '%</div></div>';
  };
  const sg = suggestSize(r, m);
  let tip = '';
  if (sg.type === 'down') {
    tip = '<div class="tip"><strong>사양을 낮춰도 될 것 같아요.</strong> 평균 CPU ' + m.cpuAvg + '%, 메모리 ' + m.memAvg + '%로 여유가 있습니다. ' +
      FLAVORS[sg.to].name + '(으)로 낮추면 하루 ' + fmt(sg.savePerDay) + ' 크레딧을 아낄 수 있습니다.' +
      (can('resize') ? '<div><button type="button" class="btn btn--sm btn--secondary" data-action="change" data-id="' + esc(r.id) + '">사양 변경</button></div>' : '') + '</div>';
  } else if (sg.type === 'up') {
    tip = '<div class="tip tip--warn"><strong>사용량이 높은 편이에요.</strong> 평균 CPU ' + m.cpuAvg + '%, 메모리 ' + m.memAvg + '%입니다. ' +
      FLAVORS[sg.to].name + '(으)로 올리면 하루 ' + fmt(sg.extraPerDay) + ' 크레딧이 더 듭니다.' +
      (can('resize') ? '<div><button type="button" class="btn btn--sm btn--secondary" data-action="change" data-id="' + esc(r.id) + '">사양 변경</button></div>' : '') + '</div>';
  } else {
    tip = '<div class="tip">사용량이 적정한 범위입니다.</div>';
  }
  return '<section class="dsec"><div class="mon-head"><h3 class="dsec__h" style="margin:0">사용률</h3>' + rangeBtns + '</div>' +
    stat('CPU', m.cpuAvg, m.cpuMax, m.cpu[m.cpu.length - 1], m.cpu) + stat('메모리', m.memAvg, m.memMax, m.mem[m.mem.length - 1], m.mem) +
    tip + '</section>' + diskBlock(r, m, can);
}

function diskBlock(r, m, can) {
  const high = m.diskPct >= 80;
  return '<section class="dsec"><h3 class="dsec__h">디스크</h3><div class="mon__head"><span>' + m.diskUsedGb + 'GB / ' + m.diskTotalGb + 'GB 사용</span>' +
    '<span class="mon__now' + (high ? ' mon__now--high' : '') + '">' + m.diskPct + '%</span></div>' +
    '<div class="meter' + (high ? ' meter--warn' : '') + '"><span style="width:' + m.diskPct + '%"></span></div>' +
    (high ? '<div class="tip tip--warn" style="margin-top:10px"><strong>디스크가 거의 찼어요.</strong> 가득 차면 작업이 멈출 수 있으니 미리 늘려 두세요.' +
      (can('disk') ? '<div><button type="button" class="btn btn--sm btn--secondary" data-action="disk" data-id="' + esc(r.id) + '">디스크 확장</button></div>' : '') + '</div>' : '') +
    '<p class="muted-p" style="margin-top:12px;font-size:12px">※ 프로토타입에서는 실제 측정값이 아니라 예시 데이터를 보여 줍니다.</p></section>';
}

function detailHtml(state, r) {
  const me = CURRENT_USER.id, perm = myPerm(r), id = esc(r.id);
  const status = resourceStatus(r), stopped = status === 'stopped', restarting = status === 'restarting';
  const f = FLAVORS[r.flavor];
  const can = function (a) { return canDo(r, me, a); };
  const kv = function (k, v) { return '<div class="kv__row"><dt>' + esc(k) + '</dt><dd>' + v + '</dd></div>'; };
  const permName = perm === 'owner' ? '소유자' : perm === 'none' ? '권한 없음' : MEMBER_ROLES[perm].name;
  const tabs = DETAIL_TABS.filter(function (t) { return (t[0] !== 'access' && t[0] !== 'monitor' && t[0] !== 'deploy') || can('access'); });
  const tab = tabs.some(function (t) { return t[0] === detailTab; }) ? detailTab : 'overview';

  let body = '';
  if (tab === 'overview') {
    const tools = r.addons.length ? '<div class="vm__addons" style="margin-top:10px">' + r.addons.map(function (a) {
      return '<div class="sw">' + iconHtml(a, 'sw__logo') + '<div><div class="sw__name">' + esc(ADDONS[a].name) +
        '</div><div class="sw__sub">' + fmt(ADDONS[a].costPerDay) + '/일</div></div></div>'; }).join('') + '</div>'
      : '<p class="muted-p" style="margin-top:8px">설치된 추가 도구가 없습니다.</p>';
    body = hygieneSection(r, can) + '<section class="dsec"><h3 class="dsec__h">기본 정보</h3><dl class="kv">' +
      kv('소유자', esc(r.ownerName) + ' <span class="mono muted">(' + esc(r.owner) + ')</span>') +
      kv('프로젝트', (r.project ? esc(r.project) : '<span class="muted">없음</span>') +
        (can('project') ? ' <button type="button" class="link-btn" data-action="project" data-id="' + id + '">변경</button>' : '')) +
      kv('소속', esc(r.team)) + kv('남은 기한', '<span class="' + leftClass(r.ttlLeftHours) + '">' + formatLeft(r.ttlLeftHours) + '</span>') +
      kv('사용량', stopped ? '—' : r.usage + '%') + kv('내 권한', esc(permName)) + '</dl>' +
      (r.tags.length ? '<div class="tags" style="margin-top:8px">' + r.tags.map(function (t) {
        return '<span class="tag">' + esc(t) + '</span>'; }).join('') + '</div>' : '') + '</section>' +
      scheduleSection(r, can('schedule')) +
      '<section class="dsec"><h3 class="dsec__h">사양과 설치된 도구</h3><dl class="kv">' +
      kv('운영체제', esc(osById(r.os).name)) +
      kv('사양', esc(f.name) + ' <span class="mono muted">(' + specText(f) + ')</span>') +
      kv('디스크', r.disk + 'GB SSD' + (diskCostOf(r.disk) ? ' <span class="mono muted">(+' + fmt(diskCostOf(r.disk)) + '/일)</span>' : '')) +
      kv('기본 요금', fmt(f.costPerDay) + '/일') +
      kv('일일 청구액', '<strong>' + fmt(resourceDailyCost(r)) + '</strong>' + (stopped ? ' <span class="cost-sub">(중지)</span>' : '')) +
      '</dl>' + tools + '</section>';
  } else if (tab === 'deploy') {
    body = deployHtml(state, r, can);
  } else if (tab === 'monitor') {
    body = monitorHtml(r, can);
  } else if (tab === 'team') {
    const rows = [[r.ownerName, r.owner, '소유자', '모든 작업']].concat(
      r.members.map(function (m) { return [m.name, m.id, MEMBER_ROLES[m.role].name, MEMBER_ROLES[m.role].desc]; }));
    body = '<section class="dsec"><h3 class="dsec__h">팀원 (' + rows.length + '명)</h3><div class="dmem">' + rows.map(function (m) {
      return '<div class="dmem__row"><div><strong>' + esc(m[0]) + '</strong> <span class="mono muted">' + esc(m[1]) +
        '</span><div class="dmem__desc">' + esc(m[3]) + '</div></div><span class="chip">' + esc(m[2]) + '</span></div>';
    }).join('') + '</div>' + (r.members.length ? '' : '<p class="muted-p">아직 함께 쓰는 팀원이 없습니다.</p>') +
      (can('team') ? '<button type="button" class="btn btn--sm btn--secondary" style="margin-top:10px" data-action="team" data-id="' + id + '">팀원 관리</button>' : '') +
      '</section>';
  } else if (tab === 'access') {
    body = '<section class="dsec"><h3 class="dsec__h">접속 정보</h3><div class="ssh__body" style="margin:0"><div class="cmd">ssh soft2021@' +
      resourceIp(r.id) + ' -p 22</div><div><span class="k">초기 계정</span> soft2021 (최초 로그인 시 비밀번호 변경)</div>' +
      (r.tempPassword ? '<div class="pw"><span class="k">초기 비밀번호</span> <span class="mono">' + esc(r.tempPassword) +
        '</span><div class="pw-note">처음 접속한 뒤 반드시 변경하세요.</div></div>' : '') +
      '<div><span class="k">콘솔</span> https://console.dkudev.local/vm/' + id + '</div></div></section>' +
      '<section class="dsec"><h3 class="dsec__h">처음 접속하는 방법</h3><ol class="steps">' +
      '<li>터미널(Mac, Linux) 또는 PowerShell(Windows)을 엽니다.</li><li>위 명령을 붙여 넣고 Enter를 누릅니다.</li>' +
      '<li>비밀번호를 물으면 초기 비밀번호를 입력하고, 안내에 따라 새 비밀번호로 바꿉니다.</li></ol></section>';
  } else {
    const logs = state.history.filter(function (h) { return h.resourceId === r.id && h.type !== 'initial'; })
      .sort(function (a, b) { return b.at - a.at; }).slice(0, 10);
    body = '<section class="dsec"><h3 class="dsec__h">이 서버의 기록</h3>' + (logs.length ? '<div class="dhist">' + logs.map(function (h) {
      const when = new Date(h.at).toLocaleDateString('ko-KR', { month: 'numeric', day: 'numeric' });
      return '<div class="dhist__row"><span class="muted">' + esc(when) + '</span><span>' + esc(historyLabel(h)) +
        '</span><span class="mono">' + (h.change === 0 ? '—' : (h.change > 0 ? '+' : '') + fmt(h.change)) + '</span></div>';
    }).join('') + '</div><a class="dlink" href="history.html">전체 내역 보기</a>' : '<p class="muted-p">이 서버의 기록이 아직 없습니다.</p>') + '</section>';
  }

  const btn = function (label, action, o) {
    o = o || {};
    return '<button type="button" class="btn btn--sm' + (o.primary ? '' : ' btn--secondary') + (o.fill ? ' btn--danger-fill' : '') +
      '" data-action="' + action + '" data-id="' + id + '"' + (o.off ? ' disabled title="' + esc(o.off) + '"' : '') + '>' + label + '</button>';
  };
  let actions = '';
  if (can('extend')) {
    actions += btn('기한 연장', 'extend', { primary: true });
    actions += btn(stopped ? '시작' : '중지', stopped ? 'start' : 'stop', { off: restarting ? '재시작이 끝난 뒤에 할 수 있습니다' : '' });
    actions += btn('사양 변경', 'change', { off: stopped ? '중지 중에는 사양을 바꿀 수 없습니다' : restarting ? '재시작이 끝난 뒤에 할 수 있습니다' : '' });
    actions += btn('디스크 확장', 'disk');
    actions += btn('자동 중지', 'schedule');
    actions += btn('재시작', 'restart', { off: stopped ? '중지 중에는 재시작할 수 없습니다' : restarting ? '이미 재시작 중입니다' : '' });
    actions += btn('비밀번호 재발급', 'reissue', { off: stopped ? '중지 중에는 재발급할 수 없습니다' : '' });
    actions += btn('태그 편집', 'tags');
    if (can('clone')) actions += btn('복제', 'clone');
    if (can('return')) actions += btn('반납', 'return', { fill: true });
  } else if (can('clone')) {
    actions = btn('복제', 'clone') + '<span class="muted-p" style="margin:0 0 0 8px">사용 권한으로는 접속 정보만 볼 수 있습니다.</span>';
  } else {
    actions = '<span class="muted-p" style="margin:0">' + (perm === 'use' ? '사용 권한으로는 접속 정보만 볼 수 있습니다.' : '이 서버에 대한 권한이 없습니다.') + '</span>';
  }

  return '<header class="drawer__head"><div><div class="drawer__name">' + esc(r.name) + '</div><div class="drawer__sub">' +
    '<span class="res-id">' + id + '</span>' + pillHtml(status) +
    (can('rename') ? '<button type="button" class="link-btn" data-action="rename" data-id="' + id + '">이름 변경</button>' : '') + '</div></div>' +
    '<button type="button" class="btn btn--sm btn--secondary" data-action="detail-close" id="detail-close">닫기</button></header>' +
    '<div class="drawer__actions">' + actions + '</div>' +
    '<div class="tabs" role="tablist">' + tabs.map(function (t) {
      return '<button type="button" role="tab" class="tabs__tab" aria-selected="' + (t[0] === tab) + '" data-action="detail-tab" data-tab="' + t[0] + '">' + t[1] + '</button>';
    }).join('') + '</div><div class="drawer__body">' + body + '</div>';
}

function initDashboardPage() {
  const state = loadState();
  const main = document.querySelector('.main');
  const dialog = document.getElementById('change-dialog');
  const teamDialog = document.getElementById('team-dialog');
  // 보기 방식: 저장해 둔 선택이 있으면 그것을, 없으면 프로젝트가 있는 서버가 하나라도 있을 때 프로젝트별로 시작한다.
  let savedMode = null;
  try { savedMode = localStorage.getItem('dku-dev-view-mode'); } catch (e) { /* 저장소를 못 쓰면 기본값 사용 */ }
  const view = { filter: 'mine', query: '', sort: 'expiry', tag: '',
                 mode: savedMode === 'list' || savedMode === 'project' ? savedMode
                       : state.resources.some(function (r) { return r.project; }) ? 'project' : 'list' };
  let current = null;   // 사양 변경 모달에서 편집 중인 자원
  let target = null;
  let teamRes = null;   // 팀원 관리 모달에서 편집 중인 자원
  let picked = null;    // 팀원 추가에서 검색 결과 중 선택한 사람 id

  let detailId = null;  // 상세 패널에 열어 둔 자원 id
  const panel = document.getElementById('detail-panel');
  const scrim = document.getElementById('detail-scrim');
  detailHook = function () {
    const r = detailId && state.resources.filter(function (x) { return x.id === detailId; })[0];
    if (!r) { detailId = null; panel.hidden = true; scrim.hidden = true; return; }
    const top = panel.scrollTop;
    panel.innerHTML = detailHtml(state, r);
    panel.hidden = false; scrim.hidden = false;
    panel.scrollTop = top;
  };
  function closeDetail() { detailId = null; detailHook(); }

  if (refreshApprovals(state, Date.now())) saveState(state);
  render();

  function render() { renderDashboard(state, view); }
  function commit(msg) {
    saveState(state);
    render();
    renderQuotaWidget();
    if (msg) showToast(msg);
  }
  // 작업별 필요 권한(ACTION_MIN_ROLE)을 만족하는 자원만 돌려준다.
  function find(id, action) {
    const r = state.resources.filter(function (x) { return x.id === id; })[0];
    return r && canDo(r, CURRENT_USER.id, action) ? r : null;
  }

  /* --- 기한 연장 --- */
  function extendAction(r) {
    const days = LIFECYCLE_POLICY.extendDays;
    const cost = extendCost(r, days), rem = remainingCredit(state), over = cost > rem;
    const rows = [
      ['현재 남은 기한', formatLeft(r.ttlLeftHours)],
      ['연장 후', formatLeft(r.ttlLeftHours + days * 24)],
      ['일일 요금', fmt(resourceDailyCost(r)) + (r.status === 'stopped' ? ' (중지)' : '')],
      ['연장 비용', fmt(cost) + ' 크레딧', 'diff__result diff__result--pay']
    ];
    if (!over) rows.push(['연장 후 잔여 크레딧', fmt(rem) + ' → ' + fmt(rem - cost)]);
    actionDialog({
      title: '기한 연장', text: r.name + '의 사용 기한을 ' + days + '일 연장합니다.', rows: rows,
      alerts: over ? [{ level: 'block', msg: '잔여 크레딧 부족 (필요 ' + fmt(cost) + ' / 보유 ' + fmt(rem) + ')' }] : [],
      okLabel: '연장', disabled: over
    }, function () {
      r.ttlLeftHours += days * 24;
      applyCredit(state, 'extend', r, cost);
      commit(days + '일 연장되었습니다. ' + fmt(cost) + ' 크레딧이 차감되었습니다.');
    });
  }

  /* --- 중지 / 시작 --- */
  function stopAction(r) {
    const d = stopDelta(r);
    actionDialog({
      title: '자원 중지',
      text: '"' + r.name + '" 자원을 중지합니다. 중지 중에도 사용 기한은 계속 흐르며, 만료되면 자동 정지 후 보관됩니다.',
      rows: [['일일 요금', fmt(d.base) + ' → ' + fmt(d.stopped) + ' (' + Math.round(LIFECYCLE_POLICY.stoppedCostRatio * 100) + '%)'],
             ['남은 기한', formatLeft(r.ttlLeftHours)],
             ['돌려받는 크레딧', fmt(d.amount), 'diff__result diff__result--save']],
      okLabel: '중지'
    }, function () {
      r.status = 'stopped';
      applyCredit(state, 'stop', r, -d.amount);
      commit('중지했습니다. ' + fmt(d.amount) + ' 크레딧을 돌려받았습니다.');
    });
  }
  function startAction(r) {
    const d = stopDelta(r), rem = remainingCredit(state), over = d.amount > rem;
    actionDialog({
      title: '자원 시작', text: '"' + r.name + '" 자원을 다시 시작합니다. 남은 기한만큼 일일 요금이 원래대로 청구됩니다.',
      rows: [['일일 요금', fmt(d.stopped) + ' → ' + fmt(d.base)],
             ['남은 기한', formatLeft(r.ttlLeftHours)],
             ['추가로 결제할 크레딧', fmt(d.amount), 'diff__result diff__result--pay']],
      alerts: over ? [{ level: 'block', msg: '잔여 크레딧 부족 (필요 ' + fmt(d.amount) + ' / 보유 ' + fmt(rem) + ')' }] : [],
      okLabel: '시작', disabled: over
    }, function () {
      r.status = 'running';
      applyCredit(state, 'start', r, d.amount);
      const pend = resumePending(state, r);   // 중지 중에 들어온 push가 있으면 지금 배포한다
      commit('시작했습니다. ' + fmt(d.amount) + ' 크레딧이 차감되었습니다.' + (pend ? ' 보류된 배포를 시작했습니다.' : ''));
    });
  }

  /* --- 배포: 저장소 연결, 실행, 롤백 (시뮬레이션) --- */
  function connectAction(r) {
    const d = openDialog(
      '<h2>저장소 연결</h2><p>' + esc(r.name) + '에 코드 저장소를 연결합니다. 연결하면 브랜치에 push할 때마다 자동으로 배포됩니다.</p>' +
      '<label class="field__label" for="rp-url" style="margin-top:14px">저장소 주소</label>' +
      '<input class="input" id="rp-url" type="text" autocomplete="off" placeholder="github.com/팀/프로젝트" aria-label="저장소 주소">' +
      '<label class="field__label" for="rp-branch" style="margin-top:12px">브랜치</label>' +
      '<input class="input" id="rp-branch" type="text" autocomplete="off" value="main" aria-label="브랜치">' +
      '<div id="rp-msg"></div>' +
      '<div class="actions"><button type="button" class="btn btn--secondary" data-action="cancel">취소</button>' +
      '<button type="button" class="btn" data-action="save" data-default>연결</button></div>',
      function (action, dlg) {
        if (action !== 'save') return;
        const res = connectRepo(state, r, dlg.querySelector('#rp-url').value, dlg.querySelector('#rp-branch').value);
        if (!res.ok) { dlg.querySelector('#rp-msg').innerHTML = alertsHtml([{ level: 'block', msg: res.msg }]); return true; }
        detailTab = 'deploy';
        commit('저장소를 연결했습니다. "지금 배포"로 첫 배포를 해 보세요.');
      });
    d.querySelector('#rp-url').focus();
  }
  function disconnectAction(r) {
    actionDialog({
      title: '저장소 연결 해제', text: '연결만 해제합니다. 지금까지의 배포 이력은 그대로 남습니다.',
      rows: [['저장소', r.repo.url]], okLabel: '해제', danger: true
    }, function () { disconnectRepo(state, r); commit('저장소 연결을 해제했습니다.'); });
  }
  function deployRun(r) {
    const res = startDeploy(state, r, 'manual');
    if (!res.ok) { showToast(res.msg); return; }
    deployOpen = res.deploy.id;
    commit('배포를 시작했습니다.');
  }
  function rollbackAction(r, seq) {
    const t = r.deploys.filter(function (d) { return d.seq === seq; })[0];
    if (!t) return;
    actionDialog({
      title: '이전 버전으로 롤백', text: '#' + seq + ' 버전을 서버에 다시 배포합니다. 롤백도 새 배포 이력으로 남습니다.',
      rows: [['되돌릴 버전', '#' + seq + ' \u00B7 ' + t.commit], ['내용', t.message || '-']], okLabel: '롤백'
    }, function () {
      const res = rollbackTo(state, r, seq);
      if (!res.ok) { showToast(res.msg); return; }
      deployOpen = res.deploy.id;
      commit('롤백을 시작했습니다.');
    });
  }

  /* --- 프로젝트 변경 --- */
  function projectAction(r) {
    openDialog(
      '<h2>프로젝트</h2><p>' + esc(r.name) + '이(가) 속한 프로젝트입니다. 같은 이름으로 묶으면 "프로젝트별로 보기"에서 한곳에 모입니다. 비우면 프로젝트 없음이 됩니다.</p>' +
      '<input class="input" id="pj-input" type="text" list="pj-list" maxlength="' + PROJECT_MAX_LEN + '" autocomplete="off" aria-label="프로젝트 이름" value="' + esc(r.project || '') + '">' +
      '<datalist id="pj-list">' + projectNames(state).map(function (n) { return '<option value="' + esc(n) + '"></option>'; }).join('') + '</datalist>' +
      '<div class="actions"><button type="button" class="btn btn--secondary" data-action="cancel">취소</button>' +
      '<button type="button" class="btn" data-action="save" data-default>저장</button></div>',
      function (action, dlg) {
        if (action !== 'save') return;
        if (!setProject(state, r, dlg.querySelector('#pj-input').value)) return;
        commit('프로젝트를 바꿨습니다.');
      });
  }

  /* --- 서버 이름 변경 --- */
  function renameAction(r) {
    openDialog(
      '<h2>서버 이름 변경</h2><p>' + esc(r.id) + '의 이름을 바꿉니다. 40자까지 쓸 수 있습니다.</p>' +
      '<input class="input" id="rn-input" type="text" maxlength="40" aria-label="서버 이름" value="' + esc(r.name) + '">' +
      '<div class="actions"><button type="button" class="btn btn--secondary" data-action="cancel">취소</button>' +
      '<button type="button" class="btn" data-action="save" data-default>저장</button></div>',
      function (action, dlg) {
        if (action !== 'save') return;
        const v = dlg.querySelector('#rn-input').value.trim();
        if (!v) return true;
        if (!renameResource(state, r, v)) return;   // 바뀐 게 없으면 그냥 닫는다
        commit('이름을 바꿨습니다.');
      });
  }

  /* --- 반납 -> 휴지통 (서버 ID를 입력해야 진행) --- */
  function returnAction(r) {
    const refund = returnRefund(r);
    const d = openDialog(
      '<h2>서버 반납</h2><p>' + esc(r.name) + '을(를) 반납합니다.</p>' +
      '<div class="tip">반납해도 <strong>휴지통에서 ' + LIFECYCLE_POLICY.trashRetentionDays + '일간 복구</strong>할 수 있어요. 환불은 바로 처리됩니다.</div>' +
      '<div class="diff"><div class="kv__row"><dt>남은 기한</dt><dd>' + formatLeft(r.ttlLeftHours) + '</dd></div>' +
      '<div class="kv__row diff__result diff__result--save"><dt>돌려받는 크레딧</dt><dd>' + fmt(refund) + '</dd></div></div>' +
      '<label class="field__label" for="rt-input" style="margin-top:14px">실수를 막기 위해 서버 ID <span class="mono">' + esc(r.id) + '</span>를 입력하세요</label>' +
      '<input class="input" id="rt-input" type="text" autocomplete="off" aria-label="서버 ID 확인" placeholder="' + esc(r.id) + '">' +
      '<div class="actions"><button type="button" class="btn btn--secondary" data-action="cancel">취소</button>' +
      '<button type="button" class="btn btn--danger-fill" data-action="ok" id="rt-ok" disabled>반납</button></div>',
      function (action) {
        if (action !== 'ok') return;
        applyCredit(state, 'return', r, -refund);
        moveToTrash(state, r, Date.now());
        commit(fmt(refund) + ' 크레딧을 돌려받았습니다. 휴지통에서 ' + LIFECYCLE_POLICY.trashRetentionDays + '일간 복구할 수 있습니다.');
      });
    d.addEventListener('input', function () {
      d.querySelector('#rt-ok').disabled = d.querySelector('#rt-input').value.trim() !== r.id;
    });
  }
  function trashRestore(t) {
    const cost = restoreCost(t), rem = remainingCredit(state), over = cost > rem;
    const rows = [['서버', t.name], ['남은 기한', formatLeft(t.ttlLeftHours)],
                  ['다시 차감되는 크레딧', fmt(cost), 'diff__result diff__result--pay']];
    if (!over) rows.push(['복구 후 잔여 크레딧', fmt(rem) + ' → ' + fmt(rem - cost)]);
    actionDialog({
      title: '서버 복구', text: '휴지통의 서버를 목록으로 되돌립니다. 남은 기한만큼 크레딧이 다시 차감됩니다.',
      rows: rows,
      alerts: over ? [{ level: 'block', msg: '잔여 크레딧 부족 (필요 ' + fmt(cost) + ' / 보유 ' + fmt(rem) + ')' }] : [],
      okLabel: '복구', disabled: over
    }, function () {
      const r = restoreFromTrash(state, t.id);
      applyCredit(state, 'restore', r, cost);
      commit('복구했습니다. ' + fmt(cost) + ' 크레딧이 다시 차감되었습니다.');
    });
  }
  function trashPurge(t) {
    actionDialog({
      title: '영구 삭제', text: '"' + t.name + '"을(를) 완전히 삭제합니다. 삭제하면 복구할 수 없습니다. 크레딧 변동은 없습니다.',
      rows: [], okLabel: '영구 삭제', danger: true
    }, function () {
      purgeTrashItem(state, t.id);
      logEvent(state, 'purge', t, '');
      commit('영구 삭제했습니다.');
    });
  }

  /* --- 재시작 / 초기 비밀번호 재발급 --- */
  function restartAction(r) {
    actionDialog({
      title: '서버 재시작', text: '"' + r.name + '" 서버를 재시작합니다. 실행 중인 작업이 중단됩니다.',
      rows: [['예상 소요 시간', '약 ' + LIFECYCLE_POLICY.restartSeconds + '초'], ['크레딧', '변동 없음']],
      okLabel: '재시작'
    }, function () {
      startRestart(state, r, Date.now());
      commit('재시작을 시작했습니다.');
    });
  }
  function reissueAction(r) {
    actionDialog({
      title: '초기 비밀번호 재발급', text: '새 임시 비밀번호를 만들어 접속 정보에 표시합니다. 이전 비밀번호는 더 이상 쓸 수 없습니다.',
      rows: [['서버', r.name]], okLabel: '재발급'
    }, function () {
      reissuePassword(state, r);
      detailId = r.id; detailTab = 'access';   // 새 비밀번호는 상세 패널의 접속 탭에 보여 준다
      commit('임시 비밀번호를 발급했습니다. 접속 정보에서 확인하고, 처음 접속한 뒤 반드시 변경하세요.');
    });
  }

  /* --- 디스크 확장 (늘리기만 가능) --- */
  function diskAction(r) {
    const options = DISK_OPTIONS.filter(function (gb) { return gb > r.disk; });
    if (!options.length) {
      openDialog('<h2>디스크 확장</h2><p>' + esc(r.name) + '의 디스크는 이미 가장 큰 크기(' + r.disk + 'GB)입니다.</p>' +
        '<div class="actions"><button type="button" class="btn" data-action="cancel">확인</button></div>', function () {});
      return;
    }
    const d = openDialog(
      '<h2>디스크 확장</h2><p>' + esc(r.name) + ' · 현재 ' + r.disk + 'GB. 디스크는 늘리기만 할 수 있고, 줄일 수는 없습니다.</p>' +
      '<div class="choices choices--compact">' + options.map(function (gb) {
        return '<label class="choice"><input type="radio" name="dk" value="' + gb + '"><span class="choice__body"><strong>' +
          (gb >= 1000 ? '1TB' : gb + 'GB') + '</strong><small class="meta">+' + fmt(diskCostOf(gb) - diskCostOf(r.disk)) + '/일</small></span></label>';
      }).join('') + '</div><div id="dk-diff"></div>' +
      '<div class="actions"><button type="button" class="btn btn--secondary" data-action="cancel">취소</button>' +
      '<button type="button" class="btn" data-action="ok" id="dk-ok" disabled>확장</button></div>',
      function (action, dlg) {
        if (action !== 'ok') return;
        const c = dlg.querySelector('input[name="dk"]:checked');
        if (!c) return true;
        const ch = computeDiskChange(state, r, Number(c.value));
        if (ch.blocked) return true;
        r.disk = ch.toGb;
        applyCredit(state, 'disk', r, ch.amount);
        commit('디스크를 ' + ch.toGb + 'GB로 늘렸습니다. ' + fmt(ch.amount) + ' 크레딧이 차감되었습니다.');
      });
    d.addEventListener('change', function () {
      const c = d.querySelector('input[name="dk"]:checked');
      if (!c) return;
      const ch = computeDiskChange(state, r, Number(c.value));
      d.querySelector('#dk-diff').innerHTML = '<div class="diff">' +
        '<div class="kv__row"><dt>일일 요금</dt><dd>' + fmt(resourceDailyCost(r)) + ' \u2192 ' + fmt(resourceDailyCost(Object.assign({}, r, { disk: ch.toGb }))) + '</dd></div>' +
        '<div class="kv__row"><dt>남은 기한</dt><dd>' + formatLeft(r.ttlLeftHours) + '</dd></div>' +
        '<div class="kv__row diff__result diff__result--pay"><dt>지금 결제할 크레딧</dt><dd>' + fmt(ch.amount) + '</dd></div>' +
        (ch.blocked ? '' : '<div class="kv__row"><dt>결제 후 잔여</dt><dd>' + fmt(ch.remaining) + ' \u2192 ' + fmt(ch.newRemaining) + '</dd></div>') +
        '</div>' + alertsHtml(ch.warnings);
      d.querySelector('#dk-ok').disabled = ch.blocked;
    });
  }

  /* --- 자동 중지 예약 --- */
  function scheduleAction(r) {
    const cur = r.schedule || defaultSchedule();
    const hours = function (sel) {
      let o = '';
      for (let h = 0; h < 24; h++) o += '<option value="' + h + '"' + (h === sel ? ' selected' : '') + '>' + String(h).padStart(2, '0') + ':00</option>';
      return o;
    };
    const d = openDialog(
      '<h2>자동 중지 예약</h2><p>' + esc(r.name) + '. 정해 둔 시간에는 서버를 멈춰 크레딧을 아낍니다. 시작 시각이 되면 다시 켜집니다.</p>' +
      '<div class="sch-grid">' +
      '<label class="field__label" for="sch-days">요일</label><select class="select" id="sch-days">' + Object.keys(SCHEDULE_DAYS).map(function (k) {
        return '<option value="' + k + '"' + (cur.days === k ? ' selected' : '') + '>' + SCHEDULE_DAYS[k] + '</option>'; }).join('') + '</select>' +
      '<label class="field__label" for="sch-stop">중지 시각</label><select class="select" id="sch-stop">' + hours(cur.stopAt) + '</select>' +
      '<label class="field__label" for="sch-start">시작 시각</label><select class="select" id="sch-start">' + hours(cur.startAt) + '</select></div>' +
      '<div id="sch-est"></div>' +
      '<div class="actions">' + (r.schedule ? '<button type="button" class="btn btn--danger" data-action="clear" style="margin-right:auto">해제</button>' : '') +
      '<button type="button" class="btn btn--secondary" data-action="cancel">취소</button>' +
      '<button type="button" class="btn" data-action="save" id="sch-save" data-default>저장</button></div>',
      function (action, dlg) {
        if (action === 'clear') { setSchedule(state, r, null); commit('자동 중지를 해제했습니다.'); return; }
        if (action !== 'save') return;
        const sch = read(dlg);
        if (sch.stopAt === sch.startAt) return true;
        setSchedule(state, r, sch);
        commit('자동 중지를 저장했습니다. ' + scheduleText(sch));
      });
    function read(dlg) {
      return { enabled: true, days: dlg.querySelector('#sch-days').value,
               stopAt: Number(dlg.querySelector('#sch-stop').value), startAt: Number(dlg.querySelector('#sch-start').value) };
    }
    function update() {
      const sch = read(d), same = sch.stopAt === sch.startAt;
      const e = scheduleEstimate(r, sch);
      d.querySelector('#sch-est').innerHTML = same
        ? alertsHtml([{ level: 'block', msg: '중지 시각과 시작 시각이 같을 수 없습니다.' }])
        : '<div class="diff"><div class="kv__row"><dt>하루 중 꺼져 있는 시간</dt><dd>' + e.offHours + '시간</dd></div>' +
          '<div class="kv__row"><dt>예상 절약 (하루 평균)</dt><dd>약 ' + fmt(e.perDay) + ' 크레딧</dd></div>' +
          '<div class="kv__row diff__result diff__result--save"><dt>남은 기한 동안</dt><dd>약 ' + fmt(e.total) + ' 크레딧</dd></div></div>' +
          '<p class="muted-p" style="margin-top:8px">예상치입니다. 프로토타입에서는 절약분이 실제로 정산되지는 않습니다.</p>';
      d.querySelector('#sch-save').disabled = same;
    }
    d.addEventListener('change', update);
    update();
  }

  /* --- 태그 편집 (미리 정의된 3개 + 직접 입력 1개) --- */
  function tagsAction(r) {
    const custom = r.tags.filter(function (t) { return TAG_PRESETS.indexOf(t) === -1; })[0] || '';
    openDialog(
      '<h2>태그 편집</h2><p>' + esc(r.name) + '</p>' +
      '<div class="tag-checks">' + TAG_PRESETS.map(function (t) {
        return '<label class="tag-check"><input type="checkbox" value="' + esc(t) + '"' +
          (r.tags.indexOf(t) !== -1 ? ' checked' : '') + '> ' + esc(t) + '</label>';
      }).join('') + '</div>' +
      '<label class="field__label" for="tag-custom">직접 입력 (1개, 20자 이내)</label>' +
      '<input class="input" id="tag-custom" type="text" maxlength="20" value="' + esc(custom) + '">' +
      '<div class="actions"><button type="button" class="btn btn--secondary" data-action="cancel">취소</button>' +
      '<button type="button" class="btn" data-action="save" data-default>저장</button></div>',
      function (action, dlg) {
        if (action !== 'save') return;
        const sel = Array.prototype.map.call(dlg.querySelectorAll('input[type="checkbox"]:checked'),
          function (i) { return i.value; });
        const tags = normalizeTags(sel, dlg.querySelector('#tag-custom').value);
        if (JSON.stringify(tags) === JSON.stringify(r.tags)) return;
        setTags(state, r, tags);
        commit('태그를 저장했습니다.');
      });
  }

  /* --- 팀원 관리 (소유자만) --- */
  function renderTeam() {
    const r = teamRes;
    document.getElementById('td-title').textContent = '팀원 관리 — ' + r.name;
    document.getElementById('td-members-h').textContent = '현재 팀원 (' + r.members.length + '명)';
    document.getElementById('td-members').innerHTML = r.members.length
      ? r.members.map(function (m) {
          const p = personById(m.id);
          return '<div class="member-row"><div class="member-row__who"><strong>' + esc(m.name) + '</strong>' +
            '<span class="member-row__no">' + esc(p ? p.studentNo : '') + '</span></div>' +
            '<select class="select select--inline" data-member="' + esc(m.id) + '" aria-label="' + esc(m.name) + ' 권한">' +
              Object.keys(MEMBER_ROLES).map(function (k) {
                return '<option value="' + k + '"' + (m.role === k ? ' selected' : '') + '>' + MEMBER_ROLES[k].name + '</option>';
              }).join('') + '</select>' +
            '<button type="button" class="btn btn--sm btn--danger" data-action="td-remove" data-id="' + esc(m.id) + '">제거</button></div>';
        }).join('')
      : '<p class="muted-p">아직 팀원이 없습니다. 아래에서 추가하세요.</p>';

    // 소유권 이전 대상 (팀원 중)
    const sel = document.getElementById('td-transfer');
    sel.innerHTML = r.members.length
      ? '<option value="">받을 사람 선택</option>' + r.members.map(function (m) {
          return '<option value="' + esc(m.id) + '">' + esc(m.name) + ' (' + MEMBER_ROLES[m.role].name + ')</option>';
        }).join('')
      : '<option value="">팀원을 먼저 추가하세요</option>';
    sel.disabled = r.members.length === 0;
    document.getElementById('td-transfer-btn').disabled = true;
    renderResults();
  }
  function renderResults() {
    const q = document.getElementById('td-search').value;
    const list = searchDirectory(q, teamRes);
    document.getElementById('td-results').innerHTML = list.length
      ? list.map(function (x) {
          return '<button type="button" class="td-result' + (picked === x.person.id ? ' is-picked' : '') + '" data-action="td-pick" data-id="' +
            esc(x.person.id) + '"' + (x.already ? ' disabled' : '') + '><span>' + esc(x.person.name) + ' · ' +
            esc(x.person.studentNo) + ' · ' + esc(x.person.dept) + '</span><span>' + (x.already ? '이미 추가됨' : '') + '</span></button>';
        }).join('')
      : (q.trim().length >= 2 ? '<p class="muted-p">일치하는 사람이 없습니다.</p>' : '');
    document.getElementById('td-add').disabled = !picked;
  }
  function teamAction(r) {
    teamRes = r;
    picked = null;
    document.getElementById('td-search').value = '';
    const roleSel = document.getElementById('td-role');
    if (!roleSel.options.length) {
      roleSel.innerHTML = Object.keys(MEMBER_ROLES).map(function (k) {
        return '<option value="' + k + '">' + MEMBER_ROLES[k].name + '</option>';
      }).join('');
      roleSel.value = 'use';
    }
    renderTeam();
    teamDialog.showModal();
  }

  teamDialog.addEventListener('input', function (e) {
    if (e.target.id !== 'td-search') return;
    picked = null;
    renderResults();
  });
  teamDialog.addEventListener('change', function (e) {
    if (e.target.dataset.member) {     // 권한 드롭다운: 즉시 반영
      if (setMemberRole(state, teamRes, e.target.dataset.member, e.target.value)) commit('권한을 변경했습니다.');
    } else if (e.target.id === 'td-transfer') {
      document.getElementById('td-transfer-btn').disabled = !e.target.value;
    }
  });
  teamDialog.addEventListener('click', function (e) {
    const btn = e.target.closest('[data-action]');
    if (!btn || btn.disabled) return;
    const act = btn.dataset.action;
    if (act === 'td-close') { teamDialog.close(); return; }
    if (act === 'td-pick') { picked = btn.dataset.id; renderResults(); return; }
    if (act === 'td-add') {
      const role = document.getElementById('td-role').value;
      const p = personById(picked);
      if (addMember(state, teamRes, picked, role)) {
        markOnboard(state, 'invite');
        picked = null;
        document.getElementById('td-search').value = '';
        renderTeam();
        commit(p.name + '님을 팀원으로 추가했습니다.');
      }
      return;
    }
    if (act === 'td-remove') {
      const m = teamRes.members.filter(function (x) { return x.id === btn.dataset.id; })[0];
      if (removeMember(state, teamRes, btn.dataset.id)) { renderTeam(); commit(m.name + '님을 팀원에서 제거했습니다.'); }
      return;
    }
    if (act === 'td-transfer') {
      const toId = document.getElementById('td-transfer').value;
      const m = teamRes.members.filter(function (x) { return x.id === toId; })[0];
      if (!m) return;
      confirmDialog('소유권을 이전할까요',
        '"' + teamRes.name + '"의 소유권을 ' + m.name + '님에게 넘깁니다. 넘기면 되돌릴 수 없으며, 나는 관리 권한 팀원으로 남습니다.',
        '이전하기', function () {
          transferOwnership(state, teamRes, toId);
          teamDialog.close();
          commit('소유권을 ' + m.name + '님에게 이전했습니다.');
        });
    }
  });

  /* --- 사양 변경 (증설/축소) --- */
  function updateDiff() {
    const diffEl = document.getElementById('cd-diff');
    const confirmBtn = document.getElementById('cd-confirm');
    if (target === current.flavor) {
      diffEl.innerHTML = '<p class="empty">바꿀 사양을 선택하세요.</p>';
      document.getElementById('cd-alerts').innerHTML = '';
      confirmBtn.disabled = true;
      return;
    }
    const ch = computeChange(state, current, target);
    const save = ch.amount < 0;
    diffEl.innerHTML =
      '<div class="diff">' +
      '<div class="kv__row"><dt>일일 요금</dt><dd>' + fmt(ch.fromDaily) + ' → ' + fmt(ch.toDaily) +
        ' (' + signed(ch.dailyDiff) + '/일)</dd></div>' +
      '<div class="kv__row"><dt>남은 기한</dt><dd>' + formatLeft(current.ttlLeftHours) + '</dd></div>' +
      (ch.blocked ? '' :
        '<div class="kv__row diff__result ' + (save ? 'diff__result--save' : 'diff__result--pay') + '">' +
        '<dt>' + (save ? '돌려받는 크레딧' : '추가로 결제할 크레딧') + '</dt><dd>' +
        fmt(Math.abs(ch.amount)) + '</dd></div>' +
        '<div class="kv__row"><dt>변경 후 잔여 크레딧</dt><dd>' + fmt(ch.remaining) + ' → ' +
        fmt(ch.newRemaining) + '</dd></div>') + '</div>';
    document.getElementById('cd-alerts').innerHTML = alertsHtml(ch.warnings);
    confirmBtn.disabled = ch.blocked;
  }
  function changeAction(r) {
    current = r;
    target = r.flavor;
    document.getElementById('cd-title').textContent = r.name;
    document.getElementById('cd-sub').textContent =
      r.id + ' · 현재 ' + FLAVORS[r.flavor].name + ' (' + specText(FLAVORS[r.flavor]) +
      ') · 사용량 ' + r.usage + '%';
    document.getElementById('cd-choices').innerHTML = FLAVOR_RANK.map(function (id) {
      const f = FLAVORS[id];
      return '<label class="choice"><input type="radio" name="target" value="' + id + '"' +
        (id === target ? ' checked' : '') + '><span class="choice__body"><strong>' + f.name +
        (id === r.flavor ? ' (현재)' : '') + '</strong><small class="meta">' + specText(f) +
        '</small><small class="meta">' + fmt(dailyCostOf(id, r.addons, r.disk)) + '/일</small></span></label>';
    }).join('');
    updateDiff();
    dialog.showModal();
  }

  dialog.addEventListener('change', function (e) {
    if (e.target.name !== 'target') return;
    target = e.target.value;
    updateDiff();
  });
  dialog.addEventListener('click', function (e) {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    if (btn.dataset.action === 'confirm' && !btn.disabled) {
      const ch = computeChange(state, current, target);
      current.flavor = target;
      current.usage = ch.newUsage;
      applyCredit(state, 'resize', current, ch.amount);
      commit(ch.amount < 0 ? fmt(-ch.amount) + ' 크레딧을 돌려받았습니다.'
                           : fmt(ch.amount) + ' 크레딧이 추가로 결제되었습니다.');
    }
    dialog.close();
  });

  /* --- 승인된 요청으로 생성 --- */
  function approvalCreate(a) {
    const req = { os: a.os, flavor: a.flavor, addons: a.addons, disk: a.disk, ttl: a.ttl, resourceName: a.name,
                  resources: state.resources, creditDelta: state.creditDelta };
    const total = computeSummary(req).totalCost;
    const shortfall = Math.max(0, total - remainingCredit(state));
    runProvisioning(req, function () {
      const r = createResource(req);
      state.resources.push(r);
      if (shortfall > 0) applyCredit(state, 'grant', null, -shortfall);   // 부족분은 관리자가 추가 배정
      applyCredit(state, 'create', r, r.cost);
      a.status = 'used';
      state.lastCreatedId = r.id; state.cloneFrom = null; state.cloneOrigin = null; state.repoDraft = { url: '', branch: 'main' }; state.projectDraft = ''; markOnboard(state, 'create');
      saveState(state);
      location.href = 'created.html';
    });
  }

  /* --- 이벤트 위임: 화면의 모든 작업 버튼은 main 하나로 받는다 --- */
  const ACTION_OF = { extend: 'extend', stop: 'stopStart', start: 'stopStart', change: 'resize',
                      return: 'return', restart: 'restart', reissue: 'reissue', tags: 'tags', team: 'team',
                      disk: 'disk', schedule: 'schedule', rename: 'rename', clone: 'clone',
                      'deploy-connect': 'repo', 'deploy-disconnect': 'repo', 'deploy-run': 'deploy', 'deploy-rollback': 'deploy', project: 'project' };

  main.addEventListener('click', function (e) {
    // 행의 빈 곳을 눌러도 상세 패널을 연다. 버튼, 링크, 펼침 영역, 드래그로 선택한 글자는 제외한다.
    const row = e.target.closest('tr.row--click');
    if (row && !e.target.closest('button, a, summary, details, input, select, label') &&
        !String(window.getSelection()).length) {
      detailId = row.dataset.id; detailTab = 'overview'; detailHook();
      const c = document.getElementById('detail-close'); if (c) c.focus();
      return;
    }
    const btn = e.target.closest('[data-action]');
    if (!btn || btn.disabled || btn.closest('dialog')) return;
    const act = btn.dataset.action;
    if (act === 'detail') {
      detailId = btn.dataset.id; detailTab = 'overview'; detailHook();
      const c = document.getElementById('detail-close'); if (c) c.focus();
      return;
    }
    if (act === 'detail-close') { closeDetail(); return; }
    if (act === 'detail-tab') { detailTab = btn.dataset.tab; detailHook(); return; }
    if (act === 'sched-dismiss') { state.hints.schedBannerDismissed = true; commit(); return; }
    if (act === 'sched-look') { detailId = btn.dataset.id; detailTab = 'overview'; detailHook(); return; }
    if (act === 'preset') {
      const pr = PRESETS.filter(function (x) { return x.id === btn.dataset.id; })[0];
      if (pr) startFrom(state, pr, null, currentUser(state).team + ' ' + pr.name + (/서버$/.test(pr.name) ? '' : ' 서버'));
      return;
    }
    if (act === 'deploy-log') { deployOpen = deployOpen === btn.dataset.dep ? null : btn.dataset.dep; detailHook(); return; }
    if (act === 'monitor-range') { detailRange = btn.dataset.range; detailHook(); return; }
    if (act === 'view-mode') {
      view.mode = btn.dataset.mode;
      try { localStorage.setItem('dku-dev-view-mode', view.mode); } catch (e) { /* 무시 */ }
      render();
      return;
    }
    if (act === 'filter') { view.filter = btn.dataset.filter; render(); return; }
    if (act === 'tag-filter') { view.tag = view.tag === btn.dataset.tag ? '' : btn.dataset.tag; render(); return; }
    if (act === 'tag-clear') { view.tag = ''; render(); return; }
    if (act === 'clear-conditions') {
      view.query = ''; view.tag = '';
      document.getElementById('dash-search').value = '';
      render();
      return;
    }
    if (act === 'approval-dismiss' || act === 'approval-create') {
      const a = state.approvals.filter(function (x) { return x.id === btn.dataset.id; })[0];
      if (!a) return;
      if (act === 'approval-create') { approvalCreate(a); return; }
      a.status = 'dismissed';
      commit();
      return;
    }
    if (act === 'trash-restore' || act === 'trash-purge') {
      const t = state.trash.filter(function (x) { return x.id === btn.dataset.id && x.owner === CURRENT_USER.id; })[0];
      if (!t) return;
      if (act === 'trash-restore') trashRestore(t); else trashPurge(t);
      return;
    }
    const r = find(btn.dataset.id, ACTION_OF[act]);
    if (!r) return;
    if (act === 'extend') extendAction(r);
    else if (act === 'stop') stopAction(r);
    else if (act === 'start') startAction(r);
    else if (act === 'return') returnAction(r);
    else if (act === 'change') changeAction(r);
    else if (act === 'restart') restartAction(r);
    else if (act === 'reissue') reissueAction(r);
    else if (act === 'tags') tagsAction(r);
    else if (act === 'team') teamAction(r);
    else if (act === 'disk') diskAction(r);
    else if (act === 'schedule') scheduleAction(r);
    else if (act === 'rename') renameAction(r);
    else if (act === 'project') projectAction(r);
    else if (act === 'deploy-connect') connectAction(r);
    else if (act === 'deploy-disconnect') disconnectAction(r);
    else if (act === 'deploy-run') deployRun(r);
    else if (act === 'deploy-rollback') rollbackAction(r, Number(btn.dataset.seq));
    else if (act === 'clone') { cloneConfig(state, r); saveState(state); location.href = 'builder.html'; }
  });

  scrim.addEventListener('click', closeDetail);
  // 보기 옵션 팝업: 열고 닫기 (바깥 클릭, Esc로 닫힘)
  const optBtn = document.getElementById('opt-btn'), optPop = document.getElementById('opt-pop');
  function setOpt(open) { optPop.hidden = !open; optBtn.setAttribute('aria-expanded', String(open)); }
  optBtn.addEventListener('click', function () { setOpt(optPop.hidden); });
  document.addEventListener('click', function (e) {
    if (!optPop.hidden && !e.target.closest('#opt-wrap')) setOpt(false);
  });
  // '/' 키로 검색창에 바로 이동한다 (입력 중이거나 모달이 열려 있으면 무시).
  document.addEventListener('keydown', function (e) {
    if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey) return;
    const t = e.target.tagName;
    if (t === 'INPUT' || t === 'TEXTAREA' || t === 'SELECT' || document.querySelector('dialog[open]')) return;
    e.preventDefault();
    document.getElementById('dash-search').focus();
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && !optPop.hidden) { setOpt(false); optBtn.focus(); return; }
    if (e.key === 'Escape' && detailId && !document.querySelector('dialog[open]')) closeDetail();
  });

  // 검색은 입력 즉시, 정렬은 선택 즉시 반영한다. (툴바는 다시 그리지 않으므로 포커스가 유지된다.)
  main.addEventListener('input', function (e) {
    if (e.target.id !== 'dash-search') return;
    view.query = e.target.value;
    render();
  });
  main.addEventListener('change', function (e) {
    if (e.target.id !== 'dash-sort') return;
    view.sort = e.target.value;
    render();
  });
}

/* ---------- created (생성 완료 안내) ---------- */

// 클립보드 복사. Clipboard API가 막혀 있으면(권한, file:// 등) execCommand 방식으로 한 번 더 시도한다.
function legacyCopy(text) {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  let ok = false;
  try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
  ta.remove();
  return ok;
}

function copyText(text) {
  const fallback = function () {
    return legacyCopy(text) ? Promise.resolve() : Promise.reject(new Error('copy failed'));
  };
  if (navigator.clipboard && window.isSecureContext) {
    return navigator.clipboard.writeText(text).catch(fallback);
  }
  return fallback();
}

function initCreatedPage() {
  const state = loadState();
  const r = state.resources.filter(function (x) { return x.id === state.lastCreatedId; })[0];
  if (!r) { location.replace('dashboard.html'); return; }   // 직접 진입 등: 보여줄 서버가 없으면 대시보드로

  const f = FLAVORS[r.flavor];
  const days = Math.ceil(r.ttlLeftHours / 24);
  const expires = new Date(Date.now() + r.ttlLeftHours * 3600 * 1000)
    .toLocaleDateString('ko-KR', { month: 'long', day: 'numeric', weekday: 'short' });

  document.getElementById('done-name').textContent = r.name + ' (' + r.id + ')';
  document.getElementById('done-chips').innerHTML =
    '<span class="chip">' + esc(osById(r.os).name) + '</span>' +
    '<span class="chip">' + f.name + ' \u00B7 ' + specText(f) + '</span>' +
    '<span class="chip">' + r.disk + 'GB SSD</span>' +
    r.addons.map(function (id) { return '<span class="chip">' + esc(ADDONS[id].name) + '</span>'; }).join('') +
    '<span class="chip">' + days + '일 사용</span>';
  document.getElementById('done-facts').textContent =
    expires + '까지 사용할 수 있고, 이번에 ' + fmt(r.cost || 0) + ' 크레딧이 사용되었습니다. 남은 크레딧은 ' +
    fmt(remainingCredit(state)) + '입니다.';

  document.getElementById('ssh-cmd').textContent = 'ssh soft2021@' + resourceIp(r.id) + ' -p 22';

  if (r.addons.length) {
    document.getElementById('tools-help').hidden = false;
    const svc = { mysql: 'mysql', mongodb: 'mongod', kafka: 'kafka', postgresql: 'postgresql', redis: 'redis-server', nginx: 'nginx', docker: 'docker' };
    document.getElementById('tools-cmds').innerHTML = r.addons.map(function (id) {
      return '<div><strong>' + esc(ADDONS[id].name) + '</strong></div><div class="cmdbox"><code>systemctl status ' +
             svc[id] + '</code></div>';
    }).join('');
  }

  document.getElementById('tips').innerHTML =
    '<li>' + esc(LIFECYCLE_POLICY.expiryAction) + ' 기한이 다가오면 대시보드에서 알려 드리고, ' +
      LIFECYCLE_POLICY.extendDays + '일씩 연장할 수 있습니다.</li>' +
    '<li>당분간 쓰지 않는다면 대시보드에서 "중지"하세요. 중지하면 하루 요금이 ' +
      Math.round(LIFECYCLE_POLICY.stoppedCostRatio * 100) + '%로 줄고, 남은 기한만큼의 차액을 돌려받습니다.</li>' +
    '<li>더 이상 필요 없다면 "반납"하면 남은 기한만큼 크레딧을 돌려받습니다.</li>';

  // 자동 중지 제안: 예약이 없는 서버에만 보여 준다.
  const offer = document.getElementById('sched-offer');
  function renderOffer() {
    if (r.schedule && r.schedule.enabled) {
      offer.innerHTML = '<strong>자동 중지를 켰어요.</strong> ' + esc(scheduleText(r.schedule)) + '에는 서버가 꺼지고 크레딧을 아낍니다. 대시보드에서 언제든 바꿀 수 있어요.';
      return;
    }
    const e = scheduleEstimate(r, defaultSchedule());
    offer.innerHTML = '<div><strong>밤에는 자동으로 꺼 둘까요?</strong> 평일 밤 ' + scheduleText(defaultSchedule()).split(' (')[0] +
      '에 멈추면 하루 약 ' + fmt(e.perDay) + ' 크레딧을 아낄 수 있어요(예상).</div>' +
      '<div class="sched-offer__btns"><button type="button" class="btn btn--sm" data-action="sched-on">평일 밤 자동 중지 켜기</button>' +
      '<button type="button" class="btn btn--sm btn--secondary" data-action="sched-later">나중에</button></div>';
  }
  offer.hidden = false;
  renderOffer();
  offer.addEventListener('click', function (e) {
    if (e.target.closest('[data-action="sched-on"]')) {
      setSchedule(state, r, defaultSchedule());
      saveState(state);
      renderOffer();
    } else if (e.target.closest('[data-action="sched-later"]')) {
      offer.hidden = true;
    }
  });

  document.getElementById('done-card').addEventListener('click', function (e) {
    const copy = e.target.closest('[data-action="copy"]');
    if (copy) {
      const text = document.getElementById(copy.dataset.target).textContent;
      copyText(text).then(function () {
        copy.textContent = '복사됨';
        setTimeout(function () { copy.textContent = '복사'; }, 2000);
      }, function () {
        // 복사가 막힌 환경: 직접 선택해서 복사하도록 안내한다.
        const range = document.createRange();
        range.selectNodeContents(document.getElementById(copy.dataset.target));
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
        showToast('자동 복사가 막혀 있습니다. 선택된 명령어를 직접 복사해 주세요.');
      });
      return;
    }
    if (e.target.closest('[data-action="save-template"]')) {
      // 템플릿의 기한은 선택지(1/7/30일) 중 남은 일수 이상인 가장 작은 값으로 맞춘다.
      const ttlOption = [1, 7, 30].filter(function (d) { return d >= days; })[0] || 30;
      saveTemplateDialog(Object.assign({}, state, { os: r.os, flavor: r.flavor, addons: r.addons.slice(), disk: r.disk,
                                                    ttl: ttlOption, resourceName: r.name }));
    }
  });
}

/* ---------- history (사용 내역) ---------- */

const HISTORY_LABEL = {
  disk: '디스크 확장', schedule: '자동 중지 설정', rename: '서버 이름 변경', project: '프로젝트 변경',
  repo_connect: '저장소 연결', repo_disconnect: '저장소 연결 해제', deploy: '배포', rollback: '롤백',
  initial: '학기 크레딧 지급', create: '서버 생성', extend: '기한 연장', start: '서버 시작',
  stop: '서버 중지 (환불)', return: '서버 반납 (환불)', grant: '추가 배정 (관리자 승인)',
  legacy: '이전 기록 반영',
  restore: '서버 복구 (재차감)', purge: '영구 삭제', restart: '서버 재시작',
  password: '초기 비밀번호 재발급', team_add: '팀원 추가', team_remove: '팀원 제거',
  team_role: '팀원 권한 변경', transfer: '소유권 이전', tags: '태그 변경'
};

function historyLabel(h) {
  if (h.type === 'resize') return h.change < 0 ? '사양 변경 (증설)' : '사양 변경 (축소, 환불)';
  return HISTORY_LABEL[h.type] || h.type;
}

function initHistoryPage() {
  const state = loadState();
  const all = state.history.slice().sort(function (a, b) { return b.at - a.at; });
  let filter = 'all';

  // 환불을 반영한 순사용액. 지급 - 사용 = 잔액이 맞아떨어진다.
  const back = all.reduce(function (t, h) { return t + (h.change > 0 && h.type !== 'initial' ? h.change : 0); }, 0);
  document.getElementById('hist-stats').innerHTML =
    [['지급받은 크레딧', fmt(USER_QUOTA.maxCredit)], ['사용 (환불 반영)', fmt(usedCreditTotal(state))],
     ['그중 돌려받은 크레딧', fmt(back)], ['현재 잔액', fmt(remainingCredit(state))]].map(function (c) {
      return '<div class="card"><div class="stat__label">' + c[0] + '</div><div class="stat__num">' + c[1] + '</div></div>';
    }).join('');

  function render() {
    // 배포, 저장소 연결, 롤백은 크레딧 원장이 아니라 '운영' 탭에서만 보여 준다. (원장을 읽기 어려워지지 않게)
    const OPS = ['deploy', 'rollback', 'repo_connect', 'repo_disconnect'];
    const rows = all.filter(function (h) {
      const isOps = OPS.indexOf(h.type) !== -1;
      if (filter === 'ops') return isOps;
      if (isOps) return false;
      return filter === 'all' || (filter === 'use' ? h.change < 0 : h.change > 0);   // 변동 없는 기록은 '전체'에서만
    });
    document.getElementById('hist-count').textContent = rows.length + '건';
    document.getElementById('hist-card').hidden = rows.length === 0;
    document.getElementById('hist-empty').hidden = rows.length !== 0;
    document.getElementById('hist-list').innerHTML = rows.map(function (h) {
      const when = new Date(h.at).toLocaleString('ko-KR',
        { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
      return '<tr><td class="when">' + esc(when) + '</td><td>' + esc(historyLabel(h)) +
        (h.detail ? '<div class="res-id">' + esc(h.detail) + '</div>' : '') + '</td>' +
        '<td>' + (h.resourceName ? '<div class="res-name">' + esc(h.resourceName) + '</div>' +
          (h.resourceId ? '<div class="res-id">' + esc(h.resourceId) + '</div>' : '') : '<span class="na">\u2014</span>') + '</td>' +
        (h.change === 0
          ? '<td class="num na">\u2014</td>'
          : '<td class="num ' + (h.change < 0 ? 'change--minus' : 'change--plus') + '">' + signed(h.change) + '</td>') +
        '<td class="num">' + fmt(h.balance) + '</td></tr>';
    }).join('');
    Array.prototype.forEach.call(document.querySelectorAll('#hist-filter button'), function (b) {
      b.setAttribute('aria-pressed', String(b.dataset.filter === filter));
    });
  }

  document.getElementById('hist-filter').addEventListener('click', function (e) {
    const b = e.target.closest('[data-action="hist-filter"]');
    if (!b) return;
    filter = b.dataset.filter;
    render();
  });
  render();
}

/* ---------- My Page ---------- */

function initMyPage() {
  const state = loadState();

  const profileEl = document.getElementById('profile');
  const editBtn = document.getElementById('profile-edit');

  function renderProfile(editing, errMsg) {
    const u = currentUser(state);
    editBtn.hidden = editing;
    if (!editing) {
      profileEl.innerHTML =
        '<dl class="kv">' +
        '<div class="kv__row"><dt>이름</dt><dd>' + esc(u.name) + '</dd></div>' +
        '<div class="kv__row"><dt>학번</dt><dd class="mono">' + esc(u.studentNo) + '</dd></div>' +
        '<div class="kv__row"><dt>소속 학과</dt><dd>' + esc(u.dept) + '</dd></div>' +
        '<div class="kv__row"><dt>팀 (연구실)</dt><dd>' + esc(u.team) + '</dd></div>' +
        '<div class="kv__row kv__row--muted"><dt>아이디</dt><dd class="mono">' + esc(CURRENT_USER.id) + '</dd></div></dl>';
      return;
    }
    const field = function (label, name, val, extra) {
      return '<div class="field"><label class="field__label" for="pf-' + name + '">' + label + '</label>' +
        '<input class="input" id="pf-' + name + '" name="' + name + '" type="text" maxlength="40" value="' +
        esc(val) + '"' + (extra || '') + '></div>';
    };
    profileEl.innerHTML =
      '<form class="profile-form" id="profile-form" novalidate>' +
      field('이름', 'name', u.name, ' autocomplete="name"') +
      field('학번', 'studentNo', u.studentNo, ' inputmode="numeric"') +
      field('소속 학과', 'dept', u.dept) +
      field('팀 (연구실)', 'team', u.team) +
      '<div class="field"><label class="field__label">아이디 <span class="optional">(변경할 수 없습니다)</span></label>' +
        '<input class="input" type="text" value="' + esc(CURRENT_USER.id) + '" disabled></div>' +
      '<div class="form-error" role="alert">' + esc(errMsg || '') + '</div>' +
      '<div class="actions"><button type="submit" class="btn">저장</button>' +
      '<button type="button" class="btn btn--secondary" data-action="cancel-profile">취소</button></div></form>';
    profileEl.querySelector('input').focus();
  }

  document.getElementById('profile-card').addEventListener('click', function (e) {
    if (e.target.closest('[data-action="edit-profile"]')) renderProfile(true);
    else if (e.target.closest('[data-action="cancel-profile"]')) renderProfile(false);
  });
  document.getElementById('profile-card').addEventListener('submit', function (e) {
    e.preventDefault();
    const f = e.target;
    const v = { name: f.elements.name.value.trim(), studentNo: f.elements.studentNo.value.trim(),
                dept: f.elements.dept.value.trim(), team: f.elements.team.value.trim() };
    if (!v.name || !v.dept || !v.team) { renderProfile(true, '이름, 소속 학과, 팀은 비워 둘 수 없습니다.'); return; }
    if (!/^\d{5,12}$/.test(v.studentNo)) { renderProfile(true, '학번은 숫자 5~12자리로 입력하세요.'); return; }
    state.profile = v;
    syncOwnerFields(state);
    saveState(state);
    renderTopbar();
    renderProfile(false);
    showToast('내 정보를 저장했습니다.');
  });
  renderProfile(false);

  function render() {
    const rows = allResources(state).filter(isMine);
    const daily = rows.reduce(function (sum, r) { return sum + resourceDailyCost(r); }, 0);
    const remaining = remainingCredit(state);
    const pct = Math.round((usedCreditTotal(state) / USER_QUOTA.maxCredit) * 100);
    document.getElementById('usage').innerHTML =
      '<div class="kv__row"><dt>사용 크레딧</dt><dd>' + fmt(usedCreditTotal(state)) + ' / ' +
        fmt(USER_QUOTA.maxCredit) + '</dd></div>' +
      '<div class="kv__row"><dt>잔여 크레딧</dt><dd>' + fmt(remaining) + '</dd></div>' +
      '<div class="kv__row"><dt>운영 중인 VM</dt><dd>' + rows.length + '대 (하루 ' + fmt(daily) + ' 크레딧)</dd></div>' +
      '<div class="meter' + (pct > 85 ? ' meter--warn' : '') + '"><span style="width:' + pct + '%"></span></div>';

    const list = document.getElementById('template-list');
    if (!state.templates.length) {
      list.innerHTML = '<p class="empty">저장한 템플릿이 없습니다. 추천 결과나 상세 설정 화면에서 "템플릿으로 저장"을 눌러 보세요.</p>';
      return;
    }
    list.innerHTML = state.templates.map(function (t) {
      const sum = computeSummary({ os: t.os, flavor: t.flavor, addons: t.addons, disk: t.disk, ttl: t.ttl,
                                   creditDelta: state.creditDelta });
      return '<div class="tpl"><div><div class="tpl__name">' + esc(t.name) + '</div>' +
        '<div class="tpl__sub">' + esc(osById(t.os).name) + ' · ' + sum.flavor.name + ' (' +
        specText(sum.flavor) + ') · ' + esc(addonNames(t.addons)) + ' · ' + sum.disk + 'GB SSD · ' + t.ttl + '일</div>' +
        '<div class="tpl__sub">하루 ' + fmt(sum.dailyCost) + ' / 총 ' + fmt(sum.totalCost) + ' 크레딧' +
        (sum.blocked ? ' <span class="over">(현재 잔여 크레딧으로는 생성 불가)</span>' : '') + '</div></div>' +
        '<div class="tpl__actions">' +
          '<button type="button" class="btn btn--sm" data-action="use" data-id="' + esc(t.id) + '">이 구성으로 시작</button>' +
          '<button type="button" class="btn btn--sm btn--secondary" data-action="adjust" data-id="' + esc(t.id) + '">세부 조정</button>' +
          '<button type="button" class="btn btn--sm btn--danger" data-action="delete" data-id="' + esc(t.id) + '">삭제</button>' +
        '</div></div>';
    }).join('');
  }

  function findTpl(id) { return state.templates.filter(function (t) { return t.id === id; })[0]; }

  document.getElementById('template-list').addEventListener('click', function (e) {
    const b = e.target.closest('[data-action]');
    if (!b) return;
    const tpl = findTpl(b.dataset.id);
    if (b.dataset.action === 'delete') {
      confirmDialog('템플릿을 삭제할까요', '"' + tpl.name + '" 템플릿이 삭제됩니다.', '삭제', function () {
        state.templates = state.templates.filter(function (t) { return t.id !== tpl.id; });
        saveState(state);
        render();
      });
      return;
    }
    applyTemplate(state, tpl);
    saveState(state);
    location.href = b.dataset.action === 'use' ? 'result.html' : 'builder.html';
  });

  document.getElementById('mypage-actions').addEventListener('click', function (e) {
    const b = e.target.closest('[data-action]');
    if (!b) return;
    if (b.dataset.action === 'logout') { logout(); location.href = 'login.html'; }
    if (b.dataset.action === 'reset') {
      confirmDialog('데모 데이터를 초기화할까요',
        '생성한 자원, 저장한 템플릿, 크레딧 사용 내역이 모두 처음 상태로 돌아갑니다.', '초기화', function () {
          try { localStorage.removeItem(STORAGE_KEY); } catch (err) { /* 무시 */ }
          location.reload();
        });
    }
  });

  /* --- 알림 설정 (프로토타입: 저장과 미리보기만. 실제 발송은 없음) --- */
  // 데모 도구: 가상 push와 실패 유발 (시연용)
  const demoSel = document.getElementById('demo-server'), demoMsg = document.getElementById('demo-msg');
  const demoBtn = document.getElementById('demo-push'), demoFail = document.getElementById('demo-fail');
  const targets = state.resources.filter(function (r) { return r.repo && canDo(r, CURRENT_USER.id, 'deploy'); });
  demoSel.innerHTML = targets.length ? targets.map(function (r) {
    return '<option value="' + esc(r.id) + '">' + esc(r.name) + ' (' + esc(r.id) + ')</option>'; }).join('')
    : '<option value="">저장소가 연결된 서버가 없습니다</option>';
  demoBtn.disabled = !targets.length;
  demoFail.checked = !!state.demo.forceFail;
  demoFail.addEventListener('change', function () { state.demo.forceFail = demoFail.checked; saveState(state); });
  demoBtn.addEventListener('click', function () {
    const r = state.resources.filter(function (x) { return x.id === demoSel.value; })[0];
    if (!r) return;
    const res = receivePush(state, r);
    saveState(state);
    updateBell();
    if (!res.ok) { demoMsg.textContent = res.msg; return; }
    if (res.pending) {
      demoMsg.textContent = 'push를 받았지만 배포는 보류되었습니다 (' + (r.status === 'stopped' ? '서버가 중지됨' : '배포 진행 중') + '). 서버를 시작하면 배포됩니다.';
      return;
    }
    demoMsg.textContent = 'push를 보냈습니다 (' + res.commit.commit + ' ' + res.commit.message + '). 배포가 시작되었습니다.';
    setTimeout(function () {
      const fresh = loadState();   // 시간이 지난 배포를 확정한다
      const t = fresh.resources.filter(function (x) { return x.id === r.id; })[0];
      const d = t && lastDeploy(t);
      demoFail.checked = !!fresh.demo.forceFail;
      state.demo.forceFail = fresh.demo.forceFail;
      updateBell();
      demoMsg.textContent = d ? '배포 #' + d.seq + ' 결과: ' + (d.status === 'success' ? '성공' : '실패') + '. 대시보드의 배포 탭에서 자세히 볼 수 있습니다.' : '';
    }, DEPLOY_POLICY.fakeDurationSec * 1000 + 300);
  });

  const notifForm = document.getElementById('notif-form');
  document.getElementById('notif-mail').textContent = mailOf(CURRENT_USER.id);
  Array.prototype.forEach.call(notifForm.querySelectorAll('input[type="checkbox"]'), function (i) {
    i.checked = !!state.notifications[i.name];
  });
  Array.prototype.forEach.call(notifForm.querySelectorAll('input[name="channel"]'), function (i) {
    i.checked = i.value === state.notifications.channel;
  });

  notifForm.addEventListener('change', function (e) {
    const t = e.target;
    if (t.name === 'channel') state.notifications.channel = t.value;
    else if (t.type === 'checkbox') state.notifications[t.name] = t.checked;
    else return;
    saveState(state);
    showToast('알림 설정을 저장했습니다.');
    if (!document.getElementById('mail-preview').hidden) renderMail();   // 받는 방법이 바뀌면 안내 문구도 갱신
  });

  function renderMail() {
    const m = buildExpiryMail(state, Date.now());
    const viaMail = state.notifications.channel === 'mail';
    document.getElementById('mail-preview').innerHTML =
      (m.sample ? '<div class="mail__flag">3일 안에 만료되는 내 서버가 없어 예시 데이터로 만든 미리보기입니다.</div>' : '') +
      (viaMail ? '' : '<div class="mail__flag">현재 "포털 알림만"으로 설정되어 있어 메일은 발송되지 않습니다. 아래는 "학교 메일"로 받을 때의 모습입니다.</div>') +
      '<div class="mail__head"><dl><dt>보낸사람</dt><dd>' + esc(m.from) + '</dd>' +
      '<dt>받는사람</dt><dd>' + esc(m.to) + '</dd><dt>제목</dt><dd><strong>' + esc(m.subject) + '</strong></dd></dl></div>' +
      '<div class="mail__body"><p>' + esc(m.greeting) + '</p>' +
      '<p>아래 서버의 사용 기한이 ' + esc(m.endText) + '에 끝납니다.</p>' +
      '<div class="mail__facts"><div><span>서버</span><span>' + esc(m.serverName) + ' (' + esc(m.serverId) + ')</span></div>' +
      '<div><span>사양</span><span>' + esc(m.spec) + '</span></div>' +
      '<div><span>남은 기한</span><span>' + esc(m.left) + '</span></div></div>' +
      '<p>' + esc(LIFECYCLE_POLICY.expiryAction) + '<br>계속 쓰시려면 포털에서 기한을 연장해 주세요.</p>' +
      '<a class="mail__btn" href="dashboard.html">기한 연장하기</a></div>';
  }

  document.getElementById('notif-card').addEventListener('click', function (e) {
    const b = e.target.closest('[data-action="mail-preview"]');
    if (!b) return;
    const box = document.getElementById('mail-preview');
    const open = box.hidden;   // 숨겨져 있으면 이번 클릭으로 펼친다
    if (open) renderMail();
    box.hidden = !open;
    b.setAttribute('aria-expanded', String(open));
    b.textContent = open ? '알림 예시 닫기' : '알림 예시 보기';
  });

  render();
}

/* ---------- help (도움말) ---------- */

// 도움말은 정책 숫자를 하드코딩하지 않는다. catalog.js의 상수를 읽어 그리므로,
// 상수를 바꾸면 도움말이 자동으로 따라가고 문서와 화면이 어긋나지 않는다.
const ACTION_LABELS = {
  access: '접속 정보 보기', extend: '기한 연장', stopStart: '중지 / 시작', resize: '사양 변경',
  restart: '재시작', reissue: '초기 비밀번호 재발급', tags: '태그 편집', disk: '디스크 확장', schedule: '자동 중지 예약', rename: '이름 변경', clone: '복제 (같은 구성으로 새 서버)',
  repo: '저장소 연결 / 해제', deploy: '배포 / 롤백', deployView: '배포 이력 보기', project: '프로젝트 변경',
  return: '반납', team: '팀원 관리 / 소유권 이전'
};

function initHelpPage() {
  const L = LIFECYCLE_POLICY;
  const stopPct = Math.round(L.stoppedCostRatio * 100);
  const li = function (arr) { return '<ul>' + arr.map(function (t) { return '<li>' + t + '</li>'; }).join('') + '</ul>'; };

  const faq = [
    ['서버에 접속이 안 됩니다', li([
      '학교 네트워크에 연결되어 있는지 확인하세요.',
      '명령어를 처음부터 끝까지 한 줄로 복사했는지 확인하세요.',
      '생성 직후에는 켜지는 데 1분 정도 걸릴 수 있습니다.',
      '서버 상세 패널의 "접속" 탭에서 같은 명령어를 다시 확인할 수 있고, 작업 바의 "재시작"으로 서버를 다시 켤 수도 있습니다.'])],
    ['배포는 어떻게 되나요', '<p>서버에 코드 저장소(GitHub)를 연결하면, 정한 브랜치에 push할 때마다 서버에 자동으로 반영되는 흐름을 보여 줍니다. ' +
      '서버 상세 패널의 "배포" 탭에서 연결 상태, 지금 배포된 버전, 배포 이력을 볼 수 있고 "지금 배포"와 "롤백"도 할 수 있습니다. ' +
      '<b>프로토타입에서는 실제 빌드나 GitHub 연동 없이 화면으로만 동작합니다.</b> 연결과 배포는 소유자와 "' + esc(MEMBER_ROLES.manage.name) + '" 권한 팀원이 할 수 있습니다.</p>'],
    ['서버 위생 점수는 무엇인가요', '<p>서버를 잘 관리하고 있는지 4가지로 확인한 점수입니다. 대시보드 표와 서버 상세 패널에서 볼 수 있습니다.</p>' + li([
      '<b>팀원이 있음</b>: 혼자 관리하지 않도록 팀원을 추가했는지',
      '<b>태그가 있음</b>: 나중에 찾기 쉽게 태그를 붙였는지',
      '<b>자동 중지를 설정함</b>: 밤새 켜 두어 크레딧이 새지 않게 예약했는지 (중지 중인 서버는 통과)',
      '<b>사용 기한이 여유 있음</b>: 기한이 ' + L.warnBeforeHours + '시간 이상 남았는지',
      '점수가 낮아도 불이익은 없습니다. 개선할 곳을 알려 주는 참고용입니다.'])],
    ['프로젝트는 무엇인가요', '<p>서버 여러 대를 "캡스톤 3조"처럼 하나의 이름으로 묶는 기능입니다. 서버를 만들 때 정하거나 상세 패널의 "개요" 탭에서 바꿀 수 있고, 대시보드에서 "프로젝트별" 보기를 고르면 프로젝트마다 서버 수, 하루 요금, 함께 쓰는 사람을 한눈에 볼 수 있습니다.</p>'],
    ['배포가 실패했어요', li([
      '배포 탭의 이력에서 실패한 줄을 누르면 어느 단계(빌드, 테스트, 배포)에서 멈췄는지 로그가 펼쳐집니다.',
      '실패해도 서버에는 이전에 성공한 버전이 그대로 남아 있어 서비스는 멈추지 않습니다.',
      '문제가 있는 버전을 올렸다면 이력에서 이전 성공 버전을 골라 "롤백"하세요.',
      '서버가 중지되어 있으면 배포가 보류되고, 서버를 시작하면 최신 커밋으로 배포됩니다.'])],
    ['초기 비밀번호를 잊어버렸습니다', '<p>서버 상세 패널의 "비밀번호 재발급"을 누르면 새 임시 비밀번호가 접속 정보에 표시됩니다. ' +
      '이전 비밀번호는 더 이상 쓸 수 없고, 처음 접속한 뒤에는 반드시 비밀번호를 바꿔야 합니다. ' +
      '이 기능은 소유자와 "' + esc(MEMBER_ROLES.manage.name) + '" 권한 팀원이 쓸 수 있습니다.</p>'],
    ['크레딧이 부족합니다', '<p>배정된 크레딧은 학기당 ' + fmt(USER_QUOTA.maxCredit) + '입니다. 부족할 때는 다음을 해 볼 수 있습니다.</p>' + li([
      '쓰지 않는 서버는 <b>중지</b>하세요. 하루 요금이 ' + stopPct + '%로 줄고, 남은 기한만큼 차액이 돌아옵니다.',
      '더 이상 필요 없는 서버는 <b>반납</b>하면 남은 기한만큼 환불됩니다.',
      '사용 기간을 줄이거나 사양을 낮추면 총액이 줄어듭니다.',
      '그래도 부족하면 한도 초과 화면에서 <b>관리자 승인</b>을 요청할 수 있습니다.'])],
    ['사용 기한이 끝나면 어떻게 되나요', '<p>' + esc(L.expiryAction) + ' 기한이 ' + L.warnBeforeHours +
      '시간 이내로 남으면 대시보드에 경고가 표시되고, 기한 연장은 1회에 ' + L.extendDays + '일씩 할 수 있습니다.</p>'],
    ['팀원을 추가하고 싶습니다', '<p>내가 소유자인 서버는 서버 상세 패널의 "팀원" 탭에 있는 "팀원 관리"에서 학번이나 이름으로 팀원을 찾아 추가할 수 있습니다.</p>' + li([
      '<b>' + esc(MEMBER_ROLES.manage.name) + '</b>: ' + esc(MEMBER_ROLES.manage.desc),
      '<b>' + esc(MEMBER_ROLES.use.name) + '</b>: ' + esc(MEMBER_ROLES.use.desc),
      '반납과 팀원 관리는 소유자만 할 수 있습니다. 필요하면 팀원 중 한 명에게 소유권을 넘길 수 있습니다.'])],
    ['실수로 서버를 반납했습니다', '<p>반납한 서버는 대시보드 아래의 <b>휴지통</b>에서 ' + L.trashRetentionDays +
      '일간 복구할 수 있습니다. 반납할 때 환불받은 크레딧은 복구할 때 다시 차감되며, 잔액이 부족하면 복구할 수 없습니다. ' +
      L.trashRetentionDays + '일이 지나면 자동으로 삭제됩니다.</p>']
  ];
  document.getElementById('faq-list').innerHTML = faq.map(function (f) {
    return '<details><summary>' + esc(f[0]) + '</summary><div class="faq__a">' + f[1] + '</div></details>';
  }).join('');

  // 정책 요약
  const flavorRows = FLAVOR_RANK.map(function (id) {
    const f = FLAVORS[id];
    return '<tr><td>' + f.name + ' (' + esc(f.label) + ')</td><td>' + f.cpu + ' Core</td><td>' + f.ram + 'GB</td><td class="num">' + fmt(f.costPerDay) + '</td></tr>';
  }).join('');
  const addonRows = Object.keys(ADDONS).map(function (id) {
    const a = ADDONS[id];
    return '<tr><td>' + esc(a.name) + '</td><td>' + a.minRam + 'GB 이상</td><td class="num">' + fmt(a.costPerDay) + '</td></tr>';
  }).join('');
  const roles = ['use', 'manage', 'owner'];
  const roleHead = { use: MEMBER_ROLES.use.name, manage: MEMBER_ROLES.manage.name, owner: '소유자' };
  const permRows = Object.keys(ACTION_MIN_ROLE).map(function (a) {
    return '<tr><td>' + esc(ACTION_LABELS[a] || a) + '</td>' + roles.map(function (r) {
      return PERMISSION_RANK[r] >= PERMISSION_RANK[ACTION_MIN_ROLE[a]]
        ? '<td class="yes">가능</td>' : '<td class="no">\u2014</td>';
    }).join('') + '</tr>';
  }).join('');

  document.getElementById('policy').innerHTML =
    '<div class="policy">' +
    '<h3>크레딧과 쿼터</h3><table class="table"><tbody>' +
      '<tr><td>학기당 지급 크레딧</td><td class="num">' + fmt(USER_QUOTA.maxCredit) + '</td></tr>' +
      '<tr><td>서버 1대당 최대 RAM</td><td class="num">' + USER_QUOTA.maxRam + 'GB</td></tr></tbody></table>' +
    '<h3>요금표 (하루 기준, 크레딧)</h3><table class="table"><thead><tr><th>사양</th><th>CPU</th><th>RAM</th><th class="num">하루 요금</th></tr></thead><tbody>' + flavorRows + '</tbody></table>' +
    '<table class="table" style="margin-top:8px"><thead><tr><th>함께 설치할 도구</th><th>권장 RAM</th><th class="num">하루 요금</th></tr></thead><tbody>' + addonRows + '</tbody></table>' +
    '<table class="table" style="margin-top:8px"><thead><tr><th>디스크 (SSD)</th><th class="num">하루 요금</th></tr></thead><tbody>' + DISK_OPTIONS.map(function (gb) {
      return '<tr><td>' + (gb >= 1000 ? '1TB' : gb + 'GB') + (gb === DISK_INCLUDED_GB ? ' (기본 포함)' : '') + '</td><td class="num">' + (diskCostOf(gb) ? fmt(diskCostOf(gb)) : '0') + '</td></tr>';
    }).join('') + '</tbody></table>' +
    '<p class="muted-p" style="margin-top:6px">운영체제는 요금에 영향을 주지 않습니다. 총액 = (사양 요금 + 도구 요금 + 디스크 요금) &times; 사용 기간입니다. 디스크는 ' + DISK_INCLUDED_GB + 'GB까지 사양 요금에 포함되고, 늘리기만 할 수 있습니다.</p>' +
    '<h3>서버 생명주기</h3><table class="table"><tbody>' +
      '<tr><td>기한 연장</td><td>1회 ' + L.extendDays + '일</td></tr>' +
      '<tr><td>만료 임박 경고</td><td>남은 기한 ' + L.warnBeforeHours + '시간 미만</td></tr>' +
      '<tr><td>중지 중 요금</td><td>하루 요금의 ' + stopPct + '% (스토리지 점유분만 청구)</td></tr>' +
      '<tr><td>기한이 끝나면</td><td>' + esc(L.expiryAction) + '</td></tr>' +
      '<tr><td>반납한 서버</td><td>휴지통에서 ' + L.trashRetentionDays + '일간 복구 가능</td></tr>' +
      '<tr><td>배포 (시뮬레이션)</td><td>저장소를 연결하면 push할 때마다 자동 배포, 이력 최대 ' + DEPLOY_POLICY.historyLimit + '건 보관, 크레딧은 쓰지 않음</td></tr>' +
      '<tr><td>자동 중지 예약</td><td>정한 시간에 서버를 멈춰 크레딧 절약 (' + Object.keys(SCHEDULE_DAYS).map(function (k) { return SCHEDULE_DAYS[k]; }).join(', ') + ')</td></tr></tbody></table>' +
    '<h3>팀 서버 권한</h3><table class="table"><thead><tr><th>작업</th>' + roles.map(function (r) { return '<th>' + esc(roleHead[r]) + '</th>'; }).join('') +
      '</tr></thead><tbody>' + permRows + '</tbody></table></div>';

  // 문의
  const c = SUPPORT_CONTACT;
  document.getElementById('contact').innerHTML =
    '<dl class="contact"><dt>담당</dt><dd>' + esc(c.name) + '</dd><dt>메일</dt><dd class="mono">' + esc(c.email) + '</dd>' +
    '<dt>위치</dt><dd>' + esc(c.location) + '</dd><dt>운영 시간</dt><dd>' + esc(c.hours) + '</dd>' +
    '<dt>응답</dt><dd>' + esc(c.reply) + '</dd></dl>';
}

/* ---------- 진입 ---------- */

// 로그인 가드: 세션이 없으면 login.html, 이미 로그인했다면 login.html에서 설문으로 보낸다.
const PAGE = document.body.dataset.page;
let redirecting = false;
if (PAGE === 'login') {
  if (getSession()) { redirecting = true; location.replace('index.html'); }
} else if (!getSession()) {
  redirecting = true;
  location.replace('login.html');
}

document.addEventListener('DOMContentLoaded', function () {
  if (redirecting) return;
  renderTopbar();
  renderQuotaWidget();
  if (PAGE === 'login') initLoginPage();
  else if (PAGE === 'home') initHomePage();
  else if (PAGE === 'survey') initSurveyPage();
  else if (PAGE === 'builder') initBuilderPage();
  else if (PAGE === 'result') initResultPage();
  else if (PAGE === 'error') initErrorPage();
  else if (PAGE === 'dashboard') initDashboardPage();
  else if (PAGE === 'mypage') initMyPage();
  else if (PAGE === 'created') initCreatedPage();
  else if (PAGE === 'history') initHistoryPage();
  else if (PAGE === 'help') initHelpPage();
});
