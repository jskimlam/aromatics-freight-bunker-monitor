# Aromatics Freight & Bunker Monitor

운임·벙커 대시보드 운영 저장소.

## Admin CMS
- `Code.gs` : Google Sheet 바운드 Apps Script 백엔드
- `Admin.html` : 관리자 업로드/미리보기/Google Sheet 저장/GitHub 발행
- 관리자 URL: Apps Script 웹앱 URL + `?page=admin`

## HTML 저장 구조
- `REPORT_MASTER` : 날짜별 발행 인덱스
- `DAILY_HTML` : 독립형 HTML 원본을 40,000자 청크로 분할 저장
- `PRICE_RAW` : 운임·벙커·참고 시계열 원본
- `DAILY_COMMENTARY` : 1~6 섹션 데일리 브리핑 원문
- `META` : 지표 표시 메타
- `UPDATE_LOG` : 저장/발행 로그

## GitHub 발행 경로
`reports/YYYY/MM/YYYY-MM-DD/index.html`

최신본 복사:
`latest.html`