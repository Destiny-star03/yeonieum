# 연이음 시각 방향

2026-11-12 사용자 확정: **B안 — 학교 심볼 + 연이음**. 글씨는 동글동글한 한글 서체, 색상은 제공한 ‘고요한 리넨’ 팔레트를 따른다. 앞선 흑백 팔레트·A안 임시 적용은 이번 선택으로 대체한다.

| 용도 | 색상 |
|---|---|
| 기본 배경 | #F7F3EE |
| 보조 면·배지 | #E6DED4 |
| 구분선·중간색 | #C9BFB4 |
| 보조 글자·선택 메뉴 | #6B625B |
| 본문·메뉴 배경·주요 버튼 | #1F1D1B |

카드는 같은 계열의 밝은 #FFFDF9를 사용한다. 밝은 두 배경을 구분하고 주요 텍스트에는 짙은 색을 사용한다. 상태는 색상만으로 구분하지 않고 문구·명암을 함께 쓴다.

학교 로고와 커너비는 사용자가 제공한 PNG 원본이다. 자르기·색 변경·배경 제거·재그리기를 하지 않았다. 학교 심볼은 연이음 워드마크와 결합하고, 커너비는 로그인 안내에 원래 색상으로 사용한다.

- `apps/web/public/brand/university-symbol.png`: 사용자 제공 ui_01_1.png
- `apps/web/public/brand/cornbee.png`: 사용자 제공 9DECAC.png

## 둥근 서체

네이버 **나눔스퀘어라운드**를 사용한다. 본문 Regular 400, 굵은 글자 Bold 700, 연이음 워드마크 ExtraBold 800을 사용한다. 웹폰트는 공식 파일을 수정 없이 로컬에 포함하여 외부 CDN 연결 없이 표시한다. `apps/web/public/fonts/nanum-square-round/LICENSE.txt`에 공식 저작권·라이선스 전문을 보존했다.

- [공식 글꼴 소개](https://campaign.naver.com/nanumsquare_neo/)
- [공식 배포 CSS](https://hangeul.pstatic.net/hangeul_static/css/nanum-square-round.css)
- [공식 라이선스](https://help.naver.com/service/30016/contents/18088?osType=PC)

개발 서버 `/brand.html`은 확정된 로고의 밝은 배경·어두운 배경·작은 크기와 팔레트를 확인하는 브랜드 미리보기다. 기본 앱 빌드 진입점은 아니다.
