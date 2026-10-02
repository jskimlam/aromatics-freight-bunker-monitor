/**
 * Aromatics Freight & Bunker Monitor
 * Google Sheet bound Apps Script / Admin CMS
 *
 * Admin UI:
 *   ?page=admin
 *
 * Public read API:
 *   ?action=ping
 *   ?action=listReports&limit=100
 *   ?action=getReportHtml&date=2026-09-28
 *
 * Upload filename (recommended):
 *   freight_YYYYMMDD.html
 *   e.g. freight_20260925.html
 *
 * Backward compatible:
 *   freight_bunker_dashboard_YYYY-MM-DD.html
 *   freight_bunker_dashboard_YYYY-MM-DD_research.html
 */

const APP = {
  VERSION: '1.2.1',
  TZ: 'Asia/Seoul',
  HTML_CHUNK_SIZE: 40000,

  SHEETS: {
    MASTER: 'REPORT_MASTER',
    HTML: 'DAILY_HTML',
    PRICE: 'PRICE_RAW',
    COMMENTARY: 'DAILY_COMMENTARY',
    META: 'META',
    LOG: 'UPDATE_LOG'
  },

  HEADERS: {
    REPORT_MASTER: [
      'date','title','filename','view_url','github_path',
      'status','html_chars','html_chunks','created_at','updated_at'
    ],
    DAILY_HTML: [
      'date','chunk_index','html_chunk','batch_id','total_chunks'
    ],
    DAILY_COMMENTARY: [
      'date','title','price','commentary','drivers',
      'outlook','extra','ai_analysis','raw_text','updated_at'
    ],
    META: [
      'symbol','group','korean_name','short_name',
      'unit','frequency','display_order','active'
    ],
    UPDATE_LOG: [
      'timestamp','data_date','type','status','note'
    ]
  },

  DEFAULT_GITHUB_OWNER: 'jskimlam',
  DEFAULT_GITHUB_REPO: 'aromatics-freight-bunker-monitor',
  DEFAULT_GITHUB_BRANCH: 'main',
  DEFAULT_PAGES_BASE: 'https://jskimlam.github.io/aromatics-freight-bunker-monitor'
};


/* =========================================================
 * 1. ONE-TIME SETUP
 * ========================================================= */

function setupAromaticsMonitor() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  ensureSheet_(ss, APP.SHEETS.MASTER, APP.HEADERS.REPORT_MASTER);
  ensureSheet_(ss, APP.SHEETS.HTML, APP.HEADERS.DAILY_HTML);
  ensurePriceRawSheet_(ss);
  ensureSheet_(ss, APP.SHEETS.COMMENTARY, APP.HEADERS.DAILY_COMMENTARY);
  ensureMetaSheet_(ss);
  ensureSheet_(ss, APP.SHEETS.LOG, APP.HEADERS.UPDATE_LOG);

  const props = PropertiesService.getScriptProperties();

  if (!props.getProperty('GITHUB_OWNER')) {
    props.setProperty('GITHUB_OWNER', APP.DEFAULT_GITHUB_OWNER);
  }
  if (!props.getProperty('GITHUB_REPO')) {
    props.setProperty('GITHUB_REPO', APP.DEFAULT_GITHUB_REPO);
  }
  if (!props.getProperty('GITHUB_BRANCH')) {
    props.setProperty('GITHUB_BRANCH', APP.DEFAULT_GITHUB_BRANCH);
  }
  if (!props.getProperty('GITHUB_PAGES_BASE')) {
    props.setProperty('GITHUB_PAGES_BASE', APP.DEFAULT_PAGES_BASE);
  }

  const result = {
    ok: true,
    message: 'Aromatics Freight & Bunker DB setup complete.',
    spreadsheetId: ss.getId(),
    spreadsheetName: ss.getName(),
    sheets: Object.values(APP.SHEETS),
    github: githubConfig_(),
    adminPasswordConfigured: !!props.getProperty('ADMIN_PASSWORD_HASH')
  };

  console.log(JSON.stringify(result, null, 2));
  return result;
}


function setAdminPasswordFromPrompt() {
  const ui = SpreadsheetApp.getUi();
  const r = ui.prompt(
    '운임·벙커 관리자 비밀번호 설정',
    '관리자 업로드 화면에서 사용할 비밀번호를 입력하세요. (6자 이상)',
    ui.ButtonSet.OK_CANCEL
  );

  if (r.getSelectedButton() !== ui.Button.OK) return;

  const pw = String(r.getResponseText() || '');
  if (pw.length < 6) {
    ui.alert('비밀번호는 6자 이상으로 설정해 주세요.');
    return;
  }

  PropertiesService.getScriptProperties()
    .setProperty('ADMIN_PASSWORD_HASH', sha256_(pw));

  ui.alert('관리자 비밀번호가 저장되었습니다.');
}


/* =========================================================
 * 2. WEB APP ENTRY POINT
 * ========================================================= */

function doGet(e) {
  const p = (e && e.parameter) ? e.parameter : {};

  if (String(p.page || '') === 'admin') {
    return HtmlService
      .createTemplateFromFile('Admin')
      .evaluate()
      .setTitle('Aromatics Freight & Bunker Admin')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  }

  try {
    const action = String(p.action || 'ping');

    switch (action) {
      case 'ping':
        return jsonOut_({
          ok: true,
          service: 'Aromatics Freight & Bunker Archive API',
          version: APP.VERSION,
          time: now_()
        });

      case 'listReports':
        return jsonOut_(listReports_(toInt_(p.limit, 100)));

      case 'getReportHtml':
        requireDate_(p.date);
        return jsonOut_(getReportHtml_(p.date));

      default:
        throw new Error('Unknown action: ' + action);
    }

  } catch (err) {
    return jsonOut_({
      ok: false,
      error: String(err && err.message ? err.message : err)
    });
  }
}


/* =========================================================
 * 3. ADMIN API
 * ========================================================= */

function getAdminConfig(adminPassword) {
  verifyAdminPassword_(adminPassword);

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const github = githubConfig_();
  const githubAuth = checkGithubToken_();

  return {
    ok: true,
    version: APP.VERSION,
    spreadsheetId: ss.getId(),
    spreadsheetName: ss.getName(),
    github: Object.assign({}, github, githubAuth),
    htmlChunkSize: APP.HTML_CHUNK_SIZE,
    recent: listReports_(30).reports
  };
}


function checkGithubToken_() {
  const token = PropertiesService.getScriptProperties().getProperty('GITHUB_TOKEN');
  const cfg = githubConfig_();

  if (!token) {
    return {
      tokenConfigured: false,
      tokenValid: false,
      tokenStatus: 'missing',
      tokenMessage: 'GitHub Token이 설정되어 있지 않습니다.'
    };
  }

  try {
    assertGithubTarget_(cfg);

    const url = 'https://api.github.com/repos/' +
      encodeURIComponent(cfg.owner) + '/' + encodeURIComponent(cfg.repo);

    const res = UrlFetchApp.fetch(url, {
      method: 'get',
      headers: githubHeaders_(token),
      muteHttpExceptions: true
    });

    const code = res.getResponseCode();

    if (code >= 200 && code < 300) {
      return {
        tokenConfigured: true,
        tokenValid: true,
        tokenStatus: 'ok',
        tokenMessage: 'GitHub Token 인증 정상'
      };
    }

    return {
      tokenConfigured: true,
      tokenValid: false,
      tokenStatus: 'invalid',
      tokenMessage: 'GitHub Token 인증 실패 (' + code + '): ' +
        trimText_(res.getContentText(), 180)
    };

  } catch (err) {
    return {
      tokenConfigured: true,
      tokenValid: false,
      tokenStatus: 'error',
      tokenMessage: String(err && err.message ? err.message : err)
    };
  }
}


function saveGithubTokenFromAdmin(adminPassword, token) {
  verifyAdminPassword_(adminPassword);

  token = String(token || '').trim();
  if (!token) throw new Error('GitHub Token이 비어 있습니다.');

  const cfg = githubConfig_();
  const url = 'https://api.github.com/repos/' +
    encodeURIComponent(cfg.owner) + '/' + encodeURIComponent(cfg.repo);

  const res = UrlFetchApp.fetch(url, {
    method: 'get',
    headers: githubHeaders_(token),
    muteHttpExceptions: true
  });

  if (res.getResponseCode() < 200 || res.getResponseCode() >= 300) {
    throw new Error(
      'GitHub Token 검증 실패 (' + res.getResponseCode() + '): ' +
      trimText_(res.getContentText(), 240)
    );
  }

  PropertiesService.getScriptProperties()
    .setProperty('GITHUB_TOKEN', token);

  return {
    ok: true,
    tokenValid: true,
    tokenStatus: 'ok',
    tokenMessage: 'GitHub Token 검증·저장 완료',
    githubTarget: cfg.owner + '/' + cfg.repo + '@' + cfg.branch
  };
}


/**
 * payload = {
 *   adminPassword,
 *   fileName,
 *   htmlText,
 *   publishToGithub: true|false
 * }
 */
function saveHtmlFromAdmin(payload) {
  payload = payload || {};
  verifyAdminPassword_(payload.adminPassword);

  const fileName = String(payload.fileName || '').trim();
  const htmlText = String(payload.htmlText || '');
  const publishToGithub = payload.publishToGithub === true;

  if (!htmlText) throw new Error('HTML 파일 내용이 비어 있습니다.');

  const info = classifyFilename_(fileName);
  const validation = validateStandaloneHtml_(htmlText, info.date);

  const title = extractTitle_(htmlText, info.date);
  const chunks = splitHtml_(htmlText);
  const overwritten = reportAlreadyExists_(info.date);

  const batchId = Utilities.getUuid();
  saveHtmlChunks_(info.date, chunks, batchId);

  let githubPath = '';
  let viewUrl = '';
  let githubStatus = 'sheet-only';
  let githubVerified = false;
  let githubSha = '';
  let latestSha = '';
  let contentHash = sha256Text_(htmlText);

  try {
    if (publishToGithub) {
      const cfg = githubConfig_();
      assertGithubTarget_(cfg);

      if (!cfg.tokenConfigured) {
        throw new Error('GitHub Token이 설정되어 있지 않습니다.');
      }

      githubPath = buildGithubPath_(info.date);

      const datedWrite = publishGithubHtml_(githubPath, htmlText, info.date, false);
      const datedVerify = verifyGithubHtml_(githubPath, htmlText, info.date);

      const latestWrite = publishGithubHtml_('latest.html', htmlText, info.date, true);
      const latestVerify = verifyGithubHtml_('latest.html', htmlText, info.date);

      githubSha = datedVerify.sha || (datedWrite && datedWrite.content ? datedWrite.content.sha : '');
      latestSha = latestVerify.sha || (latestWrite && latestWrite.content ? latestWrite.content.sha : '');

      if (!datedVerify.ok || !latestVerify.ok) {
        throw new Error('GitHub 발행 검증에 실패했습니다.');
      }

      githubVerified = true;
      viewUrl = cfg.pagesBase.replace(/\/+$/, '') + '/' + githubPath;
      githubStatus = 'published-verified';
    }

    upsertMaster_({
      date: info.date,
      title: title,
      filename: fileName,
      viewUrl: viewUrl,
      githubPath: githubPath,
      status: githubStatus,
      htmlChars: htmlText.length,
      htmlChunks: chunks.length
    });

    writeLog_(
      info.date,
      publishToGithub ? 'HTML_SAVE_PUBLISH' : 'HTML_SAVE',
      'OK',
      fileName + ' · ' + htmlText.length + ' chars · ' + chunks.length +
        ' chunks' + (githubVerified ? ' · GitHub verified' : '')
    );

    return {
      ok: true,
      date: info.date,
      title: title,
      fileName: fileName,
      overwritten: overwritten,
      originalHtmlSaved: true,
      htmlChars: htmlText.length,
      htmlChunks: chunks.length,
      githubPublished: publishToGithub && githubVerified,
      githubVerified: githubVerified,
      githubPath: githubPath,
      githubUrl: viewUrl,
      githubSha: githubSha,
      latestSha: latestSha,
      contentHash: contentHash,
      githubTarget: APP.DEFAULT_GITHUB_OWNER + '/' + APP.DEFAULT_GITHUB_REPO + '@' + APP.DEFAULT_GITHUB_BRANCH,
      warnings: validation.warnings
    };

  } catch (err) {
    writeLog_(
      info.date,
      publishToGithub ? 'HTML_SAVE_PUBLISH' : 'HTML_SAVE',
      'ERROR',
      fileName + ' · ' + String(err && err.message ? err.message : err)
    );
    throw err;
  }
}

function getRecentReportsFromAdmin(adminPassword, limit) {
  verifyAdminPassword_(adminPassword);
  return listReports_(toInt_(limit, 30));
}


function getStoredHtmlFromAdmin(adminPassword, date) {
  verifyAdminPassword_(adminPassword);
  requireDate_(date);
  return getReportHtml_(date);
}


/* =========================================================
 * 4. HTML VALIDATION
 * ========================================================= */

function classifyFilename_(fileName) {
  fileName = String(fileName || '').trim();

  // Recommended short filename: freight_YYYYMMDD.html
  let m = /^freight_(\d{4})(\d{2})(\d{2})\.html$/i.exec(fileName);
  if (m) {
    const date = m[1] + '-' + m[2] + '-' + m[3];
    requireDate_(date);
    return {date: date};
  }

  // Backward compatibility with the original long filename.
  m = /^freight_bunker_dashboard_(\d{4}-\d{2}-\d{2})(?:_[A-Za-z0-9_-]+)?\.html$/i.exec(fileName);
  if (m) {
    requireDate_(m[1]);
    return {date: m[1]};
  }

  throw new Error(
    '파일명은 freight_YYYYMMDD.html 형식을 사용해 주세요. 예: freight_20260925.html'
  );
}


function validateStandaloneHtml_(htmlText, filenameDate) {
  const html = String(htmlText || '');
  const warnings = [];

  if (!/<html\b/i.test(html) || !/<body\b/i.test(html)) {
    throw new Error('독립형 HTML의 <html> 또는 <body> 구조를 찾을 수 없습니다.');
  }

  if (!/<\/html\s*>/i.test(html) || !/<\/body\s*>/i.test(html)) {
    throw new Error('독립형 HTML의 닫는 </html> 또는 </body> 태그가 없습니다.');
  }

  const doctypes = html.match(/<!doctype\s+html\b/gi) || [];
  if (doctypes.length > 1) {
    warnings.push('DOCTYPE이 ' + doctypes.length + '개 감지됨');
  }

  // Project invariant: no external runtime dependency.
  const remoteScript = /<script\b[^>]*\bsrc\s*=\s*["']https?:\/\//i.test(html);
  const remoteStyle = /<link\b[^>]*\bhref\s*=\s*["']https?:\/\//i.test(html);
  const remoteImport = /@import\s+(?:url\()?["']?https?:\/\//i.test(html);

  if (remoteScript || remoteStyle || remoteImport) {
    throw new Error(
      '외부 CDN/라이브러리 의존성이 감지되었습니다. file:// 독립 실행본만 저장할 수 있습니다.'
    );
  }

  if (!/id\s*=\s*["']rawData["']/i.test(html)) {
    warnings.push('rawData 블록을 찾지 못함');
  }
  if (!/id\s*=\s*["']cmtData["']/i.test(html)) {
    warnings.push('cmtData 블록을 찾지 못함');
  }

  const embeddedDate = extractEmbeddedRawDate_(html);
  if (embeddedDate && embeddedDate !== filenameDate) {
    throw new Error(
      'HTML 내부 기준일(' + embeddedDate + ')과 파일명 날짜(' + filenameDate + ')가 다릅니다.'
    );
  }
  if (!embeddedDate) {
    warnings.push('HTML 내부 rawData 기준일을 자동 검증하지 못함');
  }

  return {
    ok: true,
    embeddedDate: embeddedDate,
    warnings: warnings
  };
}


function extractEmbeddedRawDate_(htmlText) {
  const m = /<script\b[^>]*id\s*=\s*["']rawData["'][^>]*>([\s\S]*?)<\/script\s*>/i.exec(htmlText);
  if (!m) return '';

  try {
    const obj = JSON.parse(String(m[1] || '').replace(/<\\\//g, '</'));
    if (!obj || !Array.isArray(obj.d) || !obj.d.length) return '';
    return normalizeDate_(obj.d[obj.d.length - 1]);
  } catch (e) {
    return '';
  }
}


function extractTitle_(htmlText, date) {
  const all = [];
  const rx = /<title\b[^>]*>([\s\S]*?)<\/title\s*>/gi;
  let m;

  while ((m = rx.exec(htmlText)) !== null) {
    const t = stripHtml_(m[1]).trim();
    if (t) all.push(t);
  }

  return (all[all.length - 1] || ('Aromatics Freight & Bunker Monitor ' + date))
    .slice(0, 220);
}


/* =========================================================
 * 5. GOOGLE SHEET STORAGE
 * ========================================================= */

function saveHtmlChunks_(date, chunks, batchId) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(APP.SHEETS.HTML);
  if (!sh) throw new Error(APP.SHEETS.HTML + ' 시트가 없습니다.');

  const values = sh.getDataRange().getValues();

  // Delete old version for the same date from bottom.
  for (let r = values.length - 1; r >= 1; r--) {
    if (dateCell_(values[r][0]) === date) {
      sh.deleteRow(r + 1);
    }
  }

  const rows = chunks.map((chunk, i) => [
    date,
    i,
    chunk,
    batchId,
    chunks.length
  ]);

  if (rows.length) {
    sh.getRange(sh.getLastRow() + 1, 1, rows.length, 5).setValues(rows);
  }
}


function upsertMaster_(item) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(APP.SHEETS.MASTER);
  if (!sh) throw new Error(APP.SHEETS.MASTER + ' 시트가 없습니다.');

  const now = now_();
  const values = sh.getDataRange().getValues();
  let row = -1;

  for (let r = 1; r < values.length; r++) {
    if (dateCell_(values[r][0]) === item.date) {
      row = r + 1;
      break;
    }
  }

  let createdAt = now;
  if (row > 0) {
    createdAt = String(sh.getRange(row, 9).getDisplayValue() || now);
  }

  const record = [[
    item.date,
    item.title,
    item.filename,
    item.viewUrl,
    item.githubPath,
    item.status,
    item.htmlChars,
    item.htmlChunks,
    createdAt,
    now
  ]];

  if (row > 0) {
    sh.getRange(row, 1, 1, record[0].length).setValues(record);
  } else {
    sh.getRange(sh.getLastRow() + 1, 1, 1, record[0].length).setValues(record);
  }
}


function reportAlreadyExists_(date) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(APP.SHEETS.MASTER);
  if (!sh || sh.getLastRow() < 2) return false;

  const values = sh.getRange(2, 1, sh.getLastRow() - 1, 1).getValues();
  return values.some(r => dateCell_(r[0]) === date);
}


function listReports_(limit) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(APP.SHEETS.MASTER);

  if (!sh || sh.getLastRow() < 2) {
    return {ok: true, reports: []};
  }

  const values = sh
    .getRange(2, 1, sh.getLastRow() - 1, 10)
    .getDisplayValues();

  const reports = values.map(r => ({
    date: r[0],
    title: r[1],
    filename: r[2],
    viewUrl: r[3],
    githubPath: r[4],
    status: r[5],
    htmlChars: Number(r[6] || 0),
    htmlChunks: Number(r[7] || 0),
    createdAt: r[8],
    updatedAt: r[9]
  }))
  .filter(x => x.date)
  .sort((a, b) => a.date < b.date ? 1 : -1)
  .slice(0, Math.max(1, limit));

  return {ok: true, reports: reports};
}


function getReportHtml_(date) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(APP.SHEETS.HTML);

  if (!sh || sh.getLastRow() < 2) {
    throw new Error('저장된 HTML이 없습니다.');
  }

  const values = sh
    .getRange(2, 1, sh.getLastRow() - 1, 5)
    .getValues()
    .filter(r => dateCell_(r[0]) === date)
    .sort((a, b) => Number(a[1]) - Number(b[1]));

  if (!values.length) {
    throw new Error(date + ' 저장 HTML을 찾을 수 없습니다.');
  }

  const html = values.map(r => String(r[2] || '')).join('');
  const master = listReports_(500).reports.find(x => x.date === date);

  return {
    ok: true,
    date: date,
    fileName: master ? master.filename : ('freight_' + date.replace(/-/g, '') + '.html'),
    htmlText: html,
    htmlChars: html.length,
    chunks: values.length
  };
}


function writeLog_(dataDate, type, status, note) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(APP.SHEETS.LOG);
  if (!sh) return;

  sh.appendRow([
    now_(),
    dataDate || '',
    type || '',
    status || '',
    note || ''
  ]);
}


/* =========================================================
 * 6. GITHUB PUBLISH
 * ========================================================= */

function githubConfig_() {
  const p = PropertiesService.getScriptProperties();

  // 이 프로젝트는 발행 대상 저장소를 고정한다.
  // 과거 Script Properties에 남은 잘못된 owner/repo/branch 값으로
  // 다른 저장소에 '성공' 표시되는 문제를 원천 차단한다.
  return {
    owner: APP.DEFAULT_GITHUB_OWNER,
    repo: APP.DEFAULT_GITHUB_REPO,
    branch: APP.DEFAULT_GITHUB_BRANCH,
    pagesBase: APP.DEFAULT_PAGES_BASE,
    tokenConfigured: !!p.getProperty('GITHUB_TOKEN')
  };
}


function assertGithubTarget_(cfg) {
  const expected =
    APP.DEFAULT_GITHUB_OWNER + '/' +
    APP.DEFAULT_GITHUB_REPO + '@' +
    APP.DEFAULT_GITHUB_BRANCH;

  const actual =
    String(cfg.owner || '') + '/' +
    String(cfg.repo || '') + '@' +
    String(cfg.branch || '');

  if (actual !== expected) {
    throw new Error(
      'GitHub 발행 대상 불일치: ' + actual + ' (예상: ' + expected + ')'
    );
  }
}


function buildGithubPath_(date) {
  return 'freight_' + String(date || '').replace(/-/g, '') + '.html';
}


function publishGithubHtml_(path, htmlText, date, latestMode) {
  const cfg = githubConfig_();
  assertGithubTarget_(cfg);

  const token = PropertiesService.getScriptProperties().getProperty('GITHUB_TOKEN');
  if (!token) throw new Error('GitHub Token이 설정되어 있지 않습니다.');

  const endpoint = githubContentsEndpoint_(cfg, path);
  let lastMessage = '';

  // 동일 시점의 GitHub Actions / 재업로드와 SHA가 충돌할 수 있으므로
  // 최신 SHA를 다시 조회하여 최대 3회 재시도한다.
  for (let attempt = 1; attempt <= 3; attempt++) {
    const existingSha = getGithubFileSha_(cfg, token, path);

    const payload = {
      message: latestMode
        ? 'Update latest freight & bunker dashboard ' + date
        : 'Publish freight & bunker dashboard ' + date,
      content: Utilities.base64Encode(
        Utilities.newBlob(htmlText, 'text/html', 'index.html').getBytes()
      ),
      branch: cfg.branch
    };

    if (existingSha) payload.sha = existingSha;

    const res = UrlFetchApp.fetch(endpoint, {
      method: 'put',
      contentType: 'application/json',
      headers: githubHeaders_(token),
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    });

    const code = res.getResponseCode();
    const body = res.getContentText();

    if (code >= 200 && code < 300) {
      return JSON.parse(body);
    }

    lastMessage =
      'GitHub 발행 실패 (' + code + ', 시도 ' + attempt + '/3): ' +
      trimText_(body, 500);

    if (code !== 409 && code !== 422) break;
    Utilities.sleep(350 * attempt);
  }

  throw new Error(lastMessage || 'GitHub 발행 실패');
}


function verifyGithubHtml_(path, expectedHtml, expectedDate) {
  const cfg = githubConfig_();
  assertGithubTarget_(cfg);

  const token = PropertiesService.getScriptProperties().getProperty('GITHUB_TOKEN');
  if (!token) throw new Error('GitHub Token이 설정되어 있지 않습니다.');

  // GitHub Contents API의 read-after-write 결과를 실제로 다시 읽어 비교한다.
  // 잠깐의 일관성 지연에 대비하여 3회 확인한다.
  let last = null;

  for (let attempt = 1; attempt <= 3; attempt++) {
    const remote = getGithubFile_(cfg, token, path);
    last = remote;

    if (remote && remote.content != null) {
      const remoteDate = extractEmbeddedRawDate_(remote.content);
      const expectedHash = sha256Text_(expectedHtml);
      const remoteHash = sha256Text_(remote.content);

      if (
        remoteDate === expectedDate &&
        expectedHash === remoteHash &&
        String(remote.content).length === String(expectedHtml).length
      ) {
        return {
          ok: true,
          sha: remote.sha,
          date: remoteDate,
          hash: remoteHash,
          chars: String(remote.content).length
        };
      }
    }

    Utilities.sleep(350 * attempt);
  }

  const lastDate = last && last.content
    ? extractEmbeddedRawDate_(last.content)
    : '';

  throw new Error(
    'GitHub 발행 검증 실패: ' + path +
    ' · 예상 기준일 ' + expectedDate +
    ' · 확인 기준일 ' + (lastDate || '없음') +
    ' · 업로드 원본과 GitHub 저장본이 일치하지 않습니다.'
  );
}


function getGithubFile_(cfg, token, path) {
  const endpoint =
    githubContentsEndpoint_(cfg, path) +
    '?ref=' + encodeURIComponent(cfg.branch) +
    '&_=' + Date.now();

  const res = UrlFetchApp.fetch(endpoint, {
    method: 'get',
    headers: githubHeaders_(token),
    muteHttpExceptions: true
  });

  const code = res.getResponseCode();
  if (code === 404) return null;

  if (code < 200 || code >= 300) {
    throw new Error(
      'GitHub 파일 조회 실패 (' + code + '): ' +
      trimText_(res.getContentText(), 300)
    );
  }

  const obj = JSON.parse(res.getContentText());
  let content = '';

  if (String(obj.encoding || '').toLowerCase() === 'base64') {
    const clean = String(obj.content || '').replace(/\s/g, '');
    content = Utilities.newBlob(
      Utilities.base64Decode(clean)
    ).getDataAsString('UTF-8');
  } else {
    content = String(obj.content || '');
  }

  return {
    sha: String(obj.sha || ''),
    content: content
  };
}


function getGithubFileSha_(cfg, token, path) {
  const obj = getGithubFile_(cfg, token, path);
  return obj ? String(obj.sha || '') : '';
}


function githubContentsEndpoint_(cfg, path) {
  return 'https://api.github.com/repos/' +
    encodeURIComponent(cfg.owner) + '/' +
    encodeURIComponent(cfg.repo) + '/contents/' +
    path.split('/').map(encodeURIComponent).join('/');
}


function sha256Text_(text) {
  const bytes = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    String(text || ''),
    Utilities.Charset.UTF_8
  );

  return bytes.map(function(b) {
    const n = b < 0 ? b + 256 : b;
    return ('0' + n.toString(16)).slice(-2);
  }).join('');
}


function githubHeaders_(token) {
  return {
    Authorization: 'Bearer ' + token,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'Cache-Control': 'no-cache',
    'User-Agent': 'Aromatics-Freight-Bunker-Monitor'
  };
}

/* =========================================================
 * 7. SHEET INITIALIZATION
 * ========================================================= */

function ensureSheet_(ss, name, headers) {
  let sh = ss.getSheetByName(name);
  if (!sh) sh = ss.insertSheet(name);

  if (headers && headers.length) {
    const current = sh.getRange(1, 1, 1, headers.length).getDisplayValues()[0];
    const same = headers.every((h, i) => current[i] === h);

    if (!same) {
      sh.getRange(1, 1, 1, headers.length).setValues([headers]);
    }

    formatHeader_(sh, headers.length);
  }

  return sh;
}


function ensurePriceRawSheet_(ss) {
  let sh = ss.getSheetByName(APP.SHEETS.PRICE);
  if (!sh) sh = ss.insertSheet(APP.SHEETS.PRICE);

  const syms = [
    'NMCL001','PAAAD00','AAMFL00',
    'AAVBV00','AAVBU00','AAVCA00',
    'PXAEC00','PXASC00',
    'B3NSH00','PUAFR00','PUAEV00',
    'MFSKD00','MFJPD00','MFZHN00'
  ];

  const names = [
    'NYMEX Light Sweet Crude Settlement Mo01',
    'Naphtha C+F Japan Cargo $/mt (NextGen MOC)',
    'SM FOB Korea',
    'Korea→East China 2–3kt',
    'Korea→Taiwan 2–3kt',
    'Korea→East China 5kt',
    'PX India→East China',
    'PX India→South China/Taiwan',
    'HSFO Shanghai',
    'HSFO Korea',
    'HSFO Japan',
    'VLSFO Korea',
    'VLSFO Japan',
    'VLSFO Zhoushan (Delivered)'
  ];

  const units = [
    'BBL','MT','MT','MT','MT','MT','MT',
    'MT','MT','MT','MT','MT','MT','MT'
  ];

  sh.getRange(1, 1, 3, 15).setValues([
    ['Date'].concat(syms),
    ['Assessment'].concat(names),
    ['Unit'].concat(units)
  ]);

  formatHeader_(sh, 15);
  sh.setFrozenRows(3);
  sh.setFrozenColumns(1);
  return sh;
}


function ensureMetaSheet_(ss) {
  const headers = APP.HEADERS.META;
  let sh = ensureSheet_(ss, APP.SHEETS.META, headers);

  if (sh.getLastRow() > 1) return sh;

  const rows = [
    ['AAVBV00','운임 · 한국 출발','한국→동중국 2–3kt','KR→동중국 2–3kt','MT','영업일',1,true],
    ['AAVBU00','운임 · 한국 출발','한국→대만 2–3kt','KR→대만 2–3kt','MT','영업일',2,true],
    ['AAVCA00','운임 · 한국 출발','한국→동중국 5kt','KR→동중국 5kt','MT','영업일',3,true],
    ['PXAEC00','운임 · PX 명시','PX 인도→동중국','PX 인도→동중국','MT','주간(금)',4,true],
    ['PXASC00','운임 · PX 명시','PX 인도→남중국·대만','PX 인도→남중국·대만','MT','주간(금)',5,true],
    ['B3NSH00','벙커 · HSFO 380 CST','HSFO 상하이','HSFO 상하이','MT','영업일',6,true],
    ['PUAFR00','벙커 · HSFO 380 CST','HSFO 한국','HSFO 한국','MT','영업일',7,true],
    ['PUAEV00','벙커 · HSFO 380 CST','HSFO 일본','HSFO 일본','MT','영업일',8,true],
    ['MFZHN00','벙커 · VLSFO 0.5%','VLSFO 저우산(부두)','VLSFO 저우산','MT','영업일',9,true],
    ['MFSKD00','벙커 · VLSFO 0.5%','VLSFO 한국','VLSFO 한국','MT','영업일',10,true],
    ['MFJPD00','벙커 · VLSFO 0.5%','VLSFO 일본','VLSFO 일본','MT','영업일',11,true],
    ['AAMFL00','참고 · 원료 · 원유','SM FOB Korea','SM FOB KR','MT','영업일',12,true],
    ['PAAAD00','참고 · 원료 · 원유','나프타 C+F Japan','나프타 CFR JP','MT','영업일',13,true],
    ['NMCL001','참고 · 원료 · 원유','WTI 근월물','WTI','BBL','영업일',14,true]
  ];

  sh.getRange(2, 1, rows.length, 8).setValues(rows);
  return sh;
}


function formatHeader_(sh, width) {
  sh.getRange(1, 1, 1, width)
    .setBackground('#0B2A6B')
    .setFontColor('#FFFFFF')
    .setFontWeight('bold');

  sh.setFrozenRows(Math.max(sh.getFrozenRows(), 1));
}


/* =========================================================
 * 8. HELPERS
 * ========================================================= */

function splitHtml_(htmlText) {
  const out = [];
  for (let i = 0; i < htmlText.length; i += APP.HTML_CHUNK_SIZE) {
    out.push(htmlText.slice(i, i + APP.HTML_CHUNK_SIZE));
  }
  return out.length ? out : [''];
}


function verifyAdminPassword_(pw) {
  const expected = PropertiesService.getScriptProperties()
    .getProperty('ADMIN_PASSWORD_HASH');

  if (!expected) {
    throw new Error(
      '관리자 비밀번호가 아직 설정되지 않았습니다. setAdminPasswordFromPrompt()를 먼저 실행하세요.'
    );
  }

  if (sha256_(String(pw || '')) !== expected) {
    throw new Error('관리자 비밀번호가 올바르지 않습니다.');
  }
}


function sha256_(text) {
  const bytes = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    text,
    Utilities.Charset.UTF_8
  );

  return bytes.map(b => {
    const v = (b < 0 ? b + 256 : b).toString(16);
    return v.length === 1 ? '0' + v : v;
  }).join('');
}


function now_() {
  return Utilities.formatDate(
    new Date(),
    APP.TZ,
    'yyyy-MM-dd HH:mm:ss'
  );
}


function dateCell_(v) {
  if (v instanceof Date) {
    return Utilities.formatDate(v, APP.TZ, 'yyyy-MM-dd');
  }
  return String(v || '').slice(0, 10);
}


function normalizeDate_(v) {
  const s = String(v || '').slice(0, 10);
  requireDate_(s);
  return s;
}


function requireDate_(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(s || ''))) {
    throw new Error('날짜는 YYYY-MM-DD 형식이어야 합니다.');
  }
}


function toInt_(v, fallback) {
  const n = parseInt(v, 10);
  return isFinite(n) && n > 0 ? n : fallback;
}


function stripHtml_(s) {
  return String(s || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/\s+/g, ' ')
    .trim();
}


function trimText_(s, n) {
  s = String(s || '');
  return s.length <= n ? s : s.slice(0, n) + '…';
}


function jsonOut_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}