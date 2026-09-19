const USER_QUOTA = {
  maxRam: 64,          // VM 1대당 최대 RAM. XXLarge(64GB)는 한도와 동일하므로 통과가 정상 동작임.
                       // 이 검사는 향후 더 큰 flavor 추가에 대비한 가드이며,
                       // 데모에서 실제 차단은 크레딧 기준으로 발생함.
                       // "이 조건이 절대 참이 되지 않는다"는 이유로 코드를 제거하지 말 것.
  maxCredit: 1000000,
  usedCredit: 150000   // 잔여 = 850,000
};

const FLAVORS = {
  small:  { name: 'Small',  label: '가벼운 실습', cpu: 2, ram: 4,  costPerDay: 3000 },
  medium: { name: 'Medium', label: '데이터 분석', cpu: 4, ram: 8,  costPerDay: 6000 },
  large:  { name: 'Large',  label: 'AI 모델링',   cpu: 8, ram: 16, costPerDay: 8000 },
  xlarge: { name: 'XLarge', label: '대규모 학습', cpu: 16, ram: 32, costPerDay: 15000 },
  xxlarge:{ name: 'XXLarge',label: '초대형 작업', cpu: 32, ram: 64, costPerDay: 28000 }
};

const ADDONS = {
  mysql:      { name: 'MySQL 8.0',      minRam: 4, costPerDay: 600,  cat: 'db',  desc: '표 형태의 관계형 데이터' },
  postgresql: { name: 'PostgreSQL 16',  minRam: 4, costPerDay: 600,  cat: 'db',  desc: '기능이 풍부한 관계형 데이터' },
  mongodb:    { name: 'MongoDB 7.0',    minRam: 4, costPerDay: 500,  cat: 'db',  desc: '문서 형태의 유연한 데이터' },
  redis:      { name: 'Redis 7',        minRam: 4, costPerDay: 400,  cat: 'db',  desc: '메모리에 올려 빠르게 읽는 저장소' },
  kafka:      { name: 'Apache Kafka',   minRam: 8, costPerDay: 1200, cat: 'msg', desc: '실시간 메시지 전달' },
  nginx:      { name: 'Nginx',          minRam: 4, costPerDay: 300,  cat: 'web', desc: '웹 서버와 리버스 프록시' },
  docker:     { name: 'Docker Engine',  minRam: 4, costPerDay: 300,  cat: 'web', desc: '컨테이너로 프로그램을 실행' }
};

// 도구 분류 (설문과 Builder에서 묶어서 보여 준다)
const ADDON_CATEGORIES = [
  { id: 'db',  name: '데이터베이스' },
  { id: 'msg', name: '메시징' },
  { id: 'web', name: '웹, 실행 환경' }
];

// 도구를 여러 개 함께 설치할 때 필요한 RAM = 가장 큰 권장 RAM + (추가 도구 1개당 이 값)
const ADDON_EXTRA_RAM = 2;

// 디스크(SSD): 사양에 기본 50GB가 포함되고, 그 이상은 GB당 하루 요금이 붙는다.
// 디스크는 늘리기만 할 수 있다 (줄이면 데이터가 잘릴 수 있으므로).
const DISK_INCLUDED_GB = 50;
const DISK_OPTIONS = [50, 100, 200, 500, 1000];
const DISK_COST_PER_GB_DAY = 3;

const OS_LIST = [
  { id: 'ubuntu22', name: 'Ubuntu 22.04 LTS' },
  { id: 'rocky9',   name: 'Rocky Linux 9' },
  { id: 'debian12', name: 'Debian 12' }
];

const FLAVOR_RANK = ['small', 'medium', 'large', 'xlarge', 'xxlarge'];

// 설문 답변 -> 추천 flavor 매핑
const SURVEY_RULES = {
  purpose: { web: 'small', model: 'large', practice: 'small' },
  scale:   { light: 'small', normal: 'medium', heavy: 'large' }
};

// 설문 답변 -> 추천 디스크(GB). 두 답변 중 큰 값을 쓴다.
const SURVEY_DISK = {
  purpose: { web: 50, model: 200, practice: 50 },
  scale:   { light: 50, normal: 100, heavy: 200 }
};

// 자동 중지 예약: 매일 또는 평일 밤만
const SCHEDULE_DAYS = { all: '매일', weekday: '평일 밤만 (월~금)' };

// 자원 생명주기 정책 -- 화면 문구에도 그대로 노출한다
const LIFECYCLE_POLICY = {
  extendDays: 7,             // [기한 연장] 1회당 연장 일수
  warnBeforeHours: 24,       // 만료 임박 경고 기준
  stoppedCostRatio: 0.2,     // 중지 상태에서는 스토리지 점유분만 청구 (일일 요금의 20%)
  expiryAction: '기한이 만료되면 자동 정지되며, 7일간 보관 후 삭제됩니다.',
  approvalDemoDelaySec: 10,  // 데모용: 관리자 승인 요청이 자동 승인되기까지의 시간
  trashRetentionDays: 7,     // 반납한 서버를 휴지통에서 복구할 수 있는 기간
  restartSeconds: 3          // 데모용: 재시작에 걸리는 시간
};

// 대시보드 고정 더미 데이터 (사용자가 생성한 자원과 함께 표시됨)
// owner가 CURRENT_USER.id와 다른 행이 섞여 있어야 '내 자원 / 연구실 전체' 필터가 실제로 동작함
const DUMMY_RESOURCES = [
  { id: 'vm-0417', name: '소프트웨어학과 캡스톤 3조 백엔드',
    os: 'ubuntu22', flavor: 'medium', addons: ['mongodb'], disk: 100,
    schedule: { enabled: true, stopAt: 23, startAt: 8, days: 'weekday' },
    repo: { url: 'github.com/dku-capstone3/backend', branch: 'main', connectedDaysAgo: 2, connectedBy: 'soft2021' },
    deploySeed: [
      { seq: 14, agoHours: 3,  commit: 'a3f9c21', message: '로그인 검증 로직 수정',  author: '김하늘', status: 'success', trigger: 'push' },
      { seq: 13, agoHours: 5,  commit: '7b1e04d', message: '주문 API 응답 형식 변경', author: '이서준', status: 'failed',  trigger: 'push', failedStage: '테스트' },
      { seq: 12, agoHours: 30, commit: 'c0d9a1f', message: 'DB 연결 풀 설정 조정',   author: '최민서', status: 'success', trigger: 'manual' },
      { seq: 11, agoHours: 52, commit: '5e2b7a0', message: 'README 갱신',           author: '정우진', status: 'success', trigger: 'push' },
      { seq: 10, agoHours: 75, commit: '91d4c3e', message: '테스트 코드 추가',       author: '김하늘', status: 'success', trigger: 'push' }
    ],
    owner: 'soft2021', ownerName: '이서준', team: '단국대학교 연구실',
    members: [{ id: 'soft2022', name: '김하늘', role: 'manage' },
              { id: 'soft2023', name: '최민서', role: 'use' },
              { id: 'soft2024', name: '정우진', role: 'use' }],
    tags: ['캡스톤'], project: '캡스톤 3조',
    usage: 62, ttlLeftHours: 120, status: 'running' },
  { id: 'vm-0392', name: 'Hopfield Network 모델 학습용 서버',
    os: 'rocky9', flavor: 'large', addons: [], disk: 500,
    owner: 'soft2019', ownerName: '박지민', team: '지능시스템 연구실',
    members: [], tags: ['개인연구'], project: '지능시스템 연구',
    usage: 91, ttlLeftHours: 288, status: 'running' },
  { id: 'vm-0451', name: '네트워크 지연율 분석 테스트용',
    os: 'debian12', flavor: 'small', addons: [], disk: 50,
    owner: 'soft2021', ownerName: '이서준', team: '단국대학교 연구실',
    members: [{ id: 'soft2024', name: '정우진', role: 'use' }],
    tags: ['수업과제'], project: '수업 실습',
    usage: 18, ttlLeftHours: 9, status: 'running' },
  { id: 'vm-0388', name: '데이터베이스 과제 제출용',
    os: 'ubuntu22', flavor: 'small', addons: ['mysql'], disk: 50,
    owner: 'soft2021', ownerName: '이서준', team: '단국대학교 연구실',
    members: [], tags: ['수업과제'], project: '수업 실습',
    usage: 0, ttlLeftHours: 96, status: 'stopped' }
];

// 현재 로그인한 사용자 (목업이므로 고정)
const CURRENT_USER = {
  id: 'soft2021',
  studentNo: '202012345',
  name: '이서준',
  dept: '소프트웨어학과',
  team: '단국대학교 연구실',
  role: 'student'
};

// 데모 로그인 계정 (프로토타입용. 실제 인증 아님)
const DEMO_ACCOUNT = { id: 'soft2021', pw: 'dku2026', dept: '소프트웨어학과', role: '학생' };

// 홈 화면의 빠른 시작 프리셋. 사양/기한은 위 FLAVORS, ADDONS, 잔여 크레딧을 고려해 정했다.
const PRESETS = [
  { id: 'web',  name: '웹 서버', desc: '서비스나 API를 띄우는 가벼운 서버',
    useCase: '수업 과제 웹 페이지, 간단한 API 서버, 포트폴리오 배포',
    os: 'ubuntu22', flavor: 'small',  addons: [],          disk: 50,  ttl: 7, recommended: true, deploy: true },
  { id: 'data', name: '데이터 분석', desc: 'MongoDB에 데이터를 쌓고 분석하는 서버',
    useCase: '설문이나 로그 데이터 수집과 분석, 데이터 전처리 실습',
    os: 'ubuntu22', flavor: 'medium', addons: ['mongodb'], disk: 100, ttl: 7 },
  { id: 'ai',   name: 'AI 모델 학습', desc: '모델을 훈련하는 고사양 서버 (1일 단위로 빌려 씁니다)',
    useCase: '모델 학습과 실험. 학습이 끝나면 바로 반납하는 용도',
    os: 'ubuntu22', flavor: 'large',  addons: [],          disk: 200, ttl: 1 }
];

// ---------- v1.1: 팀 공유, 권한, 태그, 도움말 ----------

// 학번/이름 검색용 더미 명부 (실제 학사 시스템 연동은 없음)
const DIRECTORY = [
  { id: 'soft2021', studentNo: '202012345', name: '이서준', dept: '소프트웨어학과' },
  { id: 'soft2022', studentNo: '202112301', name: '김하늘', dept: '소프트웨어학과' },
  { id: 'soft2023', studentNo: '202112388', name: '최민서', dept: '소프트웨어학과' },
  { id: 'soft2024', studentNo: '202012402', name: '정우진', dept: '소프트웨어학과' },
  { id: 'soft2019', studentNo: '201912011', name: '박지민', dept: '소프트웨어학과' }
];

const MEMBER_ROLES = {
  manage: { name: '관리', desc: '기한 연장, 중지·시작, 사양 변경까지 할 수 있습니다' },
  use:    { name: '사용', desc: '접속 정보만 볼 수 있습니다' }
};

// 작업별로 필요한 최소 권한. owner > manage > use.
// 반납과 팀원 관리(소유권 이전 포함)는 팀 서버를 팀원이 지우거나 바꾸지 못하도록 owner만 가능하다.
const ACTION_MIN_ROLE = {
  access: 'use',
  extend: 'manage', stopStart: 'manage', resize: 'manage',
  restart: 'manage', reissue: 'manage', tags: 'manage',
  disk: 'manage', schedule: 'manage', rename: 'manage', clone: 'use',
  repo: 'manage', deploy: 'manage', deployView: 'use', project: 'manage',
  return: 'owner', team: 'owner'
};

// 태그: 미리 정의된 3개 + 직접 입력 1개
const TAG_PRESETS = ['캡스톤', '수업과제', '개인연구'];

// 배포(CI/CD 시뮬레이션): 실제 빌드나 GitHub 연동은 없다
const DEPLOY_POLICY = {
  historyLimit: 20,          // 서버당 보관할 배포 이력 수
  fakeDurationSec: 5,        // 가짜 배포에 걸리는 시간 (시연이 늘어지지 않도록 짧게)
  stages: ['빌드', '테스트', '배포']
};

// 가상 push에 쓰는 더미 커밋
const SAMPLE_COMMITS = [
  { message: '로그인 검증 로직 수정',   author: '김하늘' },
  { message: '주문 API 응답 형식 변경', author: '이서준' },
  { message: 'DB 연결 풀 설정 조정',    author: '최민서' },
  { message: 'README 갱신',            author: '정우진' },
  { message: '테스트 코드 추가',        author: '김하늘' }
];

// 도움말 화면: 문의처(더미)
const SUPPORT_CONTACT = {
  name: '홍길동 조교',
  email: 'dev-portal-help@dankook.example',
  location: '000호 (연구실)',
  hours: '평일 10:00 - 17:00',
  reply: '문의 후 영업일 기준 하루 안에 답변드립니다.'
};
