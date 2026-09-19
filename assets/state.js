// 이 파일은 DOM에 접근하지 않는다.
const STORAGE_KEY = 'dku-dev-portal-state';
const LEGACY_STORAGE_KEY = 'dcube-portal-state';   // 이름을 바꾸기 전 저장 키. 있으면 한 번 옮겨 온다.

function defaultState() {
  return { os: 'ubuntu22', flavor: 'small', addons: [], disk: DISK_INCLUDED_GB, ttl: 7,
           surveyAnswers: null, resources: [], seeded: false, approvals: [],
           templates: [], creditDelta: 0, templateName: null, resourceName: '',
           lastCreatedId: null, profile: {}, history: null,
           trash: [], notifications: defaultNotifications(),
           hints: {}, cloneFrom: null, cloneOrigin: null,
           demo: { forceFail: false }, repoDraft: { url: '', branch: 'main' }, projectDraft: '' };
}

function loadRawState() {
  try {
    let raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {   // 이름 변경 전에 저장한 데이터가 있으면 새 키로 옮긴다
      const old = localStorage.getItem(LEGACY_STORAGE_KEY);
      if (old) { localStorage.setItem(STORAGE_KEY, old); localStorage.removeItem(LEGACY_STORAGE_KEY); raw = old; }
    }
    if (!raw) return defaultState();
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return defaultState();
    return Object.assign(defaultState(), parsed);
  } catch (e) {
    return defaultState();
  }
}

// 최초 1회 더미 자원을 state.resources로 옮긴다. seeded 플래그가 있어서
// 전부 반납한 뒤에도(빈 목록) 더미가 다시 주입되지 않는다.
function migrate(state) {
  if (!state.seeded) {
    const mine = state.resources.map(function (r) {
      return Object.assign({ owner: CURRENT_USER.id, ownerName: CURRENT_USER.name,
                             team: CURRENT_USER.team }, r);
    });
    state.resources = JSON.parse(JSON.stringify(DUMMY_RESOURCES)).concat(mine);
    // 이전 버전의 사양 변경 기록(changes)이 있으면 자원에 직접 반영한다.
    Object.keys(state.changes || {}).forEach(function (id) {
      const r = state.resources.filter(function (x) { return x.id === id; })[0];
      if (r) { r.flavor = state.changes[id].flavor; r.usage = state.changes[id].usage; }
    });
    delete state.changes;
    state.seeded = true;
  }
  state.resources.forEach(function (r) {
    if (r.status !== 'stopped') r.status = 'running';   // expiring은 저장하지 않고 계산한다
  });
  // v1.1: 이전 버전 저장 데이터에는 members/tags/trash/notifications가 없다.
  state.resources.forEach(function (r) {
    const dummy = DUMMY_RESOURCES.filter(function (d) { return d.id === r.id; })[0];
    if (!Array.isArray(r.members)) r.members = dummy ? JSON.parse(JSON.stringify(dummy.members)) : [];
    if (!Array.isArray(r.tags)) r.tags = dummy ? dummy.tags.slice() : [];
  });
  // v1.6: 배포(저장소 연결, 이력)와 데모 도구
  if (!state.demo) state.demo = { forceFail: false };
  if (!state.repoDraft) state.repoDraft = { url: '', branch: 'main' };
  if (typeof state.projectDraft !== 'string') state.projectDraft = '';
  const nowMs = Date.now();
  const fillDeploy = function (r) {
    const dummy = DUMMY_RESOURCES.filter(function (d) { return d.id === r.id; })[0];
    // 더미 자원은 저장소 정보가 '며칠 전에 연결' 형태로 들어 있으므로 시각으로 바꿔 준다.
    if (r.repo && r.repo.connectedDaysAgo !== undefined) {
      r.repo = { url: r.repo.url, branch: r.repo.branch,
                 connectedAt: nowMs - r.repo.connectedDaysAgo * DAY_MS, connectedBy: r.repo.connectedBy };
    } else if (r.repo === undefined) {
      r.repo = dummy && dummy.repo ? { url: dummy.repo.url, branch: dummy.repo.branch,
        connectedAt: nowMs - dummy.repo.connectedDaysAgo * DAY_MS, connectedBy: dummy.repo.connectedBy } : null;
    }
    if (!Array.isArray(r.deploys)) {
      r.deploys = (dummy && dummy.deploySeed ? dummy.deploySeed : []).map(function (d) {
        return { id: 'dp' + d.seq, seq: d.seq, at: nowMs - d.agoHours * 3600000, commit: d.commit, message: d.message,
                 author: d.author, status: d.status, durationSec: DEPLOY_POLICY.fakeDurationSec, trigger: d.trigger,
                 rollbackOf: null, failedStage: d.failedStage || null };
      });
    }
    if (r.pendingDeploy === undefined) r.pendingDeploy = null;
    if (typeof r.project !== 'string') r.project = dummy && dummy.project ? dummy.project : '';   // v1.7: 프로젝트
    delete r.deploySeed;
  };
  state.resources.forEach(fillDeploy);
  (state.trash || []).forEach(fillDeploy);
  if (!state.hints) state.hints = {};   // v1.5: 닫은 안내, 체크리스트 진행 상황, 읽은 알림
  // v1.4: 디스크와 자동 중지 예약
  if (!state.disk) state.disk = DISK_INCLUDED_GB;
  state.resources.forEach(function (r) {
    const dummy = DUMMY_RESOURCES.filter(function (d) { return d.id === r.id; })[0];
    if (!r.disk) r.disk = dummy ? dummy.disk : DISK_INCLUDED_GB;
    if (r.schedule === undefined) r.schedule = dummy && dummy.schedule ? Object.assign({}, dummy.schedule) : null;
  });
  (state.templates || []).forEach(function (t) { if (!t.disk) t.disk = DISK_INCLUDED_GB; });
  (state.trash || []).forEach(function (t) { if (!t.disk) t.disk = DISK_INCLUDED_GB; });
  if (!Array.isArray(state.trash)) state.trash = [];
  state.notifications = Object.assign(defaultNotifications(), state.notifications || {});
  purgeExpiredTrash(state, Date.now());
  syncOwnerFields(state);
  if (!state.history) seedHistory(state);
  else rebaseSeedHistory(state);
  return state;
}

// 프로필(이름, 팀 등)은 state.profile이 CURRENT_USER를 덮어쓴다.
function currentUser(state) {
  return Object.assign({}, CURRENT_USER, state && state.profile ? state.profile : {});
}

// 내 자원의 소유자 표기를 현재 프로필과 맞춘다 (프로필 수정, 이전 데이터 모두 대응).
function syncOwnerFields(state) {
  const u = currentUser(state);
  state.resources.forEach(function (r) {
    if (r.owner === CURRENT_USER.id) { r.ownerName = u.name; r.team = u.team; }
    (r.members || []).forEach(function (m) { if (m.id === CURRENT_USER.id) m.name = u.name; });
  });
}

function loadState() {
  const s = migrate(loadRawState());
  if (settleDeploys(s, Date.now())) saveState(s);   // 다른 화면에서 시작해 둔 배포를 끝난 시각 기준으로 확정한다
  return s;
}

function saveState(state) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (e) {
    // 저장소 사용 불가 시 무시 (현재 페이지 동작에는 영향 없음)
  }
}

// 도구 답변(문자열 또는 배열, 'none' 포함)을 도구 id 배열로 정리한다.
function surveyAddons(answers) {
  const raw = answers && answers.middleware;
  if (!raw) return [];
  return (Array.isArray(raw) ? raw : [raw]).filter(function (id, i, a) {
    return ADDONS[id] && a.indexOf(id) === i;
  });
}

// 도구를 함께 설치할 때 필요한 RAM: 가장 큰 권장 RAM + (추가 도구 1개당 ADDON_EXTRA_RAM)
function requiredRam(addonIds) {
  if (!addonIds.length) return 0;
  const max = addonIds.reduce(function (m, id) { return Math.max(m, ADDONS[id].minRam); }, 0);
  return max + (addonIds.length - 1) * ADDON_EXTRA_RAM;
}

// 주어진 RAM 이상인 가장 작은 사양 (없으면 가장 큰 사양)
function minFlavorForRam(ram) {
  const hit = FLAVOR_RANK.filter(function (id) { return FLAVORS[id].ram >= ram; })[0];
  return hit || FLAVOR_RANK[FLAVOR_RANK.length - 1];
}

// 계산의 유일한 출처
function computeSummary(state) {
  const flavor = FLAVORS[state.flavor];
  const addons = state.addons.map(function (id) { return ADDONS[id]; });
  const disk = state.disk || DISK_INCLUDED_GB;
  const dailyCost = addons.reduce(function (sum, a) { return sum + a.costPerDay; },
                                  flavor.costPerDay) + diskCostOf(disk);
  const totalCost = dailyCost * state.ttl;
  const remaining = remainingCredit(state);
  const warnings = [];

  addons.forEach(function (a) {
    if (flavor.ram < a.minRam) {
      warnings.push({
        level: 'warn',
        msg: a.name + '는 ' + a.minRam + 'GB 이상 권장 (현재 ' + flavor.ram + 'GB)'
      });
    }
  });

  const needRam = requiredRam(state.addons);
  if (state.addons.length > 1 && flavor.ram < needRam && !warnings.length) {
    warnings.push({
      level: 'warn',
      msg: '도구 ' + state.addons.length + '개를 함께 쓰려면 ' + needRam + 'GB 이상 권장 (현재 ' + flavor.ram + 'GB)'
    });
  }

  if (totalCost > remaining) {
    warnings.push({
      level: 'block',
      msg: '잔여 크레딧 부족 (필요 ' + totalCost.toLocaleString() +
           ' / 보유 ' + remaining.toLocaleString() + ')'
    });
  }

  if (flavor.ram > USER_QUOTA.maxRam) {
    warnings.push({
      level: 'block',
      msg: 'RAM 쿼터 ' + USER_QUOTA.maxRam + 'GB 초과'
    });
  }

  const blocked = warnings.some(function (w) { return w.level === 'block'; });

  return { flavor: flavor, addons: addons, disk: disk, diskCost: diskCostOf(disk), dailyCost: dailyCost,
           totalCost: totalCost, remaining: remaining,
           warnings: warnings, blocked: blocked };
}

// 설문 답변 -> 추천 구성.
// purpose와 scale이 다른 사양을 가리키면 FLAVOR_RANK 기준으로 더 높은 쪽을 선택한다.
// 반환값의 purposeFlavor / scaleFlavor / conflict는 result.html "추천 이유" 문장용.
function recommendFlavor(answers) {
  const purposeFlavor = SURVEY_RULES.purpose[answers.purpose];
  const scaleFlavor = SURVEY_RULES.scale[answers.scale];
  const conflict = purposeFlavor !== scaleFlavor;
  const baseFlavor = FLAVOR_RANK.indexOf(purposeFlavor) >= FLAVOR_RANK.indexOf(scaleFlavor)
    ? purposeFlavor : scaleFlavor;
  const addons = surveyAddons(answers);
  // 고른 도구가 들어갈 만큼 RAM이 부족하면 사양을 한 단계 이상 올려 추천한다.
  const toolFlavor = addons.length ? minFlavorForRam(requiredRam(addons)) : null;
  const raised = !!toolFlavor && FLAVOR_RANK.indexOf(toolFlavor) > FLAVOR_RANK.indexOf(baseFlavor);
  const flavor = raised ? toolFlavor : baseFlavor;
  return { os: answers.os || 'ubuntu22', flavor: flavor, addons: addons, ttl: Number(answers.ttl),
           disk: recommendDisk(answers),
           purposeFlavor: purposeFlavor, scaleFlavor: scaleFlavor, conflict: conflict,
           baseFlavor: baseFlavor, toolFlavor: toolFlavor, raised: raised, needRam: requiredRam(addons) };
}

// 설문 답변 -> 추천 디스크(GB)
function recommendDisk(answers) {
  const a = (SURVEY_DISK.purpose[answers.purpose] || DISK_INCLUDED_GB);
  const b = (SURVEY_DISK.scale[answers.scale] || DISK_INCLUDED_GB);
  return Math.max(a, b);
}

// 생성 화면에 적어 둔 저장소가 올바르면 연결 정보로 만든다 (비었거나 형식이 틀리면 null)
function draftRepo(state) {
  const d = state.repoDraft;
  if (!d || !d.url) return null;
  const u = validateRepoUrl(d.url), b = validateBranch(d.branch || 'main');
  return u.ok && b.ok ? { url: u.url, branch: b.branch, connectedAt: Date.now(), connectedBy: CURRENT_USER.id } : null;
}

// 생성 요청 -> 자원 레코드 (dashboard 행 형식은 DUMMY_RESOURCES와 동일 + 비용 필드)
function createResource(state) {
  const s = computeSummary(state);
  // 반납으로 번호가 재사용되지 않도록 더미 자원의 ID까지 포함해 최대값을 잡는다.
  const maxNo = state.resources.concat(DUMMY_RESOURCES).reduce(function (m, r) {
    return Math.max(m, parseInt(r.id.replace(/\D/g, ''), 10) || 0);
  }, 0);
  const n = state.resources.filter(function (r) { return r.owner === CURRENT_USER.id; }).length;
  return {
    id: 'vm-' + String(maxNo + 1).padStart(4, '0'),
    name: (state.resourceName || '').trim() || '신규 환경 ' + (n + 1),
    os: state.os, flavor: state.flavor, addons: state.addons.slice(), disk: state.disk || DISK_INCLUDED_GB,
    schedule: null,
    project: cleanProject(state.projectDraft), repo: draftRepo(state), deploys: [], pendingDeploy: null, clonedFrom: state.cloneOrigin || null,
    owner: CURRENT_USER.id, ownerName: currentUser(state).name, team: currentUser(state).team,
    members: [], tags: [],
    usage: Math.floor(Math.random() * 41),      // 0~40, 생성 시 한 번만 정해 저장한다
    ttlLeftHours: state.ttl * 24, status: 'running',
    cost: s.totalCost
  };
}

// 화면에 그릴 자원 목록. 더미는 migrate()에서 이미 state.resources로 옮겨졌다.
function allResources(state) { return state.resources; }

function nextFlavor(flavorId) {
  const i = FLAVOR_RANK.indexOf(flavorId);
  return i >= 0 && i < FLAVOR_RANK.length - 1 ? FLAVOR_RANK[i + 1] : null;
}

function usedCreditTotal(state) {
  return USER_QUOTA.usedCredit + (state.creditDelta || 0);
}

function remainingCredit(state) {
  return USER_QUOTA.maxCredit - usedCreditTotal(state);
}

// 디스크 추가 요금 (기본 포함분을 넘는 GB만)
function diskCostOf(gb) {
  return Math.max(0, (gb || DISK_INCLUDED_GB) - DISK_INCLUDED_GB) * DISK_COST_PER_GB_DAY;
}

function dailyCostOf(flavorId, addonIds, disk) {
  return addonIds.reduce(function (sum, id) { return sum + ADDONS[id].costPerDay; },
                         FLAVORS[flavorId].costPerDay) + diskCostOf(disk);
}

function resourceIp(id) {
  const n = parseInt(id.replace(/\D/g, ''), 10) || 0;
  return '10.12.4.' + (10 + (n % 200));
}

// 사양 변경(증설/축소) 정산. amount > 0 이면 추가 결제, < 0 이면 환불.
// 남은 기한(ttlLeftHours)만큼의 일일 요금 차액으로 계산한다.
function computeChange(state, r, targetId) {
  const from = FLAVORS[r.flavor], to = FLAVORS[targetId];
  const fromDaily = dailyCostOf(r.flavor, r.addons, r.disk);
  const toDaily = dailyCostOf(targetId, r.addons, r.disk);
  const days = r.ttlLeftHours / 24;
  const amount = Math.round((toDaily - fromDaily) * days);
  const remaining = remainingCredit(state);
  const newUsage = Math.min(100, Math.round(r.usage * from.ram / to.ram));
  const warnings = [];

  if (to.ram < from.ram) {
    r.addons.forEach(function (id) {
      if (to.ram < ADDONS[id].minRam) {
        warnings.push({ level: 'block',
          msg: ADDONS[id].name + '는 ' + ADDONS[id].minRam + 'GB 이상이 필요해 ' +
               to.name + '(' + to.ram + 'GB)로 낮출 수 없습니다' });
      }
    });
    if (newUsage >= 90) {
      warnings.push({ level: 'warn',
        msg: '사양을 낮추면 메모리 사용량이 약 ' + Math.round(r.usage * from.ram / to.ram) +
             '%가 되어 작업이 느려지거나 중단될 수 있습니다' });
    }
  }
  if (to.ram > USER_QUOTA.maxRam) {
    warnings.push({ level: 'block', msg: 'RAM 쿼터 ' + USER_QUOTA.maxRam + 'GB 초과' });
  }
  if (amount > remaining) {
    warnings.push({ level: 'block',
      msg: '잔여 크레딧 부족 (필요 ' + amount.toLocaleString() + ' / 보유 ' + remaining.toLocaleString() + ')' });
  }

  return { fromDaily: fromDaily, toDaily: toDaily, dailyDiff: toDaily - fromDaily,
           days: days, amount: amount, remaining: remaining,
           newRemaining: remaining - amount, newUsage: newUsage,
           warnings: warnings,
           blocked: warnings.some(function (w) { return w.level === 'block'; }) };
}

// 설문 진행 중 미리보기용. 아직 답하지 않은 항목은 기본값(Small, 7일)을 가정한다.
function simulateSurvey(answers, base) {
  const picks = [SURVEY_RULES.purpose[answers.purpose], SURVEY_RULES.scale[answers.scale]]
    .filter(Boolean);
  const addons = surveyAddons(answers);
  const withTools = addons.length ? picks.concat(minFlavorForRam(requiredRam(addons))) : picks;
  const flavor = withTools.length
    ? withTools.reduce(function (a, b) {
        return FLAVOR_RANK.indexOf(a) >= FLAVOR_RANK.indexOf(b) ? a : b;
      })
    : 'small';
  return {
    state: { os: answers.os || 'ubuntu22', flavor: flavor, addons: addons,
             disk: recommendDisk(answers),
             ttl: answers.ttl ? Number(answers.ttl) : 7,
             creditDelta: base.creditDelta || 0 },
    assumedFlavor: picks.length === 0,
    assumedTtl: !answers.ttl,
    raisedByTools: addons.length > 0 && flavor !== (picks.length ? picks.reduce(function (a, b) {
      return FLAVOR_RANK.indexOf(a) >= FLAVOR_RANK.indexOf(b) ? a : b;
    }) : 'small')
  };
}

/* ---------- 템플릿 ---------- */

function defaultTemplateName(state) {
  return FLAVORS[state.flavor].name +
    state.addons.map(function (id) { return ' + ' + ADDONS[id].name.replace(/^Apache /, '').replace(/ [\d.]+$/, ''); }).join('') +
    ' \u00B7 ' + state.ttl + '일';
}

function makeTemplate(state, name) {
  return { id: 'tpl-' + Date.now(), name: name, os: state.os, flavor: state.flavor,
           addons: state.addons.slice(), disk: state.disk || DISK_INCLUDED_GB, ttl: state.ttl };
}

function applyTemplate(state, tpl) {
  state.os = tpl.os; state.flavor = tpl.flavor; state.addons = tpl.addons.slice();
  state.disk = tpl.disk || DISK_INCLUDED_GB;
  state.ttl = tpl.ttl; state.surveyAnswers = null; state.templateName = tpl.name;
}

/* ---------- 세션 (프로토타입용 모의 로그인) ---------- */

const SESSION_KEY = 'dku-dev-portal-session';

// 로그인 세션은 탭이 살아 있는 동안만 유지한다(sessionStorage). 브라우저를 새로 켜거나 새 탭에서 열면 로그인 화면부터 시작한다.
// 이전 버전이 localStorage에 남긴 세션은 쓰지 않고 지운다.
function getSession() {
  try { localStorage.removeItem(SESSION_KEY); } catch (e) { /* 무시 */ }
  try { return JSON.parse(sessionStorage.getItem(SESSION_KEY)); } catch (e) { return null; }
}
function login(id, pw) {
  if (id !== DEMO_ACCOUNT.id || pw !== DEMO_ACCOUNT.pw) return false;
  try { sessionStorage.setItem(SESSION_KEY, JSON.stringify({ id: id })); } catch (e) { return false; }
  return true;
}
function logout() {
  try { sessionStorage.removeItem(SESSION_KEY); } catch (e) { /* 무시 */ }
}

/* ---------- 자원 생명주기 ---------- */

// 화면에 보이는 상태. 우선순위: stopped > restarting > expiring > running
function resourceStatus(r) {
  if (r.status === 'stopped') return 'stopped';
  if (r.restartingUntil && r.restartingUntil > Date.now()) return 'restarting';
  return r.ttlLeftHours < LIFECYCLE_POLICY.warnBeforeHours ? 'expiring' : 'running';
}

// 일일 요금. 중지 상태에서는 stoppedCostRatio를 곱해 올린다 (정수 연산으로 부동소수점 오차 방지).
function resourceDailyCost(r) {
  const base = dailyCostOf(r.flavor, r.addons, r.disk);
  if (r.status !== 'stopped') return base;
  return Math.ceil(base * Math.round(LIFECYCLE_POLICY.stoppedCostRatio * 100) / 100);
}

// 기한 연장 비용. 호출부에서 remainingCredit()과 비교해 거부 여부를 정한다.
function extendCost(r, days) { return resourceDailyCost(r) * days; }

// 중지/시작 시 남은 기한만큼의 요금 차액 (중지하면 환불, 시작하면 같은 금액을 다시 차감)
function stopDelta(r) {
  const base = dailyCostOf(r.flavor, r.addons, r.disk);
  const stopped = Math.ceil(base * Math.round(LIFECYCLE_POLICY.stoppedCostRatio * 100) / 100);
  return { base: base, stopped: stopped, days: r.ttlLeftHours / 24,
           amount: Math.round((base - stopped) * r.ttlLeftHours / 24) };
}

// 반납 시 돌려받는 크레딧 (남은 기한 x 현재 일일 요금)
function returnRefund(r) {
  return Math.round(resourceDailyCost(r) * r.ttlLeftHours / 24);
}

/* ---------- 관리자 승인 요청 (데모: 일정 시간 뒤 자동 승인) ---------- */

function approvalKey(a) {
  return [a.os, a.flavor, a.addons.join(','), a.disk || DISK_INCLUDED_GB, a.ttl].join('|');
}

function findApproval(state, cfg) {
  const key = approvalKey(cfg);
  return state.approvals.filter(function (a) {
    return (a.status === 'pending' || a.status === 'approved') && approvalKey(a) === key;
  })[0];
}

function requestApproval(state) {
  const s = computeSummary(state);
  const a = { id: 'apr-' + Date.now(), requestedAt: Date.now(), os: state.os,
              flavor: state.flavor, addons: state.addons.slice(), disk: state.disk || DISK_INCLUDED_GB, ttl: state.ttl,
              name: state.resourceName || '', totalCost: s.totalCost, status: 'pending' };
  state.approvals.push(a);
  return a;
}

// 대기 시간이 지난 요청을 승인 상태로 바꾼다. 바뀐 게 있으면 true.
function refreshApprovals(state, now) {
  let changed = false;
  state.approvals.forEach(function (a) {
    if (a.status === 'pending' && now - a.requestedAt >= LIFECYCLE_POLICY.approvalDemoDelaySec * 1000) {
      a.status = 'approved';
      changed = true;
    }
  });
  return changed;
}

/* ---------- 크레딧 사용 내역 ---------- */

// 크레딧이 움직이는 모든 곳은 이 함수를 거친다.
// charge > 0: 차감(사용), charge < 0: 환불 또는 추가 지급. 이력의 change는 잔액 기준 증감이라 부호가 반대다.
function applyCredit(state, type, r, charge) {
  state.creditDelta = (state.creditDelta || 0) + charge;
  if (!state.history) state.history = [];
  state.history.push({
    id: 'h-' + Date.now() + '-' + state.history.length,
    at: Date.now(), type: type,
    resourceId: r ? r.id : '', resourceName: r ? r.name : '',
    change: -charge, balance: remainingCredit(state)
  });
}

// 최초 진입 시 과거 사용 내역을 채워 둔다. 마지막 잔액이 USER_QUOTA 기준 잔여와 맞아떨어진다.
function seedHistory(state) {
  const DAY = 86400000, now = Date.now();
  const past = [
    { d: 40, type: 'initial', id: '', name: '', change: USER_QUOTA.maxCredit },
    { d: 21, type: 'create', id: 'vm-0310', name: '지능형 시스템 실습 서버', change: -30000 },
    { d: 14, type: 'create', id: 'vm-0339', name: '데이터 마이닝 과제 서버', change: -28300 },
    { d: 7,  type: 'create', id: 'vm-0451', name: '네트워크 지연율 분석 테스트용', change: -21000 },
    { d: 3,  type: 'create', id: 'vm-0388', name: '데이터베이스 과제 제출용', change: -25200 },
    { d: 2,  type: 'create', id: 'vm-0417', name: '소프트웨어학과 캡스톤 3조 백엔드', change: -45500 }
  ];
  let bal = 0;
  state.history = past.map(function (h, i) {
    bal += h.change;
    return { id: 'h-seed-' + i, at: now - h.d * DAY, type: h.type, resourceId: h.id,
             resourceName: h.name, change: h.change, balance: bal };
  });
  // 이전 버전에서 넘어온 정산 내역(creditDelta)이 있으면 한 줄로 합쳐서 잔액을 맞춘다.
  if (state.creditDelta) {
    state.history.push({ id: 'h-legacy', at: now, type: 'legacy', resourceId: '',
                         resourceName: '이전 사용 기록', change: -state.creditDelta,
                         balance: remainingCredit(state) });
  }
}

// 지급 크레딧(USER_QUOTA.maxCredit)이 바뀌면 이미 저장된 시드 내역의 잔액도 같은 만큼 옮긴다.
function rebaseSeedHistory(state) {
  const first = state.history[0];
  if (!first || first.id !== 'h-seed-0' || first.change === USER_QUOTA.maxCredit) return;
  const diff = USER_QUOTA.maxCredit - first.change;
  first.change = USER_QUOTA.maxCredit;
  state.history.forEach(function (h) { h.balance += diff; });
}

/* ================================================================
   v1.1: 팀 공유 / 권한 / 휴지통 / 재시작 / 태그 / 알림
   (이 아래는 모두 순수 로직이다. DOM에 접근하지 않는다.)
   ================================================================ */

const DAY_MS = 86400000;

function defaultNotifications() {
  return { expire3d: true, expire1d: true, lowCredit: true, unresponsive: false, deployFail: true, channel: 'mail' };
}

/* ---------- 권한 ---------- */

const PERMISSION_RANK = { none: 0, use: 1, manage: 2, owner: 3 };

// 'owner' | 'manage' | 'use' | 'none'
function permissionOf(resource, userId) {
  if (!resource) return 'none';
  if (resource.owner === userId) return 'owner';
  const m = (resource.members || []).filter(function (x) { return x.id === userId; })[0];
  return m && MEMBER_ROLES[m.role] ? m.role : 'none';
}

// 작업(ACTION_MIN_ROLE의 키)을 할 수 있는지
function canDo(resource, userId, action) {
  const need = ACTION_MIN_ROLE[action];
  if (!need) return false;
  return PERMISSION_RANK[permissionOf(resource, userId)] >= PERMISSION_RANK[need];
}

// 내가 오너이거나 팀원인 자원 ('우리 팀' 필터)
function isTeamResource(resource, userId) {
  return permissionOf(resource, userId) !== 'none';
}

function personById(id) {
  return DIRECTORY.filter(function (p) { return p.id === id; })[0] || null;
}

function mailOf(userId) { return userId + '@dku.edu'; }

/* ---------- 변동 없는 이력 (팀, 재시작, 태그 등) ---------- */

// 크레딧 변동이 없는 작업도 History에 남긴다. change는 0, detail은 보조 설명.
function logEvent(state, type, r, detail) {
  if (!state.history) state.history = [];
  state.history.push({
    id: 'h-' + Date.now() + '-' + state.history.length,
    at: Date.now(), type: type,
    resourceId: r ? r.id : '', resourceName: r ? r.name : '',
    change: 0, balance: remainingCredit(state), detail: detail || ''
  });
}

/* ---------- 팀원 관리 ---------- */

// 검색어 2자 이상일 때만 결과를 준다. already: 이미 소유자이거나 팀원.
function searchDirectory(query, resource) {
  const q = (query || '').trim().toLowerCase();
  if (q.length < 2) return [];
  return DIRECTORY.filter(function (p) {
    return p.studentNo.indexOf(q) !== -1 || p.name.toLowerCase().indexOf(q) !== -1 ||
           p.id.toLowerCase().indexOf(q) !== -1;
  }).map(function (p) {
    const already = resource.owner === p.id ||
      resource.members.some(function (m) { return m.id === p.id; });
    return { person: p, already: already };
  });
}

function addMember(state, resource, personId, role) {
  const p = personById(personId);
  if (!p || !MEMBER_ROLES[role]) return false;
  if (resource.owner === p.id || resource.members.some(function (m) { return m.id === p.id; })) return false;
  resource.members.push({ id: p.id, name: p.name, role: role });
  logEvent(state, 'team_add', resource, p.name + ' (' + MEMBER_ROLES[role].name + ')');
  return true;
}

function removeMember(state, resource, memberId) {
  const m = resource.members.filter(function (x) { return x.id === memberId; })[0];
  if (!m) return false;
  resource.members = resource.members.filter(function (x) { return x.id !== memberId; });
  logEvent(state, 'team_remove', resource, m.name);
  return true;
}

function setMemberRole(state, resource, memberId, role) {
  const m = resource.members.filter(function (x) { return x.id === memberId; })[0];
  if (!m || !MEMBER_ROLES[role] || m.role === role) return false;
  m.role = role;
  logEvent(state, 'team_role', resource, m.name + ' \u2192 ' + MEMBER_ROLES[role].name);
  return true;
}

// 팀원 중 한 명에게 서버를 넘긴다. 기존 소유자는 관리 권한 팀원으로 남는다. 되돌릴 수 없다.
function transferOwnership(state, resource, newOwnerId) {
  const m = resource.members.filter(function (x) { return x.id === newOwnerId; })[0];
  if (!m) return false;
  const oldOwner = { id: resource.owner, name: resource.ownerName, role: 'manage' };
  resource.members = resource.members.filter(function (x) { return x.id !== newOwnerId; });
  resource.members.push(oldOwner);
  resource.owner = m.id;
  resource.ownerName = m.name;
  logEvent(state, 'transfer', resource, oldOwner.name + ' \u2192 ' + m.name);
  return true;
}

/* ---------- 휴지통 (반납한 서버를 일정 기간 복구할 수 있다) ---------- */

// 반납 시: 목록에서 빼서 휴지통으로. 환불(applyCredit)은 호출부에서 처리한다.
function moveToTrash(state, r, now) {
  state.resources = state.resources.filter(function (x) { return x.id !== r.id; });
  state.trash.push(Object.assign({}, r, {
    deletedAt: now,
    restoreUntil: now + LIFECYCLE_POLICY.trashRetentionDays * DAY_MS
  }));
}

function trashDaysLeft(t, now) {
  return Math.max(0, Math.ceil((t.restoreUntil - now) / DAY_MS));
}

// 복구할 때 다시 차감하는 크레딧 (반납 때 돌려받은 금액과 같은 계산)
function restoreCost(t) { return returnRefund(t); }

// 휴지통 -> 목록. 크레딧 재차감(applyCredit)은 호출부에서 처리한다.
function restoreFromTrash(state, id) {
  const t = state.trash.filter(function (x) { return x.id === id; })[0];
  if (!t) return null;
  state.trash = state.trash.filter(function (x) { return x.id !== id; });
  const r = Object.assign({}, t);
  delete r.deletedAt;
  delete r.restoreUntil;
  state.resources.push(r);
  return r;
}

function purgeTrashItem(state, id) {
  const t = state.trash.filter(function (x) { return x.id === id; })[0];
  state.trash = state.trash.filter(function (x) { return x.id !== id; });
  return t || null;
}

// 복구 기한이 지난 항목을 지운다. 지운 개수를 반환.
function purgeExpiredTrash(state, now) {
  const before = state.trash.length;
  state.trash = state.trash.filter(function (t) { return t.restoreUntil > now; });
  return before - state.trash.length;
}

/* ---------- 재시작 / 비밀번호 재발급 ---------- */

// 상태를 잠시 '재시작 중'으로 바꾼다. resourceStatus()가 restartingUntil로 판단한다.
function startRestart(state, r, now) {
  r.restartingUntil = now + LIFECYCLE_POLICY.restartSeconds * 1000;
  logEvent(state, 'restart', r, '');
}

// dku- + 영숫자 8자
function generateTempPassword() {
  const chars = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = '';
  for (let i = 0; i < 8; i++) out += chars.charAt(Math.floor(Math.random() * chars.length));
  return 'dku-' + out;
}

function reissuePassword(state, r) {
  r.tempPassword = generateTempPassword();
  r.tempPasswordAt = Date.now();
  logEvent(state, 'password', r, '');
  return r.tempPassword;
}

/* ---------- 태그 ---------- */

// 미리 정의된 태그 중 선택한 것 + 직접 입력 1개 (최대 20자). 중복은 제거한다.
function normalizeTags(selectedPresets, custom) {
  const out = [];
  (selectedPresets || []).forEach(function (t) {
    if (TAG_PRESETS.indexOf(t) !== -1 && out.indexOf(t) === -1) out.push(t);
  });
  const c = (custom || '').trim().slice(0, 20);
  if (c && out.indexOf(c) === -1) out.push(c);
  return out;
}

function setTags(state, r, tags) {
  r.tags = tags.slice();
  logEvent(state, 'tags', r, tags.join(', ') || '(없음)');
}

/* ---------- 알림 메일 예시 ---------- */

function hoursText(hours) {
  if (hours < 24) return hours + '시간';
  const d = Math.floor(hours / 24), h = hours % 24;
  return d + '일' + (h ? ' ' + h + '시간' : '');
}

// 실제로 발송될 메일의 모습. 내 서버 중 3일 이내 만료 서버가 있으면 그 서버 기준(가장 급한 것),
// 없으면 예시 데이터로 만든다.
function buildExpiryMail(state, now) {
  const me = currentUser(state);
  const urgent = state.resources.filter(function (r) {
    return r.owner === CURRENT_USER.id && r.ttlLeftHours < 72;
  }).sort(function (a, b) { return a.ttlLeftHours - b.ttlLeftHours; })[0];
  const sample = !urgent;
  const r = urgent || { id: 'vm-0000', name: '예시 서버', flavor: 'small', ttlLeftHours: 24 };
  const f = FLAVORS[r.flavor];
  const end = new Date(now + r.ttlLeftHours * 3600 * 1000);
  const days = Math.max(1, Math.ceil(r.ttlLeftHours / 24));
  return {
    sample: sample,
    from: 'DKU Dev Portal',
    to: mailOf(CURRENT_USER.id),
    subject: "[DKU Dev Portal] '" + r.name + "' 사용 기한이 " + days + '일 남았습니다',
    greeting: me.name + '님,',
    endText: end.toLocaleString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric', hour: 'numeric' }),
    serverName: r.name, serverId: r.id,
    spec: f.name + ' \u00B7 ' + f.cpu + ' Core / ' + f.ram + 'GB',
    left: hoursText(r.ttlLeftHours)
  };
}

/* ================================================================
   v1.4: 디스크 확장 / 모니터링 / 자동 중지 예약
   (이 아래는 모두 순수 로직이다. DOM에 접근하지 않는다.)
   ================================================================ */

/* ---------- 디스크 확장 ---------- */

// 디스크를 newGb로 늘릴 때의 정산. 남은 기한만큼의 일일 요금 차액을 지금 결제한다. (줄이기는 지원하지 않는다.)
function computeDiskChange(state, r, newGb) {
  const fromCost = diskCostOf(r.disk), toCost = diskCostOf(newGb);
  const days = r.ttlLeftHours / 24;
  const dailyDiff = toCost - fromCost;
  const amount = Math.round(dailyDiff * days);
  const remaining = remainingCredit(state);
  const warnings = [];
  if (newGb <= r.disk) warnings.push({ level: 'block', msg: '디스크는 지금보다 큰 크기로만 바꿀 수 있습니다' });
  if (amount > remaining) {
    warnings.push({ level: 'block',
      msg: '잔여 크레딧 부족 (필요 ' + amount.toLocaleString() + ' / 보유 ' + remaining.toLocaleString() + ')' });
  }
  return { fromGb: r.disk, toGb: newGb, dailyDiff: dailyDiff, days: days, amount: amount,
           remaining: remaining, newRemaining: remaining - amount, warnings: warnings,
           blocked: warnings.some(function (w) { return w.level === 'block'; }) };
}

/* ---------- 모니터링 (예시 데이터) ---------- */

// 문자열 -> 32비트 정수 (같은 서버는 항상 같은 그래프가 나오게 한다)
function hashStr(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
function seededRandom(seed) {
  let t = seed >>> 0;
  return function () {
    t = (t + 0x6D2B79F5) >>> 0;
    let x = Math.imul(t ^ (t >>> 15), 1 | t);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

// range: '24h'(1시간 간격 24점) | '7d'(6시간 간격 28점). 실제 측정값이 아니라 사용량(usage)에서 만든 예시 값이다.
function metricSeries(r, range) {
  const n = range === '7d' ? 28 : 24;
  const stopped = r.status === 'stopped';
  const rnd = seededRandom(hashStr(r.id + range));
  const wave = function (i, amp) { return Math.sin((i / n) * Math.PI * (range === '7d' ? 14 : 2)) * amp; };
  const make = function (base, amp, noise) {
    const out = [];
    for (let i = 0; i < n; i++) {
      const v = base + wave(i, amp) + (rnd() - 0.5) * noise;
      out.push(stopped ? 0 : Math.max(1, Math.min(99, Math.round(v))));
    }
    if (!stopped) out[n - 1] = Math.max(1, Math.min(99, Math.round(base)));
    return out;
  };
  const cpu = make(r.usage, Math.max(4, r.usage * 0.25), Math.max(6, r.usage * 0.3));
  const mem = make(25 + r.usage * 0.55, 5, 6);
  const avg = function (a) { return Math.round(a.reduce(function (s, v) { return s + v; }, 0) / a.length); };
  const max = function (a) { return Math.max.apply(null, a); };
  const diskPct = Math.max(5, Math.min(97, 12 + (hashStr(r.id) % 40) + Math.round(r.usage * 0.3)));
  return { stopped: stopped, points: n, cpu: cpu, mem: mem,
           cpuAvg: avg(cpu), cpuMax: max(cpu), memAvg: avg(mem), memMax: max(mem),
           diskPct: diskPct, diskUsedGb: Math.round((r.disk || DISK_INCLUDED_GB) * diskPct / 100),
           diskTotalGb: r.disk || DISK_INCLUDED_GB };
}

// 사용 패턴에 따른 사양 제안. { type: 'down' | 'up' | 'ok' | 'none', ... }
function suggestSize(r, m) {
  if (m.stopped) return { type: 'none' };
  const i = FLAVOR_RANK.indexOf(r.flavor);
  if (m.cpuAvg >= 80 || m.memAvg >= 85) {
    const up = FLAVOR_RANK[i + 1];
    if (up && FLAVORS[up].ram <= USER_QUOTA.maxRam) {
      return { type: 'up', to: up, extraPerDay: dailyCostOf(up, r.addons, r.disk) - dailyCostOf(r.flavor, r.addons, r.disk) };
    }
  }
  if (m.cpuAvg < 25 && m.memAvg < 50 && i > 0) {
    const down = FLAVOR_RANK[i - 1];
    if (FLAVORS[down].ram >= requiredRam(r.addons)) {
      return { type: 'down', to: down, savePerDay: dailyCostOf(r.flavor, r.addons, r.disk) - dailyCostOf(down, r.addons, r.disk) };
    }
  }
  return { type: 'ok' };
}

/* ---------- 자동 중지 예약 ---------- */

function defaultSchedule() { return { enabled: true, stopAt: 23, startAt: 8, days: 'weekday' }; }

// 하루 중 예약으로 꺼져 있는 시간 (자정을 넘기는 경우 포함)
function scheduleOffHours(sch) {
  return sch.stopAt > sch.startAt ? 24 - sch.stopAt + sch.startAt : sch.startAt - sch.stopAt;
}

// 예상 절약: 꺼져 있는 시간 비율 x 중지 시 요금 감면분(1 - stoppedCostRatio) x 요일 비율.
// 실제 정산이 아니라 안내용 추정치다.
function scheduleEstimate(r, sch) {
  const base = dailyCostOf(r.flavor, r.addons, r.disk);
  const dayFactor = sch.days === 'weekday' ? 5 / 7 : 1;
  const perDay = Math.round(base * (1 - LIFECYCLE_POLICY.stoppedCostRatio) * (scheduleOffHours(sch) / 24) * dayFactor);
  return { offHours: scheduleOffHours(sch), perDay: perDay, total: Math.round(perDay * r.ttlLeftHours / 24) };
}

// 지금(date)이 예약 중지 시간대인지. 'weekday'는 월~금 저녁에 시작하는 중지만 해당한다.
function inScheduleWindow(sch, date) {
  if (!sch || !sch.enabled) return false;
  const h = date.getHours(), day = date.getDay();
  const weekdayNight = function (d) { return d >= 1 && d <= 5; };
  if (sch.stopAt > sch.startAt) {           // 예: 23시 ~ 다음 날 8시
    if (h >= sch.stopAt) return sch.days === 'all' || weekdayNight(day);
    if (h < sch.startAt) return sch.days === 'all' || weekdayNight((day + 6) % 7);
    return false;
  }
  if (h >= sch.stopAt && h < sch.startAt) return sch.days === 'all' || weekdayNight(day);   // 예: 1시 ~ 9시
  return false;
}

function scheduleText(sch) {
  const p = function (n) { return String(n).padStart(2, '0') + ':00'; };
  return p(sch.stopAt) + ' ~ ' + p(sch.startAt) + ' (' + (sch.days === 'all' ? '매일' : '평일 밤') + ')';
}

function setSchedule(state, r, sch) {
  r.schedule = sch ? { enabled: true, stopAt: sch.stopAt, startAt: sch.startAt, days: sch.days } : null;
  logEvent(state, 'schedule', r, sch ? scheduleText(sch) : '해제');
}


/* ================================================================
   v1.5: 자동 중지 안내, 크레딧 전망, 알림 센터, 이름 변경, 복제, 시작 체크리스트
   (이 아래는 모두 순수 로직이다. DOM에 접근하지 않는다.)
   ================================================================ */

// 내가 예약을 걸 수 있고, 켜져 있으며, 자동 중지가 없는 서버
function unscheduledServers(state) {
  return state.resources.filter(function (r) {
    return canDo(r, CURRENT_USER.id, 'schedule') && r.status !== 'stopped' && !(r.schedule && r.schedule.enabled);
  });
}

// 기본 예약(평일 밤)을 걸었을 때 예상 절약 (하루 합계)
function scheduleTipSaving(state) {
  return unscheduledServers(state).reduce(function (sum, r) {
    return sum + scheduleEstimate(r, defaultSchedule()).perDay;
  }, 0);
}

// 크레딧 전망: 지금 내 서버들의 하루 요금이 그대로 계속된다면 잔여로 몇 일을 더 쓸 수 있는지
function creditForecast(state) {
  const daily = state.resources.filter(function (r) { return r.owner === CURRENT_USER.id; })
    .reduce(function (sum, r) { return sum + resourceDailyCost(r); }, 0);
  const remaining = remainingCredit(state);
  return { daily: daily, remaining: remaining,
           days: daily > 0 ? Math.floor(remaining / daily) : null,
           dailyPct: remaining > 0 ? Math.round(daily / remaining * 1000) / 10 : null };
}

// 알림 센터 항목. 저장하지 않고 지금 상태에서 계산한다. key는 "읽음" 처리에 쓴다.
function buildNotifications(state) {
  const items = [];
  const n = state.notifications || {};
  state.resources.filter(function (r) { return canDo(r, CURRENT_USER.id, 'extend'); })
    .sort(function (a, b) { return a.ttlLeftHours - b.ttlLeftHours; }).forEach(function (r) {
      if (r.ttlLeftHours < LIFECYCLE_POLICY.warnBeforeHours && n.expire1d !== false) {
        items.push({ key: 'exp1:' + r.id, level: 'warn', title: r.name,
                     text: '사용 기한이 ' + hoursText(r.ttlLeftHours) + ' 남았습니다. 기한을 연장하세요.', href: 'dashboard.html' });
      } else if (r.ttlLeftHours < 72 && r.ttlLeftHours >= LIFECYCLE_POLICY.warnBeforeHours && n.expire3d !== false) {
        items.push({ key: 'exp3:' + r.id, level: 'info', title: r.name,
                     text: '사용 기한이 ' + hoursText(r.ttlLeftHours) + ' 남았습니다.', href: 'dashboard.html' });
      }
    });
  if (n.lowCredit !== false && remainingCredit(state) < USER_QUOTA.maxCredit * 0.1) {
    items.push({ key: 'low', level: 'warn', title: '잔여 크레딧이 적습니다',
                 text: fmtNum(remainingCredit(state)) + ' 크레딧 남았습니다(지급액의 10% 미만).', href: 'history.html' });
  }
  if (n.deployFail !== false) {
    state.resources.filter(function (r) { return r.repo && canDo(r, CURRENT_USER.id, 'deployView'); }).forEach(function (r) {
      const d = lastDeploy(r);
      if (d && d.status === 'failed') {
        items.push({ key: 'dep:' + r.id + ':' + d.seq, level: 'warn', title: r.name,
                     text: '배포 #' + d.seq + '이 실패했습니다 (' + (d.failedStage || '빌드') + ' 단계). 배포 탭에서 로그를 확인하세요.', href: 'dashboard.html' });
      }
    });
  }
  (state.approvals || []).forEach(function (a) {
    if (a.status === 'approved') {
      items.push({ key: 'apr:' + a.id, level: 'info', title: '추가 크레딧 요청이 승인되었습니다',
                   text: '대시보드에서 "지금 생성"을 눌러 서버를 만들 수 있습니다.', href: 'dashboard.html' });
    }
  });
  const un = unscheduledServers(state);
  if (un.length && !(state.hints && state.hints.schedBannerDismissed)) {
    items.push({ key: 'sched:' + un.length, level: 'tip', title: '자동 중지로 크레딧을 아껴 보세요',
                 text: '서버 ' + un.length + '대가 밤새 켜져 있습니다. 하루 약 ' + fmtNum(scheduleTipSaving(state)) + ' 크레딧을 아낄 수 있어요.', href: 'dashboard.html' });
  }
  return items;
}

function fmtNum(n) { return Number(n).toLocaleString(); }

// 서버 이름 변경 (빈 이름과 40자 초과는 거부). 성공하면 true.
function renameResource(state, r, name) {
  const next = String(name || '').trim();
  if (!next || next.length > 40 || next === r.name) return false;
  const prev = r.name;
  r.name = next;
  logEvent(state, 'rename', r, prev + ' \u2192 ' + next);
  return true;
}

// 이 서버와 같은 구성으로 새 서버를 만들 준비 (Builder에서 이어서 확인한다)
function cloneConfig(state, r) {
  state.os = r.os; state.flavor = r.flavor; state.addons = r.addons.slice();
  state.disk = r.disk || DISK_INCLUDED_GB; state.ttl = 7;
  state.resourceName = r.name + ' (복사)'; state.templateName = null;
  state.surveyAnswers = null; state.cloneFrom = r.name;
  state.cloneOrigin = r.name; state.repoDraft = { url: '', branch: 'main' }; state.projectDraft = r.project || '';   // 저장소 연결은 복사하지 않는다
}

// 시작 체크리스트. 처음에는 아무것도 체크되어 있지 않다.
// 서버를 만들거나 팀원을 추가하면 자동으로 체크하고(markOnboard), 나머지는 사용자가 직접 표시한다.
function onboardingSteps(state) {
  const done = (state.hints && state.hints.onboard) || {};
  return [
    { id: 'create',   label: '서버 만들기',        href: 'survey.html',    done: !!done.create },
    { id: 'connect',  label: '서버에 접속해 보기',  href: 'dashboard.html', done: !!done.connect },
    { id: 'password', label: '초기 비밀번호 바꾸기', href: 'dashboard.html', done: !!done.password },
    { id: 'invite',   label: '팀원 초대하기',       href: 'dashboard.html', done: !!done.invite }
  ];
}

function markOnboard(state, id) {
  if (!state.hints) state.hints = {};
  state.hints.onboard = state.hints.onboard || {};
  state.hints.onboard[id] = true;
}


/* ================================================================
   v1.6: 배포 (CI/CD 시뮬레이션)
   실제 GitHub 연동, 빌드, 배포는 하지 않는다. 결과는 정해진 규칙(데모 도구 포함)에 따른 것이다.
   (이 아래는 모두 순수 로직이다. DOM에 접근하지 않는다.)
   ================================================================ */

// github.com/소유자/저장소 형식만 허용한다. 성공하면 정규화한 주소를 돌려준다.
function validateRepoUrl(url) {
  const m = String(url || '').trim().match(/^(?:https:\/\/)?github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?\/?$/);
  return m ? { ok: true, url: 'github.com/' + m[1] + '/' + m[2] }
           : { ok: false, msg: '주소는 github.com/소유자/저장소 형식으로 입력하세요' };
}
function validateBranch(name) {
  const b = String(name || '').trim();
  return /^[A-Za-z0-9._\/-]{1,60}$/.test(b) ? { ok: true, branch: b }
    : { ok: false, msg: '브랜치 이름에는 공백이나 특수문자를 쓸 수 없습니다 (1~60자)' };
}

function connectRepo(state, r, url, branch) {
  const u = validateRepoUrl(url), b = validateBranch(branch);
  if (!u.ok) return u;
  if (!b.ok) return b;
  r.repo = { url: u.url, branch: b.branch, connectedAt: Date.now(), connectedBy: CURRENT_USER.id };
  logEvent(state, 'repo_connect', r, u.url + ' (' + b.branch + ')');
  return { ok: true };
}

// 연결만 해제한다. 지금까지의 배포 이력은 남는다.
function disconnectRepo(state, r) {
  const url = r.repo ? r.repo.url : '';
  r.repo = null;
  r.pendingDeploy = null;
  logEvent(state, 'repo_disconnect', r, url);
}

function lastDeploy(r) {
  return (r.deploys || []).reduce(function (m, d) { return !m || d.seq > m.seq ? d : m; }, null);
}
// 지금 서버에 올라가 있는 버전 = 가장 최근에 성공한 배포
function currentDeploy(r) {
  return (r.deploys || []).filter(function (d) { return d.status === 'success'; })
    .reduce(function (m, d) { return !m || d.seq > m.seq ? d : m; }, null);
}
function runningDeploy(r) {
  return (r.deploys || []).filter(function (d) { return d.status === 'running'; })[0] || null;
}

function randomCommit() {
  let h = '';
  for (let i = 0; i < 7; i++) h += Math.floor(Math.random() * 16).toString(16);
  return h;
}
function randomSampleCommit() {
  const c = SAMPLE_COMMITS[Math.floor(Math.random() * SAMPLE_COMMITS.length)];
  return { commit: randomCommit(), message: c.message, author: c.author };
}

// 배포를 시작한다. opts: { commit, message, author, rollbackOf }
function startDeploy(state, r, trigger, opts) {
  opts = opts || {};
  if (!r.repo) return { ok: false, msg: '저장소가 연결되어 있지 않습니다' };
  if (r.status === 'stopped') return { ok: false, msg: '중지된 서버에는 배포할 수 없습니다' };
  if (runningDeploy(r)) return { ok: false, msg: '이미 배포가 진행 중입니다' };
  const c = opts.commit ? opts : Object.assign({}, randomSampleCommit(), opts);
  const last = lastDeploy(r);
  const seq = (last ? last.seq : 0) + 1;
  const d = { id: 'dp' + seq, seq: seq, at: Date.now(), commit: c.commit,
              message: c.message || (trigger === 'manual' ? '수동 배포' : ''),
              author: c.author || currentUser(state).name, status: 'running',
              durationSec: DEPLOY_POLICY.fakeDurationSec, trigger: trigger,
              rollbackOf: opts.rollbackOf || null, failedStage: null };
  r.deploys.push(d);
  // 이력은 최근 historyLimit건만 남긴다 (진행 중인 것은 항상 남긴다)
  while (r.deploys.length > DEPLOY_POLICY.historyLimit) {
    const i = r.deploys.findIndex(function (x) { return x.status !== 'running'; });
    if (i < 0) break;
    r.deploys.splice(i, 1);
  }
  return { ok: true, deploy: d };
}

// 결과를 확정한다. 데모 도구의 forceFail이 켜져 있으면 이번 1건만 실패로 만들고 플래그를 끈다.
// 롤백은 이미 성공했던 버전으로 되돌리는 것이므로 항상 성공한다.
function finishDeploy(state, r, d) {
  if (d.status !== 'running') return;
  const fail = d.trigger !== 'rollback' && state.demo && state.demo.forceFail;
  if (fail) {
    state.demo.forceFail = false;
    d.status = 'failed';
    d.failedStage = DEPLOY_POLICY.stages[1];
  } else {
    d.status = 'success';
  }
  if (d.trigger === 'rollback') {
    logEvent(state, 'rollback', r, '#' + d.seq + ' (#' + d.rollbackOf + '으로 되돌림)');
  } else {
    logEvent(state, 'deploy', r, '#' + d.seq + ' ' + (d.status === 'success' ? '성공' : '실패') + ' \u00B7 ' + d.commit);
  }
}

// 시간이 지난 진행 중 배포를 확정한다. 바뀐 게 있으면 true.
function settleDeploys(state, now) {
  let changed = false;
  state.resources.forEach(function (r) {
    (r.deploys || []).forEach(function (d) {
      if (d.status === 'running' && now - d.at >= d.durationSec * 1000) { finishDeploy(state, r, d); changed = true; }
    });
  });
  return changed;
}

// 성공했던 배포 seq로 되돌린다. 새 이력(trigger: 'rollback')이 추가된다.
function rollbackTo(state, r, seq) {
  const t = (r.deploys || []).filter(function (d) { return d.seq === seq; })[0];
  if (!t || t.status !== 'success') return { ok: false, msg: '성공한 배포로만 되돌릴 수 있습니다' };
  const cur = currentDeploy(r);
  if (cur && cur.seq === seq) return { ok: false, msg: '이미 이 버전이 배포되어 있습니다' };
  return startDeploy(state, r, 'rollback', { commit: t.commit, message: t.message, author: t.author, rollbackOf: seq });
}

// 가상 push(데모 도구). 중지 중이거나 배포 중이면 보류해 두었다가 시작할 때 배포한다.
function receivePush(state, r) {
  if (!r.repo) return { ok: false, msg: '저장소가 연결되어 있지 않습니다' };
  const c = randomSampleCommit();
  if (r.status === 'stopped' || runningDeploy(r)) {
    r.pendingDeploy = { commit: c.commit, message: c.message, author: c.author, at: Date.now() };
    return { ok: true, pending: true, commit: c };
  }
  return Object.assign(startDeploy(state, r, 'push', c), { commit: c });
}

// 서버를 시작하면 보류된 push를 배포한다.
function resumePending(state, r) {
  if (!r.pendingDeploy || r.status === 'stopped' || runningDeploy(r)) return null;
  const p = r.pendingDeploy;
  r.pendingDeploy = null;
  const res = startDeploy(state, r, 'push', p);
  return res.ok ? res.deploy : null;
}

// 배포 로그(가짜). 진행 중이면 지금 단계까지만, 끝났으면 결과에 맞춰 전체를 돌려준다.
function deployLogLines(r, d, now) {
  const repo = r.repo ? r.repo.url + ' (' + r.repo.branch + ')' : '저장소';
  const st = DEPLOY_POLICY.stages;
  const stages = [
    [['[빌드] 저장소 복제: ' + repo], ['[빌드] 의존성 설치'], ['[빌드] 빌드 완료 (' + d.commit + ')']],
    [['[테스트] 단위 테스트 실행'], ['[테스트] 통과 (24 passed)']],
    [['[배포] 새 버전을 서버에 반영'], ['[배포] 서비스 재시작'], ['[배포] 완료 (#' + d.seq + ')']]
  ];
  if (d.trigger === 'rollback') {
    stages[0] = [['[롤백] #' + d.rollbackOf + ' 버전 준비 (' + d.commit + ')']];
    stages[1] = [['[롤백] 이전에 성공한 버전이므로 테스트는 건너뜁니다']];
  }
  const out = [];
  const failIdx = d.status === 'failed' ? Math.max(0, st.indexOf(d.failedStage)) : -1;
  const upTo = d.status === 'running'
    ? Math.min(st.length - 1, Math.floor((now - d.at) / (d.durationSec * 1000 / st.length)))
    : failIdx >= 0 ? failIdx : st.length - 1;
  for (let i = 0; i <= upTo; i++) {
    if (i === failIdx) {
      out.push({ text: '[' + st[i] + '] 단위 테스트 실행', level: 'ok' });
      out.push({ text: '[' + st[i] + '] 실패: 3개 테스트가 통과하지 못했습니다', level: 'bad' });
      out.push({ text: '    OrderServiceTest.calculateTotal, OrderApiTest.responseShape ...', level: 'bad' });
      out.push({ text: '배포가 중단되었습니다. 서버에는 이전 버전이 그대로 남아 있습니다.', level: 'bad' });
      break;
    }
    const lines = stages[i];
    (d.status === 'running' && i === upTo ? lines.slice(0, 1) : lines).forEach(function (l) { out.push({ text: l[0], level: 'ok' }); });
  }
  if (d.status === 'running') out.push({ text: '...', level: 'dim' });
  return out;
}


/* ================================================================
   v1.7: 서버 위생 점수, 프로젝트 단위 묶음
   (이 아래는 모두 순수 로직이다. DOM에 접근하지 않는다.)
   ================================================================ */

const PROJECT_MAX_LEN = 30;

function cleanProject(name) {
  return String(name || '').replace(/\s+/g, ' ').trim().slice(0, PROJECT_MAX_LEN);
}

// 서버가 속한 프로젝트를 바꾼다 (빈 문자열이면 프로젝트 없음). 바뀌었으면 true.
function setProject(state, r, name) {
  const next = cleanProject(name), prev = r.project || '';
  if (next === prev) return false;
  r.project = next;
  logEvent(state, 'project', r, (prev || '없음') + ' \u2192 ' + (next || '없음'));
  return true;
}

// 화면의 자동완성에 쓸 기존 프로젝트 이름 (중복 없이 가나다순)
function projectNames(state) {
  const seen = {};
  state.resources.forEach(function (r) { if (r.project) seen[r.project] = true; });
  return Object.keys(seen).sort(function (a, b) { return a.localeCompare(b, 'ko'); });
}

// 서버 위생 점수: 4개 항목 중 몇 개를 지키고 있는지. 이미 있는 값으로만 계산한다.
// 각 항목의 action은 화면에서 바로 고칠 수 있게 연결하는 작업 이름이다.
function hygieneChecks(r) {
  const stopped = r.status === 'stopped';
  return [
    { id: 'team',     label: '팀원이 있음',       ok: (r.members || []).length > 0,
      hint: '팀원을 추가하면 혼자 관리하지 않아도 됩니다', action: 'team' },
    { id: 'tags',     label: '태그가 있음',       ok: (r.tags || []).length > 0,
      hint: '태그를 붙이면 나중에 찾기 쉽습니다', action: 'tags' },
    { id: 'schedule', label: '자동 중지를 설정함', ok: stopped || !!(r.schedule && r.schedule.enabled),
      hint: '밤에 자동으로 멈추면 크레딧을 아낄 수 있습니다', action: 'schedule' },
    { id: 'ttl',      label: '사용 기한이 여유 있음', ok: r.ttlLeftHours >= LIFECYCLE_POLICY.warnBeforeHours,
      hint: '기한이 ' + LIFECYCLE_POLICY.warnBeforeHours + '시간 미만입니다. 연장하지 않으면 자동 정지됩니다', action: 'extend' }
  ];
}
function hygieneScore(r) {
  const checks = hygieneChecks(r);
  return { score: checks.filter(function (c) { return c.ok; }).length, total: checks.length, checks: checks };
}
function hygieneAverage(list) {
  if (!list.length) return null;
  return Math.round(list.reduce(function (s, r) { return s + hygieneScore(r).score; }, 0) / list.length * 10) / 10;
}

// 서버 목록을 프로젝트별로 묶는다. 프로젝트 이름 가나다순이고 '프로젝트 없음'은 맨 뒤.
function groupByProject(list) {
  const map = {};
  list.forEach(function (r) { (map[r.project || ''] = map[r.project || ''] || []).push(r); });
  return Object.keys(map).sort(function (a, b) {
    if (!a) return 1;
    if (!b) return -1;
    return a.localeCompare(b, 'ko');
  }).map(function (name) {
    const servers = map[name];
    const people = {};
    servers.forEach(function (r) {
      people[r.owner] = r.ownerName;
      (r.members || []).forEach(function (m) { people[m.id] = m.name; });
    });
    return { name: name, servers: servers,
             daily: servers.reduce(function (s, r) { return s + resourceDailyCost(r); }, 0),
             avgScore: hygieneAverage(servers),
             people: Object.keys(people).map(function (id) { return { id: id, name: people[id] }; }) };
  });
}
