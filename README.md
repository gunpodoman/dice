# Dice Frontline Solo

GitHub Pages에서 바로 실행할 수 있는 정적 웹 게임 버전입니다.

## 현재 구현된 기능

1. 서버 없이 동작하는 솔로 생존 모드
2. 30초 단위 무한 웨이브
3. 5웨이브마다 보스 출현
4. 3행 5열 주사위 전장
5. 무작위 주사위 소환
6. 같은 종류와 같은 눈금 주사위 합성
7. 합성 결과의 종류 무작위 변경과 눈금 상승
8. 화염, 빙결, 폭발, 맹독, 속사 주사위
9. 종류별 개별 강화
10. SP, 하트, 처치 수, 점수 시스템
11. 일시정지와 재시작
12. 브라우저 로컬 저장소를 이용한 최고 기록 저장
13. PC와 모바일 반응형 화면

## 실행 방법

압축을 풀고 `index.html`을 더블클릭하면 바로 실행됩니다.

로컬 웹 서버를 사용하려면 해당 폴더에서 다음 명령을 실행할 수 있습니다.

```powershell
python -m http.server 8000
```

이후 브라우저에서 다음 주소로 접속합니다.

```text
http://localhost:8000
```

## GitHub Pages 배포

1. GitHub 저장소의 최상위 폴더에 이 프로젝트의 파일을 업로드합니다.
2. 저장소의 Settings로 이동합니다.
3. Pages 메뉴를 엽니다.
4. Deploy from a branch를 선택합니다.
5. main 브랜치와 /root 폴더를 선택합니다.
6. Save를 누릅니다.

별도의 빌드 과정이나 Node.js 서버가 필요하지 않습니다.

## 온라인 모드 확장 위치

현재 온라인 대전 버튼은 화면에만 준비되어 있습니다. Firebase 연동 단계에서는 다음 데이터를 Realtime Database 또는 Firestore에 저장하는 구조로 확장할 수 있습니다.

```text
rooms/{roomCode}/players/{uid}
rooms/{roomCode}/state
rooms/{roomCode}/commands
rooms/{roomCode}/heartbeat
```

멀티플레이를 구현할 때는 한 명을 호스트로 정해 게임 상태를 계산하고, 상대는 소환과 합성 같은 명령만 전송하는 구조가 단순합니다. 다만 완전한 부정행위 방지를 위해서는 Cloud Functions나 별도 권한형 서버가 필요합니다.

## 주요 밸런스 수정 위치

`game.js`의 상단에서 다음 항목을 조정할 수 있습니다.

```text
CONFIG
DICE
enemyBaseHp
spawnInterval
spawnEnemy
upgradeCost
```

## 저작권 관련

장르의 핵심 규칙에서 영감을 받았지만 게임명, 그래픽, 문구, 화면 구성은 별도로 제작했습니다. 공개 배포 시 타사 게임의 로고, 캐릭터, 효과음, 주사위 외형과 UI를 그대로 사용하는 것은 피해야 합니다.
