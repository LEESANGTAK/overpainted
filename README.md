# The Overpainted — 프로토타입 & 솔버

그림마다 한 사람이 덧칠되어 지워져 있습니다. 빈칸을 두드려 같은 안료를 녹여내고, 원래 그림을 복원하는 퍼즐입니다.
개발 과정과 결정의 이유는 [개발 일지](docs/devlog.md)에 있습니다.

## 플레이 테스트 해주시는 분께
**https://leesangtak.github.io/overpainted/** 를 열고 플레이한 다음, 탭을 닫으면 끝입니다. 기록은 자동으로 전송됩니다.
(디자이너용 셋업: [docs/playtest-setup.md](docs/playtest-setup.md))

<details><summary>링크 대신 직접 받아서 실행하는 방법</summary>

1. [Node.js](https://nodejs.org) **20.11 이상**을 설치합니다 (설치 외에 추가 패키지는 필요 없습니다).
2. 받아서 실행합니다.
   ```
   git clone https://github.com/LEESANGTAK/overpainted.git
   cd overpainted
   node tools/serve.mjs
   ```
3. 브라우저에서 http://localhost:5173 을 열고 1번부터 순서대로 플레이해 주세요.
   - 막히면 그만두거나 다음 레벨로 넘어가도 괜찮습니다. 그것도 소중한 데이터입니다.
   - 힌트(H)와 개발자 오버레이(D)는 되도록 쓰지 말아 주세요.
4. 다 하셨으면 `playtests/` 폴더에 생긴 `.jsonl` 파일을 보내 주세요. 수를 둔 기록만 있고 개인정보는 없습니다.

</details>

## 실행
Windows에서는 **`play.bat`을 더블클릭**하면 서버가 켜지고 브라우저에 게임이 열립니다 (창을 닫으면 꺼짐).

```
node tools/serve.mjs        # http://localhost:5173/prototype/
node tools/test.mjs         # 규칙/솔버 테스트
```

## 구조
| 경로 | 역할 |
|---|---|
| `core/rules.js` | 게임 규칙 (브라우저·Node 공용). 레벨 텍스트 포맷 설명 포함 |
| `core/solver.js` | 전수 탐색 솔버 + 난이도 지표 |
| `core/traps.js` | 중반 함정: 판을 못 깨게 만든 수를 레벨의 `traps`와 맞춘다 (덧칠꾼 대사용, 지금 게임에서는 쓰지 않음) |
| `prototype/mood.js` | 배경음악과 음소거. 판이 틀어진 뒤 늦게, 평온한 곡에서 어두운 곡으로 넘어간다 |
| `tools/music.mjs` | ElevenLabs로 배경음악 두 곡 생성 (`ELEVENLABS_API_KEY`, Music Generation 권한 필요) |
| `prototype/audio/` | 생성된 음악 (calm, lost) |
| `tools/solve.mjs` | 레벨 파일 분석 (`--write`로 par/metrics 기록) |
| `tools/generate.mjs` | 후보 레벨 생성 (랜덤 → 힐클라이밍) |
| `prototype/` | 플레이 + 에디터 (D: 개발 오버레이, H: 힌트, Z: 언두, R: 재시작) |
| `levels/prototype.json` | 현재 프로토타입 레벨 12개 |

## 플레이테스트 기록
`serve.mjs`로 띄운 프로토타입은 플레이를 자동으로 `playtests/<세션>.jsonl`에 기록합니다 (헤더의 ● REC).
```
node tools/playtest.mjs     # 레벨별 표 + playtests/report.json (수별 타임라인)
```
`playtests/designer/`에는 디자이너 본인의 세션이 따로 있습니다 (분석: `node tools/playtest.mjs playtests/designer/*.jsonl`).
모든 수를 솔버로 다시 두어 **블런더**(풀 수 있던 판을 못 풀게 만든 수)와, 그걸 알아채기까지 걸린 수·시간을 계산합니다.
개발 오버레이(D)나 최적해 재생을 쓴 레벨은 `dev` / `replay` 플래그가 붙습니다.

## 첫 수 예측기
플레이어가 계산하기 전에 본능적으로 고를 수를 예측하고, 그 수가 지는 수인지 판정합니다 (`core/predict.js`).
```
node tools/predict.mjs                        # 레벨별 본능 수 / 지는 수인지 / 본능대로 두면 질 확률
node tools/predict.mjs --calibrate [--save]   # 플레이 기록으로 정확도 측정 + 가중치 재조정
```
요인: 한 색을 끝내는 수(closes), 가장 적은 색(rarest), 타일 수, 일직선 쌍, 거리, 바니시, 빨강.
`levels/predict-weights.json`이 있으면 도구와 에디터 Analyze 패널이 그 가중치를 씁니다.
함정 레벨은 "Instinct move … LOSES"가, 쉬운 레벨은 "is safe"가 나와야 합니다.

## 레벨 포맷
`.` 빈칸 · `A`~`F` 안료 타일 · `a`~`f` 바니시(2회 타격) · `#` 오래된 테이프(제거 불가, 시야 차단) · `under` 줄: 두 겹 아래 색 · `mix` 줄: 한 겹 타일에 섞은 두 번째 색(두 색 모두와 짝) · `tape: N`: 플레이어 테이프 장 수

## 난이도 지표
- **par**: 최소 타격 수 (3별 기준)
- **pRandom / trap bits**: 무작위로 둘 때 클리어 확률. trap bits = −log₂(pRandom)
- **safe first strikes**: 첫 수 중 풀이 가능 상태를 유지하는 수 / 전체
- **optimal lines**: par로 클리어하는 서로 다른 수순 개수 (적을수록 "아하" 순간이 날카로움)

## 생성기 예시
```
node tools/generate.mjs --w 6 --h 6 --tiles 14 --colors 3 --blockers 2 --varnish 2 --count 6 --climb 200 --max-trap 8
```
생성기 결과는 **후보**입니다. 에디터에서 다듬고 큐레이션해서 출시 레벨로 만듭니다.
