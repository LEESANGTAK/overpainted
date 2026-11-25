# 플레이 테스트 셋업 — 링크 하나로 테스트하고, 기록은 자동으로

테스터는 **링크를 열고 → 플레이하고 → 탭을 닫으면 끝**입니다.
플레이 기록은 플레이하는 동안 계속, 그리고 탭을 닫는 순간 마지막까지 **디자이너의 Google 시트**로 전송됩니다.

```
테스터 브라우저 ──(기록)──▶ Google Apps Script 웹 앱 ──▶ Google 시트 "events"
                                                         │
디자이너:  node tools/pull-playtests.mjs  ◀──(READ_KEY)──┘   →  playtests/*.jsonl  →  node tools/playtest.mjs
```

처음 한 번만 아래 A, B를 설정하면 됩니다.

---

## A. 기록 받는 곳 만들기 (Google 시트 + Apps Script, 약 5분)

1. https://sheets.new 에서 새 스프레드시트를 만들고 이름을 `Overpainted Playtests`로 바꿉니다.
2. 메뉴 **확장 프로그램 → Apps Script**를 엽니다.
3. 편집기에 있는 기본 코드를 모두 지우고, [`tools/collector/Code.gs`](../tools/collector/Code.gs)의 내용을 붙여넣은 뒤 저장(💾)합니다.
4. 왼쪽 **⚙ 프로젝트 설정 → 스크립트 속성 → 스크립트 속성 추가**
   - 속성: `READ_KEY`
   - 값: [`playtests/collector.json`](../playtests/collector.json)의 `"key"` 값 (이미 만들어 두었습니다. 이 파일은 git에 올라가지 않습니다.)
5. 오른쪽 위 **배포 → 새 배포**
   - 유형 선택(⚙): **웹 앱**
   - 실행 계정: **나**
   - 액세스 권한이 있는 사용자: **모든 사용자**
   - **배포** → 권한 승인. "Google에서 확인하지 않은 앱" 화면이 나오면 **고급 → (프로젝트 이름)(으)로 이동**을 누릅니다. 본인이 만든 스크립트라 괜찮습니다.
6. 나오는 **웹 앱 URL**(`https://script.google.com/macros/s/…/exec`)을 복사해서 Claude에게 알려주세요.
   그러면 Claude가 `prototype/config.js`와 `playtests/collector.json`에 넣고 올립니다.

> 이 URL은 기록을 **추가**만 할 수 있습니다. 읽으려면 READ_KEY가 필요해서, URL이 공개 저장소에 있어도 다른 사람이 기록을 볼 수는 없습니다.
> `Code.gs`를 고친 경우에는 **배포 → 배포 관리 → ✏ → 버전: 새 버전**으로 다시 배포해야 반영됩니다 (URL은 그대로).

## B. 게임을 웹에 올리기 (GitHub Pages, 약 1분)

1. https://github.com/LEESANGTAK/overpainted/settings/pages
2. **Source: Deploy from a branch** → Branch: **main**, 폴더: **/ (root)** → **Save**
3. 1–2분 뒤 https://leesangtak.github.io/overpainted/ 에서 열립니다. 이후에는 `main`에 푸시할 때마다 자동으로 갱신됩니다.

---

## Godot판 (2026-11-26부터)

- 링크: `https://leesangtak.github.io/overpainted/play/` (`?t=이름` 가능). 데모 범위(1~5장)만 들어 있다.
- 기록은 같은 시트로 간다. 세션 첫 기록에 `engine: "godot"`이 붙어서 프로토타입 기록과 나뉜다. `pull-playtests.mjs`와 `playtest.mjs`는 그대로 쓴다.
- 이 링크가 열리려면 한 번: 저장소 Settings → Pages → Source를 **GitHub Actions**로 바꾼다 (`.github/workflows/pages.yml`이 프로토타입과 Godot판을 함께 올린다). 바꾼 직후 Actions가 한 번 성공할 때까지 사이트가 비어 있을 수 있으니, 테스트가 없는 시간에 바꾼다.
- PC·Steam Deck용으로 내보낸 빌드도 같은 시트로 기록한다 (내보내기 설정의 `playtest` 표시).

## 테스터에게 보내기

- 모두에게 같은 링크: `https://leesangtak.github.io/overpainted/`
- 영어 테스터: `…/overpainted/?lang=en`

처음 열면 안내가 한 번 나옵니다: 순서대로 플레이, 막히면 넘어가도 됨, 힌트 자제, 평가 버튼, **다 하면 탭만 닫기**, 어떤 기록이 전송되는지, 그리고 **이름(또는 별명) 입력칸**. 이름을 넣어야 시작할 수 있고, 그 브라우저에서는 기억되어 다시 묻지 않습니다 (헤더에 `● 녹화 · 이름`으로 표시).
`?t=이름`을 붙인 링크를 보내면 이름 칸이 미리 채워집니다.
테스터용 웹 빌드에서는 에디터 탭이 숨겨집니다.

## 기록 가져와서 분석하기

```
node tools/pull-playtests.mjs       # 시트의 모든 세션 → playtests/<세션>.jsonl
node tools/playtest.mjs             # 레벨별 분석
node tools/predict.mjs --calibrate  # 첫 수 예측기를 테스터 데이터로 재조정
```

시트에서도 바로 볼 수 있습니다 (`events` 탭: 받은 시각 · 세션 · 이벤트).

## 참고

- 디자이너가 `node tools/serve.mjs`로 로컬에서 플레이한 기록은 **시트로 가지 않고** 지금처럼 `playtests/`에만 저장됩니다. 테스터 데이터와 섞이지 않게 하기 위해서입니다.
- 테스트용으로 로컬에서도 시트로 보내 보려면 브라우저 콘솔에서 `localStorage.setItem('overpainted.collector', '<웹 앱 URL>')`.
- 포커스 그룹: 같은 링크를 여러 PC에서 열면 됩니다. 세션 이름에 임의 문자가 붙어서 동시에 해도 섞이지 않습니다.
- 브라우저가 갑자기 종료되면 마지막 2초 정도의 기록은 빠질 수 있습니다. 그 전까지는 2초마다 전송됩니다.
