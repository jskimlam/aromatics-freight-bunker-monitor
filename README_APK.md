# F/B LAM Android App

- 앱 이름: F/B LAM
- 패키지: `com.lam.freightbunker`
- 표시 대상: GitHub Pages의 `latest.html`
- 데일리 HTML이 GitHub에 새로 발행되면 APK 재설치 없이 최신 리포트 표시
- 앱 아이콘: `assets/fb_lam_app_icon.jpg`

## APK 빌드

GitHub Actions의 **Build Android APK** 워크플로 실행 후
`FB-LAM-APK` 아티팩트에서 `app-debug.apk` 다운로드.

## 운영 전제

GitHub Pages를 `main / root` 기준으로 활성화하고,
Admin 발행 시 `latest.html` 업데이트를 사용.
