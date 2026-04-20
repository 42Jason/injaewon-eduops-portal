# EduOps 포털 — 배포 & 자동 업데이트 가이드

이 문서는 EduOps 포털을 **설치형 데스크톱 앱**으로 빌드해 다른 팀원에게 배포하고, 이후 자동 업데이트가 동작하도록 운영하는 방법을 설명합니다.

- **OS**: Windows 10 / 11 (x64)
- **설치 형식**: NSIS 설치 마법사 (`EduOps-Portal-Setup-x.y.z.exe`)
- **배포 채널**: GitHub Releases
- **자동 업데이트**: `electron-updater` (6시간마다 + 앱 시작 시 자동 확인)
- **코드 서명**: 없음 (SmartScreen 경고 시 "추가 정보 > 실행" 클릭으로 진행)

---

## 1. 최초 1회 준비 — GitHub 저장소 연결

### 1-1. GitHub 저장소 생성

1. GitHub에서 새 저장소를 만듭니다 (예: `your-org/eduops-portal`).
   - Private / Public 모두 가능.
   - Private인 경우, 사용자 PC에서 업데이트를 받으려면 GitHub Personal Access Token이 필요합니다 (아래 "Private repo로 배포할 때" 섹션).
2. 로컬 프로젝트에서 초기화:
   ```powershell
   cd "C:\Users\wotjd\Desktop\-_-\eduops-portal"
   git init
   git branch -M main
   git remote add origin https://github.com/YOUR_GITHUB_USER/eduops-portal.git
   git add .
   git commit -m "init: EduOps 포털"
   git push -u origin main
   ```

### 1-2. `package.json` 에 저장소 주소 반영

`package.json` 의 다음 값을 실제 저장소로 바꿉니다:

```json
"repository": {
  "type": "git",
  "url": "https://github.com/YOUR_GITHUB_USER/eduops-portal.git"
}
```

electron-builder는 이 값에서 `owner` / `repo` 를 자동으로 읽어 Release 에 파일을 올리고, 설치된 앱이 같은 저장소의 `latest.yml` 을 조회해 업데이트를 감지합니다.

### 1-3. (선택) Private repo로 배포할 때

Private 저장소는 GitHub Actions가 Release에 올리는 건 문제없지만, 설치된 앱이 업데이트 확인을 하려면 각 사용자 PC에 개인 토큰이 필요합니다. 일반 사내 배포에는 **Public 저장소를 권장**합니다.

만약 꼭 Private으로 가야 한다면:
- GitHub → Settings → Developer settings → Personal access tokens (classic) → `repo` 권한만 있는 fine-grained token 발급
- 각 사용자 PC에서 환경변수 `GH_TOKEN` 설정 (자동 업데이트 시 electron-updater가 이 값을 사용)

---

## 2. 릴리스 절차 (가장 흔한 경우)

### 2-1. 버전 올리기

```powershell
# patch: 0.1.0 -> 0.1.1 (버그 수정)
npm version patch

# minor: 0.1.0 -> 0.2.0 (기능 추가)
npm version minor

# major: 0.1.0 -> 1.0.0 (호환성 깨짐)
npm version major
```

`npm version` 은 `package.json` 의 버전을 올리고, `vX.Y.Z` 태그를 만들고, 커밋까지 자동으로 해줍니다.

### 2-2. 태그 push → CI 자동 빌드

```powershell
git push origin main --follow-tags
```

GitHub Actions (`.github/workflows/release.yml`) 이 자동으로 실행됩니다:
1. Windows 러너에서 `npm ci` + `npm run rebuild`
2. 아이콘 생성 + typecheck + build
3. `electron-builder --win --x64 --publish always` → Release에 `EduOps-Portal-Setup-X.Y.Z.exe` 와 `latest.yml` 업로드

대략 **8~12분** 이 걸립니다. Actions 탭에서 진행 상황을 볼 수 있습니다.

### 2-3. 릴리스 공개

CI가 끝나면 GitHub Releases 페이지에 **draft 또는 pre-release 상태로** 릴리스가 올라옵니다 (`vPrefixedTagName: true` 기본 설정).
- 릴리스 내용(Release notes) 확인
- "Publish release" 를 눌러 공개 상태로 전환 → 설치된 앱들이 6시간 내로 업데이트를 감지

---

## 3. 로컬에서 수동 빌드 (GitHub Actions 없이)

GitHub 없이도 내 PC에서 설치 파일을 만들어 공유할 수 있습니다.

```powershell
cd "C:\Users\wotjd\Desktop\-_-\eduops-portal"
npm install
npm run dist
```

결과물:
```
release/
  EduOps-Portal-Setup-0.1.0.exe    ← 이 파일을 배포
  EduOps-Portal-Setup-0.1.0.exe.blockmap
  latest.yml
  builder-effective-config.yaml
```

`--publish never` 가 기본이라 GitHub 에는 안 올라갑니다. 파일 공유는 USB, 사내 네트워크 드라이브, Google Drive 등으로 직접 전달.

업로드까지 한번에 하려면:
```powershell
$env:GH_TOKEN="ghp_xxxxxxxxxxxxxxxx"   # Release 올릴 권한이 있는 토큰
npm run release
```

Draft 상태로 올리려면:
```powershell
npm run release:draft
```

---

## 4. 사용자 설치 안내 (팀원에게 전달할 메시지 템플릿)

> **EduOps 포털 설치 안내**
>
> 1. [최신 릴리스 페이지](https://github.com/YOUR_GITHUB_USER/eduops-portal/releases/latest) 로 이동
> 2. `EduOps-Portal-Setup-X.Y.Z.exe` 다운로드
> 3. 다운로드한 파일을 실행
>    - Windows SmartScreen 경고가 뜨면 "추가 정보" → "실행" 클릭 (코드 서명 인증서가 아직 없어서 표시되는 정상 경고)
> 4. 설치 경로를 확인하고 [설치]
> 5. 설치 완료 후 바탕화면의 "EduOps 포털" 아이콘으로 실행
>
> **첫 로그인**: 이메일 / 비밀번호는 관리자(HR_ADMIN)에게 문의.
>
> **업데이트**: 새 버전이 나오면 앱 좌측 하단에 자동으로 알림이 뜹니다. "다운로드" → "재시작 후 설치" 를 눌러주세요.

---

## 5. 자동 업데이트 동작 원리

### 사용자 측
1. 앱 시작 후 **8초 뒤** `electron-updater` 가 GitHub Release의 `latest.yml` 을 조회합니다.
2. 이후 **6시간마다** 자동 재확인.
3. 신규 버전이 있으면:
   - 사이드바 하단에 "신규 버전 X.Y.Z" 배너가 뜨고 `[다운로드]` 버튼 제공
   - 사용자가 누르면 설치 파일을 사용자 캐시(`%LOCALAPPDATA%\eduops-portal-updater\pending`)에 받음
   - 다운로드 완료 후 `[재시작 후 설치]` 버튼이 활성화되고, 클릭 시 NSIS installer 가 구동돼 자동 설치 후 앱을 재시작

### 데이터 보존
- DB는 `%APPDATA%\EduOps 포털\db\eduops.db` 에 위치 (설치 경로와 분리됨)
- NSIS 언인스톨 시 `deleteAppDataOnUninstall: false` 설정으로 DB가 **보존**됩니다 (재설치 시 동일 DB 사용)
- 완전 초기화하려면 제거 후 수동으로 `%APPDATA%\EduOps 포털` 폴더를 삭제

---

## 6. 트러블슈팅

### 빌드 시 `better-sqlite3` 오류
네이티브 모듈이 Electron 버전과 안 맞을 때 발생. 해결:
```powershell
npm run rebuild
```

처음 빌드 환경을 세팅할 때 Windows는 `node-gyp` 를 위한 C++ 빌드 도구가 필요할 수 있습니다:
```powershell
# 관리자 PowerShell에서
npm install --global windows-build-tools
# 또는 Visual Studio Build Tools 설치 (C++ workload)
```

### CI가 release에 업로드 못 함 (403)
- 저장소 Settings → Actions → General → **"Workflow permissions"** 를 `Read and write permissions` 로 변경
- `.github/workflows/release.yml` 상단에 `permissions: contents: write` 가 있는지 확인 (이미 포함됨)

### 사용자 PC에서 업데이트 체크가 안 됨
- 앱이 **정식 설치된 상태** (npm run dev 가 아님) 인지 확인 — dev 모드에서는 업데이터가 비활성
- `%APPDATA%\EduOps 포털\logs\*.log` 에서 `electron-updater` 관련 에러 확인
- 사내 방화벽/프록시가 GitHub API (`api.github.com`) 또는 `github-releases.githubusercontent.com` 을 막고 있지 않은지 확인

### SmartScreen 경고를 없애고 싶다면
코드 서명 인증서 구매 필요:
- **OV (Organization Validation)**: Sectigo / DigiCert 등에서 연 $200~400, 평판 쌓이기까지 수개월
- **EV (Extended Validation)**: 연 $300~600, 즉시 SmartScreen 통과 (USB dongle 또는 HSM 필요)
- 구매 후 `.pfx` 파일을 받으면 GitHub Actions secrets 에 base64로 넣고 `CSC_LINK` / `CSC_KEY_PASSWORD` 환경변수로 electron-builder 에 전달하면 자동 서명됩니다.

---

## 7. 버전 규칙 (권장)

[Semantic Versioning](https://semver.org/) 기준:
- **MAJOR** — DB 스키마 breaking change, 결재/QA 프로세스 구조 변경
- **MINOR** — 새 페이지/기능 추가, IPC 확장
- **PATCH** — 버그 수정, 문구/UI 미세조정, 스키마에 영향 없는 변경

`CHANGELOG.md` 를 버전 올릴 때마다 업데이트하면 사용자가 릴리스 페이지에서 바로 뭐가 바뀌었는지 볼 수 있습니다.

---

## 8. 한 번에 보는 체크리스트

**최초 1회**
- [ ] GitHub 저장소 생성
- [ ] `package.json` `repository.url` 반영
- [ ] `git push -u origin main`
- [ ] 저장소 Settings → Actions → Workflow permissions = Read and write

**매 릴리스마다**
- [ ] 변경사항 커밋
- [ ] `npm version patch|minor|major`
- [ ] `git push origin main --follow-tags`
- [ ] Actions 탭에서 빌드 성공 확인
- [ ] Releases 페이지에서 릴리스 노트 확인 후 "Publish release"
- [ ] 팀 공지방에 버전업 사실 공유

**최초 사용자 설치 시**
- [ ] Releases 페이지에서 `EduOps-Portal-Setup-X.Y.Z.exe` 다운로드
- [ ] SmartScreen 경고 → "추가 정보 > 실행"
- [ ] 설치 후 로그인
- [ ] 이후 업데이트는 앱 내부에서 자동 처리
